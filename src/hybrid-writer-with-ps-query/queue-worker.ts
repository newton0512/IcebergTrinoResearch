/**
 * Воркер для обработки очереди trino_queue
 * 
 * Процесс:
 * 1. Каждые 2 секунды выбирает все накопленные записи из trino_queue
 * 2. Формирует батч-запрос к Trino/Iceberg (INSERT INTO ... VALUES (...), (...), (...))
 * 3. Отправляет его в Trino/Iceberg
 * 4. После успешной вставки удаляет записи из trino_queue
 */

import type { Sql } from "postgres";
import { Trino } from "trino-client";
import {
  escapeTrinoIdentifier,
  escapeTrinoLiteral,
} from "../generator/escape.js";
import {
  getPostgresConfig,
  getTrinoConfig,
  connectPostgres,
  connectTrino,
} from "../hybrid-writer/utils.js";
import {
  escapePostgresIdentifier,
} from "../generator/escape.js";

export interface QueueWorkerConfig {
  postgres: {
    sql: Sql;
  };
  trino: {
    trino: Trino;
    catalog: string;
    schema: string;
    table: string;
  };
  queueTable: string;
  batchIntervalMs?: number; // Интервал обработки батчей (по умолчанию 2000ms)
  batchSize?: number; // Размер батча - количество записей, выбираемых из очереди за раз (по умолчанию 5000)
}

export interface QueueItem {
  id: number;
  operation_type: string;
  payload: {
    table: string;
    values: Record<string, unknown>;
  };
  created_at: Date;
}

interface BatchStats {
  totalProcessed: number;
  totalErrors: number;
  totalBatches: number;
  totalTimeMs: number;
  lastBatchTimeMs: number;
  lastBatchSize: number;
  lastBatchRecordsPerSecond: number;
}

export class QueueWorker {
  private config: QueueWorkerConfig;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private stopRequested = false;
  private isProcessing = false; // Флаг для предотвращения параллельного выполнения
  private stats: BatchStats = {
    totalProcessed: 0,
    totalErrors: 0,
    totalBatches: 0,
    totalTimeMs: 0,
    lastBatchTimeMs: 0,
    lastBatchSize: 0,
    lastBatchRecordsPerSecond: 0,
  };
  private verbose: boolean;

  constructor(config: QueueWorkerConfig, verbose = false) {
    this.config = config;
    this.verbose = verbose;
  }

  /**
   * Запуск воркера
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("Worker is already running");
      return;
    }

    this.isRunning = true;
    this.stopRequested = false;
    this.isProcessing = false;
    const intervalMs = this.config.batchIntervalMs ?? 2000;
    const batchSize = this.config.batchSize ?? 5000;

    console.log(`Queue worker started. Processing batches every ${intervalMs}ms, batch size: ${batchSize} records`);

    // Обрабатываем первый батч сразу
    await this.processBatch();

    // Затем запускаем периодическую обработку
    // Используем setTimeout вместо setInterval для последовательного выполнения
    const scheduleNext = (): void => {
      if (this.stopRequested) {
        this.stop();
        return;
      }
      setTimeout(() => {
        void (async () => {
          await this.processBatch();
          if (this.isRunning && !this.stopRequested) {
            scheduleNext();
          }
        })();
      }, intervalMs);
    };

    scheduleNext();
  }

  /**
   * Остановка воркера
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.stopRequested = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    
    // Выводим финальную статистику
    const avgRecordsPerSecond = this.stats.totalBatches > 0
      ? (this.stats.totalProcessed / (this.stats.totalTimeMs / 1000)).toFixed(2)
      : "0";
    
    console.log("\n=================================================");
    console.log("Queue worker stopped");
    console.log("Final statistics:");
    console.log(`  Total processed: ${this.stats.totalProcessed} records`);
    console.log(`  Total batches: ${this.stats.totalBatches}`);
    console.log(`  Total errors: ${this.stats.totalErrors}`);
    console.log(`  Total time: ${(this.stats.totalTimeMs / 1000).toFixed(2)}s`);
    console.log(`  Average speed: ${avgRecordsPerSecond} records/second`);
    if (this.stats.totalBatches > 0) {
      console.log(`  Average batch size: ${(this.stats.totalProcessed / this.stats.totalBatches).toFixed(0)} records`);
      console.log(`  Average batch time: ${(this.stats.totalTimeMs / this.stats.totalBatches).toFixed(0)}ms`);
    }
    console.log("=================================================");
  }

  /**
   * Получение текущей статистики
   */
  getStats(): BatchStats {
    return { ...this.stats };
  }

