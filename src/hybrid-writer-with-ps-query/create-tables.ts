/**
 * Файл для создания таблиц в PostgreSQL и Trino/Iceberg
 * 
 * Создает следующие таблицы:
 * - PostgreSQL: bonus_registry_unique_check, bonus_registry_balance_check, Saga, временная таблица для батчей
 * - Trino/Iceberg: bonus_registry
 */

import type { Sql } from "postgres";
import { Trino } from "trino-client";
import {
  escapePostgresIdentifier,
  escapeTrinoIdentifier,
} from "../generator/escape.js";

/**
 * Конфигурация для создания таблиц
 */
export interface CreateTablesConfig {
  postgres: {
    sql: Sql;
  };
  trino: {
    trino: Trino;
    catalog: string;
    schema: string;
  };
}

/**
 * Создает таблицу bonus_registry_unique_check в PostgreSQL
 */
export async function createBonusRegistryUniqueCheckTable(
  sql: Sql
): Promise<void> {
  const tableName = "bonus_registry_unique_check";
  const escapedTableName = escapePostgresIdentifier(tableName);

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS ${escapedTableName} (
      id TEXT PRIMARY KEY,
      name_of_uniqueness TEXT NOT NULL,
      key_fields_hash TEXT NOT NULL,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "sagaId" TEXT
    )
  `;

  await sql.unsafe(createTableSql);

  // Создаем уникальный индекс
  const indexName = "idx_bonus_registry_unique_check_key_hash_name";
  const createIndexSql = `
    CREATE UNIQUE INDEX IF NOT EXISTS ${escapePostgresIdentifier(indexName)}
    ON ${escapedTableName} (key_fields_hash, name_of_uniqueness)
  `;

  await sql.unsafe(createIndexSql);
}

/**
 * Создает таблицу bonus_registry_balance_check в PostgreSQL
 */
export async function createBonusRegistryBalanceCheckTable(
  sql: Sql
): Promise<void> {
  const tableName = "bonus_registry_balance_check";
  const escapedTableName = escapePostgresIdentifier(tableName);

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS ${escapedTableName} (
      id TEXT PRIMARY KEY,
      amount DECIMAL(20, 2),
      "sagaId" TEXT
    )
  `;

  await sql.unsafe(createTableSql);

  // Создаем триггер для проверки баланса
  const triggerName = `${tableName}_balance_trigger`;
  const functionName = `check_balance_not_negative_${tableName.replace(/[^a-zA-Z0-9]/g, "_")}`;

  // Создаем функцию триггера
  const createFunctionSql = `
    CREATE OR REPLACE FUNCTION ${escapePostgresIdentifier(functionName)}() 
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.amount IS NOT NULL AND NEW.amount < 0 THEN
        RAISE EXCEPTION 'Balance cannot be negative. Value: %', 
          NEW.amount
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  await sql.unsafe(createFunctionSql);

  // Создаем триггер
  const createTriggerSql = `
    DROP TRIGGER IF EXISTS ${escapePostgresIdentifier(triggerName)} ON ${escapedTableName};
    CREATE TRIGGER ${escapePostgresIdentifier(triggerName)}
    BEFORE INSERT OR UPDATE ON ${escapedTableName}
    FOR EACH ROW
    EXECUTE FUNCTION ${escapePostgresIdentifier(functionName)}();
  `;

  await sql.unsafe(createTriggerSql);
}

/**
 * Создает таблицу Saga в PostgreSQL
 */
export async function createSagaTable(sql: Sql): Promise<void> {
  const tableName = "Saga";
  const escapedTableName = escapePostgresIdentifier(tableName);

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS ${escapedTableName} (
      id VARCHAR(255) PRIMARY KEY,
      status VARCHAR(50) NOT NULL,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql.unsafe(createTableSql);

  // Создаем индексы
  const statusIndexSql = `
    CREATE INDEX IF NOT EXISTS idx_saga_status ON ${escapedTableName}(status)
  `;
  await sql.unsafe(statusIndexSql);

  const createdAtIndexSql = `
    CREATE INDEX IF NOT EXISTS idx_saga_created_at ON ${escapedTableName}("createdAt")
  `;
  await sql.unsafe(createdAtIndexSql);
}

/**
 * Создает временную таблицу для батчей в PostgreSQL
 * 
 * @param sql - PostgreSQL соединение
 * @param tableName - Имя временной таблицы (должно быть уникальным)
 * @param tempColumns - Массив имен колонок из основной таблицы bonus_registry
 */
export async function createTempTableForBatch(
  sql: Sql,
  tableName: string,
  tempColumns: string[] = ["registrar_type_id", "registrar_id", "row", "amount"]
): Promise<void> {
  const escapedTableName = escapePostgresIdentifier(tableName);

  // Определяем типы для колонок
  const columnDefs = [
    "id VARCHAR(255) PRIMARY KEY",
    "row_number BIGINT NOT NULL",
    ...tempColumns.map((col) => {
      // Определяем тип колонки на основе имени
      if (col === "registrar_type_id" || col === "registrar_id") {
        return `${escapePostgresIdentifier(col)} TEXT`;
      } else if (col === "row") {
        return `${escapePostgresIdentifier(col)} INTEGER`;
      } else if (col === "amount") {
        return `${escapePostgresIdentifier(col)} DECIMAL(20, 2)`;
      } else {
        return `${escapePostgresIdentifier(col)} TEXT`;
      }
    }),
  ].join(", ");

  const createTableSql = `
    CREATE TABLE ${escapedTableName} (
      ${columnDefs}
    )
  `;

  await sql.unsafe(createTableSql);
}

/**
 * Создает таблицу bonus_registry в Trino/Iceberg
 */
export async function createBonusRegistryTableInTrino(
  trino: Trino,
  catalog: string,
  schema: string
): Promise<void> {
  const tableName = "bonus_registry";
  const escapedCatalog = escapeTrinoIdentifier(catalog);
  const escapedSchema = escapeTrinoIdentifier(schema);
  const escapedTable = escapeTrinoIdentifier(tableName);
  const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

  // Определение всех колонок таблицы bonus_registry
  const columns = [
    "id VARCHAR",
    '"date" TIMESTAMP',
    "registrar_type_id VARCHAR",
    "registrar_id VARCHAR",
    '"row" INTEGER',
    "manager_id INTEGER",
    "bs_profile_id VARCHAR NOT NULL",
    "accounted_for_bs_profile_id VARCHAR NOT NULL",
    "first_name VARCHAR",
    "first_name_latin VARCHAR",
    "last_name VARCHAR",
    "last_name_latin VARCHAR",
    "departure_id INTEGER",
    "arrival_id INTEGER",
    "departure_date DATE",
    "currency_entry_id INTEGER",
    "bonus_type_id VARCHAR NOT NULL",
    "action_source_id VARCHAR NOT NULL",
    "bs_bonus_ticket_id VARCHAR",
    "validity_time INTEGER",
    "date_of_expire DATE",
    "car_type_id VARCHAR",
    "express_carrier_id INTEGER",
    "carrier_id VARCHAR",
    "bs_partner_id INTEGER",
    "bs_train_number_id VARCHAR",
    "bs_tourism_train_id VARCHAR",
    "accounted_in_calculation BOOLEAN",
    "cancelled BOOLEAN",
    "bs_quota_id INTEGER",
    "doc_to_track_type_id VARCHAR NOT NULL",
    "doc_to_track_id VARCHAR NOT NULL",
    "doc_to_track_date DATE",
    "active_date DATE",
    "trip_for_another_person BOOLEAN",
    "ticket_number VARCHAR",
    "currency_amount INTEGER",
    "amount INTEGER NOT NULL",
    "bs_partner_bonus_type_id VARCHAR",
    "express_service_class_id INTEGER",
    "date_to_cancelled TIMESTAMP",
    "prolongable BOOLEAN",
    "active_by_trips BOOLEAN",
    "is_empty BOOLEAN",
    "amount_calculation VARCHAR",
    "distance INTEGER",
    "addition_amount INTEGER",
    "operation_doc_type_id VARCHAR",
    "is_merged BOOLEAN",
    "merged_date DATE",
  ].join(", ");

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS ${fullTableName} (
      ${columns}
    ) WITH (format = 'PARQUET')
  `;

  const query = await trino.query(createTableSql);
  
  // Потребляем результаты запроса
  for await (const _ of query) {
    // Игнорируем результаты
  }
}

