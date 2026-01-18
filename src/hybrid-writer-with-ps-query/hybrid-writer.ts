/**
 * Новый вариант HybridWriter с использованием очереди trino_queue
 * 
 * Процесс:
 * 1. Генерация объекта через generateRegistrarObject() → запись в bonus_registry_unique_check
 * 2. Генерация баланса → запись в bonus_registry_balance_check
 * 3. Вызов bonus_registry_faker() → дополнение объекта
 * 4. Запись в trino_queue (PostgreSQL)
 * 
 * Отдельный воркер обрабатывает очередь и отправляет батчи в Trino/Iceberg
 */

import type { Sql } from "postgres";
import { Trino } from "trino-client";
import {
  generateRegistrarObject,
  bonus_registry_faker,
  hashObject,
  type BonusRegistryFakerObject,
} from "../hybrid-writer/utils.js";
import {
  getPostgresConfig,
  getTrinoConfig,
  connectPostgres,
  connectTrino,
  checkPostgresTableExists,
  checkTrinoTableExists,
} from "../hybrid-writer/utils.js";
import {
  createAllTables,
} from "./create-tables.js";
import {
  escapePostgresIdentifier,
  escapePostgresLiteral,
} from "../generator/escape.js";
import { SagaManager } from "../saga/index.js";

export interface HybridWriterConfig {
  postgres: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  trino: {
    host: string;
    port: number;
    catalog: string;
    schema: string;
    user: string;
    table: string;
  };
  tables: {
    uniqueCheck: string;
    balanceCheck: string;
    trinoQueue: string;
  };
}

export interface WriteResult {
  registrar_type_id: string;
  registrar_id: string;
  row: number;
  amount: number;
  queueId: number;
}

export class HybridWriterWithQueue {
  private config: HybridWriterConfig;
  private sql: Sql | null = null;
  private trino: Trino | null = null;
  private isConnected = false;

  constructor(config: HybridWriterConfig) {
    this.config = config;
  }

  /**
   * Подключение к базам данных и проверка/создание таблиц
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    // Подключение к PostgreSQL
    const postgresConfig = getPostgresConfig();
    this.sql = await connectPostgres(postgresConfig);

    // Подключение к Trino
    const trinoConfig = getTrinoConfig();
    this.trino = connectTrino(trinoConfig);

    // Проверка и создание таблиц
    await this.ensureTables();

    this.isConnected = true;
  }

  /**
   * Проверка наличия всех необходимых таблиц и создание их при необходимости
   */
  private async ensureTables(): Promise<void> {
    if (!this.sql || !this.trino) {
      throw new Error("Not connected. Call connect() first.");
    }

    const trinoConfig = getTrinoConfig();

    // Проверяем наличие таблиц в PostgreSQL
    const uniqueCheckExists = await checkPostgresTableExists(
      this.sql,
      this.config.tables.uniqueCheck
    );
    const balanceCheckExists = await checkPostgresTableExists(
      this.sql,
      this.config.tables.balanceCheck
    );
    const sagaExists = await checkPostgresTableExists(this.sql, "Saga");
    const trinoQueueExists = await checkPostgresTableExists(
      this.sql,
      this.config.tables.trinoQueue
    );

    // Проверяем наличие таблицы в Trino
    const trinoTableExists = await checkTrinoTableExists(
      this.trino,
      trinoConfig.catalog,
      trinoConfig.schema,
      this.config.trino.table
    );

    // Если хотя бы одна таблица отсутствует, создаем все
    if (
      !uniqueCheckExists ||
      !balanceCheckExists ||
      !sagaExists ||
      !trinoQueueExists ||
      !trinoTableExists
    ) {
      console.log("Some tables are missing. Creating all tables...");
      await createAllTables({
        postgres: { sql: this.sql },
        trino: {
          trino: this.trino,
          catalog: trinoConfig.catalog,
          schema: trinoConfig.schema,
        },
      });
    } else {
      console.log("✓ All required tables exist");
    }
  }

