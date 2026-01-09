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
  type RegistrarObject,
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
  type CreateTablesConfig,
} from "./create-tables.js";
import {
  escapePostgresIdentifier,
  escapePostgresLiteral,
} from "../generator/escape.js";

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
    const postgresConfig = getPostgresConfig();

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
   * 1. Генерация registrar данных → запись в bonus_registry_unique_check
   * 2. Генерация баланса → запись в bonus_registry_balance_check
   * 3. Генерация полного объекта через bonus_registry_faker()
   * 4. Запись в trino_queue
   */
  async write(options: { verbose?: boolean } = {}): Promise<WriteResult> {
    if (!this.sql) {
      throw new Error("Not connected. Call connect() first.");
    }

    const verbose = options.verbose ?? false;

    // Временная константа для sagaId (для тестирования без саги)
    const TEMP_SAGA_ID = "temp-saga-id-for-testing";

    // 1. Генерация registrar данных
    const generateRegistrarStart = Date.now();
    const registrarData = generateRegistrarObject();
    const { registrar_type_id, registrar_id, row } = registrarData;
    const generateRegistrarDuration = Date.now() - generateRegistrarStart;
    if (verbose) {
      console.log(
        `  ⏱ Generated registrar data: ${registrar_type_id}/${registrar_id}/row=${row} (${generateRegistrarDuration}ms)`
      );
    }

    // 2. Запись в bonus_registry_unique_check
    const uniqueCheckStart = Date.now();
    const keyFieldsHash = hashObject({
      registrar_type_id,
      registrar_id,
      row,
    });

    const insertUniqueCheckSql = `
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
        ${escapePostgresLiteral(TEMP_SAGA_ID)}
      )
      RETURNING id
    `;

    const uniqueCheckResult = await this.sql.unsafe<Array<{ id: string }>>(
      insertUniqueCheckSql
    );
    const uniqueCheckId =
      uniqueCheckResult && uniqueCheckResult.length > 0
        ? uniqueCheckResult[0]?.id
        : null;

    if (!uniqueCheckId) {
      throw new Error("Failed to insert into bonus_registry_unique_check");
    }

    const uniqueCheckDuration = Date.now() - uniqueCheckStart;
    if (verbose) {
      console.log(
        `  ✓ Inserted into ${this.config.tables.uniqueCheck}: ${uniqueCheckId} (${uniqueCheckDuration}ms)`
      );
    }

    // 3. Генерация баланса и запись в bonus_registry_balance_check
    const balanceStart = Date.now();
    const amount = Math.floor(Math.random() * 10001); // От 0 до 10000

    const insertBalanceCheckSql = `
      INSERT INTO ${escapePostgresIdentifier(this.config.tables.balanceCheck)} (
        id,
        amount,
        "sagaId"
      )
      VALUES (
        gen_random_uuid()::text,
        ${String(amount)}::DECIMAL(20, 2),
        ${escapePostgresLiteral(TEMP_SAGA_ID)}
      )
      RETURNING id
    `;

    const balanceCheckResult = await this.sql.unsafe<Array<{ id: string }>>(
      insertBalanceCheckSql
    );
    const balanceCheckId =
      balanceCheckResult && balanceCheckResult.length > 0
        ? balanceCheckResult[0]?.id
        : null;

    if (!balanceCheckId) {
      throw new Error("Failed to insert into bonus_registry_balance_check");
    }

    const balanceDuration = Date.now() - balanceStart;
    if (verbose) {
      console.log(
        `  ✓ Inserted into ${this.config.tables.balanceCheck}: ${balanceCheckId} (amount: ${amount}, ${balanceDuration}ms)`
      );
    }

    // 4. Генерация полного объекта через bonus_registry_faker()
    const fakerStart = Date.now();
    const fakerData = bonus_registry_faker();
    const fakerDuration = Date.now() - fakerStart;
    if (verbose) {
      console.log(`  ⏱ Generated faker data (${fakerDuration}ms)`);
    }

    // 5. Формирование финального объекта для записи в Trino
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

    // 6. Запись в trino_queue
    const queueStart = Date.now();
    const queuePayload = {
      table: this.config.trino.table,
      values: finalData,
    };

    const insertQueueSql = `
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

    const queueResult = await this.sql.unsafe<Array<{ id: number }>>(
      insertQueueSql
    );
    const queueId =
      queueResult && queueResult.length > 0 ? queueResult[0]?.id : null;

    if (!queueId) {
      throw new Error("Failed to insert into trino_queue");
    }

    const queueDuration = Date.now() - queueStart;
    if (verbose) {
      console.log(
        `  ✓ Inserted into ${this.config.tables.trinoQueue}: ${queueId} (${queueDuration}ms)`
      );
    }

    return {
      registrar_type_id,
      registrar_id,
      row,
      amount,
      queueId,
    };
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