/**
 * Создает таблицу trino_queue в PostgreSQL для хранения операций
 */
export async function createTrinoQueueTable(sql: Sql): Promise<void> {
  const tableName = "trino_queue";
  const escapedTableName = escapePostgresIdentifier(tableName);

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS ${escapedTableName} (
      id BIGSERIAL PRIMARY KEY,
      operation_type VARCHAR(10) NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    )
  `;

  await sql.unsafe(createTableSql);

  // Создаем индекс на created_at для быстрого выборки по времени
  const indexSql = `
    CREATE INDEX IF NOT EXISTS idx_trino_queue_created_at 
    ON ${escapedTableName}(created_at)
  `;
  await sql.unsafe(indexSql);
}

/**
 * Создает все необходимые таблицы в PostgreSQL и Trino/Iceberg
 */
export async function createAllTables(
  config: CreateTablesConfig
): Promise<void> {
  const { postgres, trino } = config;

  console.log("Creating PostgreSQL tables...");
  
  // Создаем таблицу Saga первой, так как другие таблицы могут ссылаться на неё
  await createSagaTable(postgres.sql);
  console.log("✓ Created Saga table");

  await createBonusRegistryUniqueCheckTable(postgres.sql);
  console.log("✓ Created bonus_registry_unique_check table");

  await createBonusRegistryBalanceCheckTable(postgres.sql);
  console.log("✓ Created bonus_registry_balance_check table");

  await createTrinoQueueTable(postgres.sql);
  console.log("✓ Created trino_queue table");

  // Создаем внешние ключи (если таблица Saga существует)
  // PostgreSQL не поддерживает IF NOT EXISTS для ADD CONSTRAINT, поэтому проверяем существование
  try {
    const fkExists = await postgres.sql.unsafe<{ count: number }[]>(`
      SELECT COUNT(*) as count
      FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_bonus_registry_unique_check_saga'
      AND table_name = 'bonus_registry_unique_check'
    `);
    
    if (fkExists[0]?.count === 0) {
      await postgres.sql.unsafe(`
        ALTER TABLE ${escapePostgresIdentifier("bonus_registry_unique_check")}
        ADD CONSTRAINT fk_bonus_registry_unique_check_saga
        FOREIGN KEY ("sagaId") REFERENCES ${escapePostgresIdentifier("Saga")}(id) ON DELETE CASCADE
      `);
      console.log("✓ Created foreign key for bonus_registry_unique_check.sagaId");
    } else {
      console.log("✓ Foreign key for bonus_registry_unique_check.sagaId already exists");
    }
  } catch (error) {
    console.warn("⚠ Could not create foreign key for bonus_registry_unique_check.sagaId:", error instanceof Error ? error.message : String(error));
  }

  try {
    const fkExists = await postgres.sql.unsafe<{ count: number }[]>(`
      SELECT COUNT(*) as count
      FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_bonus_registry_balance_check_saga'
      AND table_name = 'bonus_registry_balance_check'
    `);
    
    if (fkExists[0]?.count === 0) {
      await postgres.sql.unsafe(`
        ALTER TABLE ${escapePostgresIdentifier("bonus_registry_balance_check")}
        ADD CONSTRAINT fk_bonus_registry_balance_check_saga
        FOREIGN KEY ("sagaId") REFERENCES ${escapePostgresIdentifier("Saga")}(id) ON DELETE CASCADE
      `);
      console.log("✓ Created foreign key for bonus_registry_balance_check.sagaId");
    } else {
      console.log("✓ Foreign key for bonus_registry_balance_check.sagaId already exists");
    }
  } catch (error) {
    console.warn("⚠ Could not create foreign key for bonus_registry_balance_check.sagaId:", error instanceof Error ? error.message : String(error));
  }

  console.log("\nCreating Trino/Iceberg tables...");
  await createBonusRegistryTableInTrino(trino.trino, trino.catalog, trino.schema);
  console.log("✓ Created bonus_registry table in Trino/Iceberg");

  console.log("\n✓ All tables created successfully");
}