  /**
   * Запись одной записи
   * 
   * Процесс:
   * 1. Открываем сагу
   * 2. Генерируем registrar_type_id, registrar_id, row с использованием generateRegistrarObject()
   * 3. Записываем в bonus_registry_unique_check: при успехе продолжаем, при ошибке ролбэк саги
   * 4. Генерируем баланс как случайное число от -1000 до +10000. Записываем в bonus_registry_balance_check. при успехе продолжаем, при ошибке ролбэк саги
   * 5. Вызываем bonus_registry_faker(), дополняем полученный объект полями из сообщения и записываем все это в trino_queue
   */
  async write(options: { verbose?: boolean } = {}): Promise<WriteResult> {
    if (!this.sql) {
      throw new Error("Not connected. Call connect() first.");
    }

    const verbose = options.verbose ?? false;

    // Создаем отдельный экземпляр SagaManager для каждого вызова write()
    // Это необходимо для поддержки параллельных вызовов
    const sagaManager = new SagaManager(this.sql);

    // 1. Открываем сагу
    const sagaBeginStart = Date.now();
    const sagaId = await sagaManager.beginSaga({
      description: "Write bonus registry entry to queue",
    });
    const sagaBeginDuration = Date.now() - sagaBeginStart;
    if (verbose) {
      console.log(`  ⏱ Saga opened: ${sagaId} (${sagaBeginDuration}ms)`);
    }

    // 2. Генерируем registrar_type_id, registrar_id, row
    const generateRegistrarStart = Date.now();
    const registrarData = generateRegistrarObject();
    const { registrar_type_id, registrar_id, row } = registrarData;
    const generateRegistrarDuration = Date.now() - generateRegistrarStart;
    if (verbose) {
      console.log(
        `  ⏱ Generated registrar data: ${registrar_type_id}/${registrar_id}/row=${row} (${generateRegistrarDuration}ms)`
      );
    }

    try {
      // 3. Записываем в bonus_registry_unique_check
      sagaManager.addOperation({
        id: "insert-unique-check",
        execute: async () => {
          const startTime = Date.now();
          if (!this.sql) {
            throw new Error("PostgreSQL connection not available");
          }

          // Вычисляем хэш на основе registrar_type_id, registrar_id и row
          const keyFieldsHash = hashObject({
            registrar_type_id,
            registrar_id,
            row,
          });

          const insertSql = `
            INSERT INTO ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} (
              id,
              name_of_uniqueness,
              key_fields_hash,
              "createdAt",
              "sagaId"
            )
            VALUES (
              gen_random_uuid()::text,
              ${escapePostgresLiteral("registrar_unique")},
              ${escapePostgresLiteral(keyFieldsHash)},
              NOW(),
              ${escapePostgresLiteral(sagaId)}
            )
            RETURNING id
          `;

          const result = await this.sql.unsafe<{ id: string }[]>(insertSql);
          const insertedId = result && result.length > 0 ? result[0]?.id : null;

          if (!insertedId) {
            throw new Error("Failed to insert into bonus_registry_unique_check");
          }

          const duration = Date.now() - startTime;
          if (verbose) {
            console.log(`  ✓ Inserted into ${this.config.tables.uniqueCheck}: ${insertedId} (${duration}ms)`);
          }
          return insertedId;
        },
        compensate: async (data) => {
          if (!this.sql || !data) {
            return;
          }
          const recordId = data as string;
          await this.sql.unsafe(
            `DELETE FROM ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} WHERE id = ${escapePostgresLiteral(recordId)}`
          );
          if (verbose) {
            console.log(`  ✓ Compensated ${this.config.tables.uniqueCheck}: ${recordId}`);
          }
        },
      });

      // 4. Генерируем баланс и записываем в bonus_registry_balance_check
      const amount = Math.floor(Math.random() * 11001) - 1000; // От -1000 до +10000

      sagaManager.addOperation({
        id: "insert-balance-check",
        execute: async () => {
          const startTime = Date.now();
          if (!this.sql) {
            throw new Error("PostgreSQL connection not available");
          }

          const insertSql = `
            INSERT INTO ${escapePostgresIdentifier(this.config.tables.balanceCheck)} (
              id,
              amount,
              "sagaId"
            )
            VALUES (
              gen_random_uuid()::text,
              ${String(amount)}::DECIMAL(20, 2),
              ${escapePostgresLiteral(sagaId)}
            )
            RETURNING id
          `;

          const result = await this.sql.unsafe<{ id: string }[]>(insertSql);
          const insertedId = result && result.length > 0 ? result[0]?.id : null;

          if (!insertedId) {
            throw new Error("Failed to insert into bonus_registry_balance_check");
          }

          const duration = Date.now() - startTime;
          if (verbose) {
            console.log(`  ✓ Inserted into ${this.config.tables.balanceCheck}: ${insertedId} (amount: ${amount}, ${duration}ms)`);
          }
          return insertedId;
        },
        compensate: async (data) => {
          if (!this.sql || !data) {
            return;
          }
          const recordId = data as string;
          await this.sql.unsafe(
            `DELETE FROM ${escapePostgresIdentifier(this.config.tables.balanceCheck)} WHERE id = ${escapePostgresLiteral(recordId)}`
          );
          if (verbose) {
            console.log(`  ✓ Compensated ${this.config.tables.balanceCheck}: ${recordId}`);
          }
        },
      });

      // 5. Вызываем bonus_registry_faker() и дополняем объект
      const fakerStart = Date.now();
      const fakerData = bonus_registry_faker();
      const fakerDuration = Date.now() - fakerStart;
      if (verbose) {
        console.log(`  ⏱ Generated faker data (${fakerDuration}ms)`);
      }

      // Формирование финального объекта для записи в Trino
      const finalData: BonusRegistryFakerObject & {
        registrar_type_id: string;
        registrar_id: string;
        row: number;
        amount: number;
      } = {
        ...fakerData,
        registrar_type_id,
        registrar_id,
        row,
        amount,
      };

      // 6. Записываем в trino_queue в рамках саги
      // Сохраняем queueId в переменной для доступа после выполнения саги
      let queueId: number | null = null;

      sagaManager.addOperation({
        id: "insert-into-trino-queue",
        execute: async () => {
          const startTime = Date.now();
          if (!this.sql) {
            throw new Error("PostgreSQL connection not available");
          }

          const queuePayload = {
            table: this.config.trino.table,
            values: finalData,
          };

          const insertSql = `
            INSERT INTO ${escapePostgresIdentifier(this.config.tables.trinoQueue)} (
              operation_type,
              payload
            )
            VALUES (
              ${escapePostgresLiteral("INSERT")},
              ${escapePostgresLiteral(JSON.stringify(queuePayload))}::jsonb
            )
            RETURNING id
          `;

          const result = await this.sql.unsafe<{ id: number }[]>(insertSql);
          const insertedId = result && result.length > 0 ? result[0]?.id : null;

          if (!insertedId) {
            throw new Error("Failed to insert into trino_queue");
          }

          // Сохраняем queueId для возврата из функции
          queueId = insertedId;

          const duration = Date.now() - startTime;
          if (verbose) {
            console.log(`  ✓ Inserted into ${this.config.tables.trinoQueue}: ${insertedId} (${duration}ms)`);
          }
          return insertedId;
        },
        compensate: async (data) => {
          if (!this.sql || !data) {
            return;
          }
          const queueIdToDelete = data;
          await this.sql.unsafe(
            `DELETE FROM ${escapePostgresIdentifier(this.config.tables.trinoQueue)} WHERE id = ${String(queueIdToDelete)}`
          );
          if (verbose) {
            console.log(`  ✓ Compensated ${this.config.tables.trinoQueue}: ${queueIdToDelete}`);
          }
        },
      });

      // Коммитим сагу (выполняет все операции)
      const commitStart = Date.now();
      await sagaManager.commitSaga();
      const commitDuration = Date.now() - commitStart;
      if (verbose) {
        console.log(`  ✓ Saga committed (${commitDuration}ms)`);
      }

      if (!queueId) {
        throw new Error("Failed to get queueId from saga operation");
      }

      return {
        registrar_type_id,
        registrar_id,
        row,
        amount,
        queueId,
      };
    } catch (error) {
      // commitSaga() уже вызывает rollbackSaga() при ошибке, но для надежности
      // проверяем и здесь, на случай если ошибка возникла до commitSaga()
      try {
        if (sagaManager) {
          // Проверяем, что сага еще активна (не была откачена в commitSaga())
          // rollbackSaga() безопасен для повторного вызова, но лучше проверить
          await sagaManager.rollbackSaga();
          if (verbose) {
            console.log(`  ⏱ Saga rolled back due to error`);
          }
        }
      } catch (rollbackError) {
        // Если сага уже была откачена (например, в commitSaga()), это нормально
        if (verbose) {
          if (rollbackError instanceof Error && rollbackError.message.includes("already")) {
            console.log(`  ⏱ Saga already rolled back (likely by commitSaga())`);
          } else {
            console.error(`  ✗ Error during saga rollback:`, rollbackError);
          }
        }
      }
      throw error;
    }
  }