  /**
   * Обработка одного батча
   */
  private async processBatch(): Promise<void> {
    // Предотвращаем параллельное выполнение
    if (this.isProcessing) {
      if (this.verbose) {
        console.log("Batch processing already in progress, skipping...");
      }
      return;
    }

    this.isProcessing = true;
    const batchStartTime = Date.now();

    try {
      // 1. Выбираем все записи из очереди
      const fetchStartTime = Date.now();
      const items = await this.fetchQueueItems();
      const fetchTime = Date.now() - fetchStartTime;

      if (items.length === 0) {
        this.isProcessing = false;
        return; // Нет записей для обработки
      }

      if (this.verbose) {
        console.log(`[${fetchTime}ms] Fetched ${items.length} items from queue`);
      }

      // 2. Группируем по типу операции (пока только INSERT)
      const insertItems = items.filter((item) => item.operation_type === "INSERT");

      if (insertItems.length === 0) {
        if (this.verbose) {
          console.warn("No INSERT operations found in batch");
        }
        this.isProcessing = false;
        return;
      }

      // 3. Формируем и выполняем батч-запрос к Trino
      const insertStartTime = Date.now();
      await this.executeBatchInsert(insertItems);
      const insertTime = Date.now() - insertStartTime;

      // 4. Удаляем обработанные записи из очереди
      const deleteStartTime = Date.now();
      await this.deleteProcessedItems(insertItems.map((item) => item.id));
      const deleteTime = Date.now() - deleteStartTime;

      const totalBatchTime = Date.now() - batchStartTime;
      const recordsPerSecond = (insertItems.length / (totalBatchTime / 1000)).toFixed(2);

      // Обновляем статистику
      this.stats.totalProcessed += insertItems.length;
      this.stats.totalBatches += 1;
      this.stats.totalTimeMs += totalBatchTime;
      this.stats.lastBatchTimeMs = totalBatchTime;
      this.stats.lastBatchSize = insertItems.length;
      this.stats.lastBatchRecordsPerSecond = parseFloat(recordsPerSecond);

      const avgRecordsPerSecond = this.stats.totalBatches > 0
        ? (this.stats.totalProcessed / (this.stats.totalTimeMs / 1000)).toFixed(2)
        : "0";

      console.log(
        `✓ Batch: ${insertItems.length} records | ` +
        `Time: ${totalBatchTime}ms (fetch: ${fetchTime}ms, insert: ${insertTime}ms, delete: ${deleteTime}ms) | ` +
        `Speed: ${recordsPerSecond} rec/s | ` +
        `Total: ${this.stats.totalProcessed} records, ${this.stats.totalBatches} batches, avg: ${avgRecordsPerSecond} rec/s`
      );
    } catch (error) {
      this.stats.totalErrors += 1;
      const totalBatchTime = Date.now() - batchStartTime;
      console.error(`✗ Batch failed after ${totalBatchTime}ms:`, error instanceof Error ? error.message : String(error));
      // Не останавливаем воркер при ошибке, продолжаем работу
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Выборка записей из очереди
   */
  private async fetchQueueItems(): Promise<QueueItem[]> {
    const sql = this.config.postgres.sql;
    const queueTable = escapePostgresIdentifier(this.config.queueTable);
    const batchSize = this.config.batchSize ?? 5000;

    const query = `
      SELECT id, operation_type, payload, created_at
      FROM ${queueTable}
      ORDER BY id ASC
      LIMIT ${batchSize}
    `;

    const result = await sql.unsafe<QueueItem[]>(query);
    return result;
  }


  /**
   * Проверка, является ли ошибка конфликтом Nessie
   */
  private isNessieHashConflict(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("ref hash is out of date") ||
        message.includes("ref 'main' is no longer valid") ||
        message.includes("cannot commit") ||
        message.includes("update the ref") ||
        message.includes("iceberg_commit_error")
      );
    }
    return false;
  }