  /**
   * Пакетная запись нескольких записей
   */
  async writeBatch(
    count: number,
    options: { verbose?: boolean } = {},
    concurrency: number = 10
  ): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    const errors: Array<{ index: number; error: unknown }> = [];

    const tasks = Array.from({ length: count }, (_, i) => i);

    // Обрабатываем задачи с ограничением параллельности
    const processBatch = async (batch: number[]): Promise<void> => {
      const batchResults = await Promise.allSettled(
        batch.map(async (index) => {
          return await this.write(options);
        })
      );

      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          errors.push({ index: batch[i], error: result.reason });
          if (options.verbose) {
            console.error(`  ✗ Error writing record ${batch[i]}:`, result.reason instanceof Error ? result.reason.message : String(result.reason));
          }
        }
      }
    };

    // Разбиваем задачи на батчи
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      await processBatch(batch);
    }

    if (errors.length > 0 && options.verbose) {
      console.error(`\n✗ ${errors.length} errors occurred during batch write`);
    }

    return results;
  }

  /**
   * Отключение от баз данных
   */
  async disconnect(): Promise<void> {
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
    }
    // Trino не требует явного отключения
    this.trino = null;
    this.isConnected = false;
  }
}

/**
 * Получение конфигурации HybridWriterWithQueue из переменных окружения
 */
export function getHybridWriterWithQueueConfig(): HybridWriterConfig {
  const postgresConfig = getPostgresConfig();
  const trinoConfig = getTrinoConfig();

  return {
    postgres: postgresConfig,
    trino: {
      ...trinoConfig,
      table: trinoConfig.table || "bonus_registry",
    },
    tables: {
      uniqueCheck: "bonus_registry_unique_check",
      balanceCheck: "bonus_registry_balance_check",
      trinoQueue: "trino_queue",
    },
  };
}