  /**
   * Retry механизм с экспоненциальной задержкой для Nessie конфликтов
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    initialDelayMs = 50,
    maxDelayMs = 1000,
    backoffMultiplier = 1.5
  ): Promise<T> {
    let lastError: unknown;
    let delay = initialDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Если это не конфликт Nessie или последняя попытка - выбрасываем ошибку
        if (!this.isNessieHashConflict(error) || attempt === maxRetries) {
          throw error;
        }

        // Экспоненциальная задержка с jitter для уменьшения contention
        const jitter = Math.random() * 0.2 * delay; // До 20% случайности
        const delayWithJitter = Math.min(delay + jitter, maxDelayMs);
        
        if (attempt < maxRetries) {
          if (this.verbose) {
            console.log(`  Retry attempt ${attempt + 1}/${maxRetries} after ${delayWithJitter.toFixed(0)}ms (Nessie conflict)`);
          }
          await new Promise((resolve) => setTimeout(resolve, delayWithJitter));
          delay = Math.min(delay * backoffMultiplier, maxDelayMs);
        }
      }
    }

    throw lastError;
  }

  /**
   * Выполнение батч-вставки в Trino/Iceberg с retry для Nessie конфликтов
   */
  private async executeBatchInsert(items: QueueItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const trino = this.config.trino.trino;
    const catalog = this.config.trino.catalog;
    const schema = this.config.trino.schema;
    const table = this.config.trino.table;

    const escapedCatalog = escapeTrinoIdentifier(catalog);
    const escapedSchema = escapeTrinoIdentifier(schema);
    const escapedTable = escapeTrinoIdentifier(table.toLowerCase());
    const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

    // Используем фиксированный список колонок (как в utils.ts)
    const columns = [
      "id", "date", "registrar_type_id", "registrar_id", "row",
      "manager_id", "bs_profile_id", "accounted_for_bs_profile_id",
      "first_name", "first_name_latin", "last_name", "last_name_latin",
      "departure_id", "arrival_id", "departure_date", "currency_entry_id",
      "bonus_type_id", "action_source_id", "bs_bonus_ticket_id",
      "validity_time", "date_of_expire", "car_type_id", "express_carrier_id",
      "carrier_id", "bs_partner_id", "bs_train_number_id", "bs_tourism_train_id",
      "accounted_in_calculation", "cancelled", "bs_quota_id",
      "doc_to_track_type_id", "doc_to_track_id", "doc_to_track_date",
      "active_date", "trip_for_another_person", "ticket_number",
      "currency_amount", "amount", "bs_partner_bonus_type_id",
      "express_service_class_id", "date_to_cancelled", "prolongable",
      "active_by_trips", "is_empty", "amount_calculation",
      "distance", "addition_amount", "operation_doc_type_id",
      "is_merged", "merged_date",
    ];

    // Формируем VALUES для всех записей
    const allValues = items.map((item) => {
      if (!item.payload.values) {
        throw new Error(`Invalid payload for item ${item.id}`);
      }
      const data = item.payload.values;
      const values = [
        `CAST(${escapeTrinoLiteral(String(data.id || ""))} AS VARCHAR)`,
        data.date ? `TIMESTAMP '${this.formatTimestamp(new Date(data.date as string))}'` : "CAST(NULL AS TIMESTAMP)",
        data.registrar_type_id ? `CAST(${escapeTrinoLiteral(String(data.registrar_type_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.registrar_id ? `CAST(${escapeTrinoLiteral(String(data.registrar_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.row !== null && data.row !== undefined ? `CAST(${String(data.row)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.manager_id !== null && data.manager_id !== undefined ? `CAST(${String(data.manager_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        `CAST(${escapeTrinoLiteral(String(data.bs_profile_id || ""))} AS VARCHAR)`,
        `CAST(${escapeTrinoLiteral(String(data.accounted_for_bs_profile_id || ""))} AS VARCHAR)`,
        data.first_name ? `CAST(${escapeTrinoLiteral(String(data.first_name))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.first_name_latin ? `CAST(${escapeTrinoLiteral(String(data.first_name_latin))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.last_name ? `CAST(${escapeTrinoLiteral(String(data.last_name))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.last_name_latin ? `CAST(${escapeTrinoLiteral(String(data.last_name_latin))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.departure_id !== null && data.departure_id !== undefined ? `CAST(${String(data.departure_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.arrival_id !== null && data.arrival_id !== undefined ? `CAST(${String(data.arrival_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.departure_date ? `CAST(${escapeTrinoLiteral(this.formatDate(new Date(data.departure_date as string)))} AS DATE)` : "CAST(NULL AS DATE)",
        data.currency_entry_id !== null && data.currency_entry_id !== undefined ? `CAST(${String(data.currency_entry_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        `CAST(${escapeTrinoLiteral(String(data.bonus_type_id || ""))} AS VARCHAR)`,
        `CAST(${escapeTrinoLiteral(String(data.action_source_id || ""))} AS VARCHAR)`,
        data.bs_bonus_ticket_id ? `CAST(${escapeTrinoLiteral(String(data.bs_bonus_ticket_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.validity_time !== null && data.validity_time !== undefined ? `CAST(${String(data.validity_time)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.date_of_expire ? `CAST(${escapeTrinoLiteral(this.formatDate(new Date(data.date_of_expire as string)))} AS DATE)` : "CAST(NULL AS DATE)",
        data.car_type_id ? `CAST(${escapeTrinoLiteral(String(data.car_type_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.express_carrier_id !== null && data.express_carrier_id !== undefined ? `CAST(${String(data.express_carrier_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.carrier_id ? `CAST(${escapeTrinoLiteral(String(data.carrier_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.bs_partner_id !== null && data.bs_partner_id !== undefined ? `CAST(${String(data.bs_partner_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.bs_train_number_id ? `CAST(${escapeTrinoLiteral(String(data.bs_train_number_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.bs_tourism_train_id ? `CAST(${escapeTrinoLiteral(String(data.bs_tourism_train_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.accounted_in_calculation !== null && data.accounted_in_calculation !== undefined ? `CAST(${data.accounted_in_calculation ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
        data.cancelled !== null && data.cancelled !== undefined ? `CAST(${data.cancelled ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
        data.bs_quota_id !== null && data.bs_quota_id !== undefined ? `CAST(${String(data.bs_quota_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        `CAST(${escapeTrinoLiteral(String(data.doc_to_track_type_id || ""))} AS VARCHAR)`,
        `CAST(${escapeTrinoLiteral(String(data.doc_to_track_id || ""))} AS VARCHAR)`,
        data.doc_to_track_date ? `CAST(${escapeTrinoLiteral(this.formatDate(new Date(data.doc_to_track_date as string)))} AS DATE)` : "CAST(NULL AS DATE)",
        data.active_date ? `CAST(${escapeTrinoLiteral(this.formatDate(new Date(data.active_date as string)))} AS DATE)` : "CAST(NULL AS DATE)",
        data.trip_for_another_person !== null && data.trip_for_another_person !== undefined ? `CAST(${data.trip_for_another_person ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
        data.ticket_number ? `CAST(${escapeTrinoLiteral(String(data.ticket_number))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.currency_amount !== null && data.currency_amount !== undefined ? `CAST(${String(data.currency_amount)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        `CAST(${String(data.amount || 0)} AS INTEGER)`,
        data.bs_partner_bonus_type_id ? `CAST(${escapeTrinoLiteral(String(data.bs_partner_bonus_type_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.express_service_class_id !== null && data.express_service_class_id !== undefined ? `CAST(${String(data.express_service_class_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.date_to_cancelled ? `TIMESTAMP '${this.formatTimestamp(new Date(data.date_to_cancelled as string))}'` : "CAST(NULL AS TIMESTAMP)",
        data.prolongable !== null && data.prolongable !== undefined ? `CAST(${data.prolongable ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
        data.active_by_trips !== null && data.active_by_trips !== undefined ? `CAST(${data.active_by_trips ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
        data.is_empty !== null && data.is_empty !== undefined ? `CAST(${data.is_empty ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
        data.amount_calculation ? `CAST(${escapeTrinoLiteral(String(data.amount_calculation))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.distance !== null && data.distance !== undefined ? `CAST(${String(data.distance)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.addition_amount !== null && data.addition_amount !== undefined ? `CAST(${String(data.addition_amount)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
        data.operation_doc_type_id ? `CAST(${escapeTrinoLiteral(String(data.operation_doc_type_id))} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
        data.is_merged !== null && data.is_merged !== undefined ? `CAST(${data.is_merged ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
        data.merged_date ? `CAST(${escapeTrinoLiteral(this.formatDate(new Date(data.merged_date as string)))} AS DATE)` : "CAST(NULL AS DATE)",
      ];
      return `(${values.join(", ")})`;
    });

    const insertSql = `
      INSERT INTO ${fullTableName} (${columns.map(c => escapeTrinoIdentifier(c)).join(", ")})
      VALUES ${allValues.join(", ")}
    `;

    // Выполняем запрос с retry для Nessie конфликтов
    await this.retryWithBackoff(async () => {
      const query = await trino.query(insertSql);

      // Потребляем результаты и проверяем на ошибки
      for await (const result of query) {
        // Проверяем различные форматы ответа от Trino
        if (result && typeof result === "object") {
          // Формат 1: { error: { message: ... } }
          const trinoResult = result as { 
            error?: { 
              message?: string; 
              errorCode?: number; 
              errorName?: string;
              errorType?: string;
            };
            data?: unknown;
          };
          
          if (trinoResult.error) {
            const errorDetails = {
              message: trinoResult.error.message || "Unknown Trino error",
              errorCode: trinoResult.error.errorCode,
              errorName: trinoResult.error.errorName,
              errorType: trinoResult.error.errorType,
            };
            const error = new Error(`Trino batch insert failed (${items.length} records): ${JSON.stringify(errorDetails)}`);
            // Сохраняем оригинальное сообщение для проверки Nessie конфликта
            throw error;
          }
        } else if (result && typeof result === "string") {
          // Формат 2: строка с ошибкой
          const error = new Error(`Trino batch insert failed (${items.length} records): ${result}`);
          throw error;
        }
      }
    });
  }

  /**
   * Форматирование даты для Trino (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    const iso = date.toISOString();
    return iso.split("T")[0] || "";
  }

  /**
   * Форматирование timestamp для Trino (YYYY-MM-DD HH:mm:ss)
   */
  private formatTimestamp(date: Date): string {
    const iso = date.toISOString();
    return iso.replace("T", " ").replace("Z", "").split(".")[0] || "";
  }

  /**
   * Удаление обработанных записей из очереди
   */
  private async deleteProcessedItems(ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const sql = this.config.postgres.sql;
    const queueTable = escapePostgresIdentifier(this.config.queueTable);

    const idsString = ids.join(", ");
    const deleteSql = `
      DELETE FROM ${queueTable}
      WHERE id IN (${idsString})
    `;

    await sql.unsafe(deleteSql);
  }
}

/**
 * Создание и запуск воркера с конфигурацией из переменных окружения
 */
export async function createAndStartWorker(
  options: {
    batchIntervalMs?: number;
    batchSize?: number;
    verbose?: boolean;
  } = {}
): Promise<QueueWorker> {
  const postgresConfig = getPostgresConfig();
  const trinoConfig = getTrinoConfig();

  const sql = await connectPostgres(postgresConfig);
  const trino = connectTrino(trinoConfig);

  const worker = new QueueWorker(
    {
      postgres: { sql },
      trino: {
        trino,
        catalog: trinoConfig.catalog,
        schema: trinoConfig.schema,
        table: trinoConfig.table || "bonus_registry",
      },
      queueTable: "trino_queue",
      batchIntervalMs: options.batchIntervalMs ?? 2000,
      batchSize: options.batchSize ?? 5000,
    },
    options.verbose ?? false
  );

  await worker.start();

  // Обработка сигналов для корректного завершения
  const shutdown = (): void => {
    console.log("\nShutting down worker...");
    worker.stop();
    sql.end().catch(console.error);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return worker;
}
