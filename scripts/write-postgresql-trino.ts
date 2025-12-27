import postgres, { type Sql } from "postgres";
import { BasicAuth, Trino } from "trino-client";
import { SagaManager } from "../src/saga/index.js";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../src/generator/escape.js";

// Run: npx tsx scripts/write-postgresql-trino.ts

interface BonusRegistryRecord {
  id: string;
  sagaId: string;
  registrar_type_id: string;
  registrar_id: string;
  row: number;
  amount: number | null;
  createdAt: Date;
}

interface TrinoRecord {
  id: string;
  date: Date;
  registrar_type_id: string;
  registrar_id: string;
  row: number;
  manager_id: number;
  bs_profile_id: string;
  accounted_for_bs_profile_id: string;
  first_name: string;
  first_name_latin: string;
  last_name: string;
  last_name_latin: string;
  departure_id: number;
  arrival_id: number;
  departure_date: Date;
  currency_entry_id: number;
  bonus_type_id: string;
  action_source_id: string;
  bs_bonus_ticket_id: string;
  validity_time: number;
  date_of_expire: Date;
  car_type_id: string;
  express_carrier_id: number;
  carrier_id: string;
  bs_partner_id: number;
  bs_train_number_id: string;
  bs_tourism_train_id: string;
  accounted_in_calculation: boolean;
  cancelled: boolean;
  bs_quota_id: number;
  doc_to_track_type_id: string;
  doc_to_track_id: string;
  doc_to_track_date: Date;
  active_date: Date;
  trip_for_another_person: boolean;
  ticket_number: string;
  currency_amount: number;
  amount: number;
  bs_partner_bonus_type_id: string;
  express_service_class_id: number;
  date_to_cancelled: Date | null;
  prolongable: boolean;
  active_by_trips: boolean;
  is_empty: boolean;
  amount_calculation: string;
  distance: number;
  addition_amount: number;
  operation_doc_type_id: string;
  is_merged: boolean;
  merged_date: Date | null;
}

const POSTGRES_TABLE = "BonusRegistryUniqueAndBalanceCheck";
const TRINO_TABLE = "bonus_registry";
const TRINO_CATALOG = "iceberg";
const TRINO_SCHEMA = "warehouse";

const sql: Sql = postgres({
  host: "localhost",
  port: 5432,
  database: "appdb",
  username: "postgres",
  password: "postgres",
});

let trino: Trino | null = null;

/**
 * Создание функции триггера для проверки баланса
 */
async function createBalanceTrigger(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION check_balance_not_negative() 
    RETURNS TRIGGER AS $$
    BEGIN
      -- Проверяем, что balance не отрицательный (если указан)
      IF NEW.amount IS NOT NULL AND NEW.amount < 0 THEN
        RAISE EXCEPTION 'Balance cannot be negative. Value: %', 
          NEW.amount
          USING ERRCODE = '23514'; -- check_violation
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await sql.unsafe(`
    DROP TRIGGER IF EXISTS bonus_registry_balance_trigger ON "${POSTGRES_TABLE}";
  `);

  await sql.unsafe(`
    CREATE TRIGGER bonus_registry_balance_trigger
      BEFORE INSERT OR UPDATE ON "${POSTGRES_TABLE}"
      FOR EACH ROW
      WHEN (NEW.amount IS NOT NULL)
      EXECUTE FUNCTION check_balance_not_negative();
  `);

  console.log("✓ Balance trigger created");
}

/**
 * Создание таблицы в PostgreSQL
 */
async function setupPostgresTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${POSTGRES_TABLE}" (
      id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "sagaId" VARCHAR(255) NOT NULL,
      registrar_type_id VARCHAR(255) NOT NULL,
      registrar_id VARCHAR(255) NOT NULL,
      row INTEGER NOT NULL,
      amount DECIMAL(20, 2),
      "createdAt" TIMESTAMP DEFAULT NOW(),
      CONSTRAINT fk_saga FOREIGN KEY ("sagaId") REFERENCES "Saga"(id) ON DELETE CASCADE
    )
  `);

  // Создаем уникальный индекс
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_registrar 
    ON "${POSTGRES_TABLE}" (registrar_type_id, registrar_id, row)
  `);

  // Создаем индекс на sagaId
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_saga_id 
    ON "${POSTGRES_TABLE}" ("sagaId")
  `);

  await createBalanceTrigger(sql);

  console.log(`✓ PostgreSQL table '${POSTGRES_TABLE}' created`);
}

/**
 * Создание таблицы в Trino (Iceberg)
 */
async function setupTrinoTable(trino: Trino): Promise<void> {
  const fullTableName = `${escapeTrinoIdentifier(TRINO_CATALOG)}.${escapeTrinoIdentifier(TRINO_SCHEMA)}.${escapeTrinoIdentifier(TRINO_TABLE)}`;

  // Создаем схему, если не существует
  const createSchema = await trino.query(
    `CREATE SCHEMA IF NOT EXISTS ${escapeTrinoIdentifier(TRINO_CATALOG)}.${escapeTrinoIdentifier(TRINO_SCHEMA)}`
  );
  for await (const _ of createSchema) {
    // Consume query
  }

  const createTable = await trino.query(`
    CREATE TABLE IF NOT EXISTS ${fullTableName} (
      id VARCHAR,
      date TIMESTAMP,
      registrar_type_id VARCHAR,
      registrar_id VARCHAR,
      row INTEGER,
      manager_id INTEGER,
      bs_profile_id VARCHAR,
      accounted_for_bs_profile_id VARCHAR,
      first_name VARCHAR,
      first_name_latin VARCHAR,
      last_name VARCHAR,
      last_name_latin VARCHAR,
      departure_id INTEGER,
      arrival_id INTEGER,
      departure_date DATE,
      currency_entry_id INTEGER,
      bonus_type_id VARCHAR,
      action_source_id VARCHAR,
      bs_bonus_ticket_id VARCHAR,
      validity_time INTEGER,
      date_of_expire DATE,
      car_type_id VARCHAR,
      express_carrier_id INTEGER,
      carrier_id VARCHAR,
      bs_partner_id INTEGER,
      bs_train_number_id VARCHAR,
      bs_tourism_train_id VARCHAR,
      accounted_in_calculation BOOLEAN,
      cancelled BOOLEAN,
      bs_quota_id INTEGER,
      doc_to_track_type_id VARCHAR,
      doc_to_track_id VARCHAR,
      doc_to_track_date DATE,
      active_date DATE,
      trip_for_another_person BOOLEAN,
      ticket_number VARCHAR,
      currency_amount INTEGER,
      amount INTEGER,
      bs_partner_bonus_type_id VARCHAR,
      express_service_class_id INTEGER,
      date_to_cancelled TIMESTAMP,
      prolongable BOOLEAN,
      active_by_trips BOOLEAN,
      is_empty BOOLEAN,
      amount_calculation VARCHAR,
      distance INTEGER,
      addition_amount INTEGER,
      operation_doc_type_id VARCHAR,
      is_merged BOOLEAN,
      merged_date DATE
    )
    WITH (
      partitioning = ARRAY['date']
    )
  `);

  for await (const _ of createTable) {
    // Consume query
  }

  console.log(`✓ Trino table '${fullTableName}' created`);
}

/**
 * Генерация случайных данных для полей Trino
 */
function generateTrinoFields(
  _postgresRecord: BonusRegistryRecord
): Omit<TrinoRecord, "id" | "date" | "registrar_type_id" | "registrar_id" | "row" | "amount"> {
  const now = new Date();
  const randomInt = (min: number, max: number): number =>
    Math.floor(Math.random() * (max - min + 1)) + min;
  const randomString = (length: number): string =>
    Math.random().toString(36).substring(2, 2 + length);

  return {
    manager_id: randomInt(1, 1000),
    bs_profile_id: randomString(10),
    accounted_for_bs_profile_id: randomString(10),
    first_name: `FirstName${String(randomInt(1, 1000))}`,
    first_name_latin: `FirstNameLatin${String(randomInt(1, 1000))}`,
    last_name: `LastName${String(randomInt(1, 1000))}`,
    last_name_latin: `LastNameLatin${String(randomInt(1, 1000))}`,
    departure_id: randomInt(1, 100),
    arrival_id: randomInt(1, 100),
    departure_date: new Date(now.getTime() - randomInt(0, 365) * 24 * 60 * 60 * 1000),
    currency_entry_id: randomInt(1, 10),
    bonus_type_id: randomString(8),
    action_source_id: randomString(8),
    bs_bonus_ticket_id: randomString(12),
    validity_time: randomInt(30, 365),
    date_of_expire: new Date(now.getTime() + randomInt(30, 365) * 24 * 60 * 60 * 1000),
    car_type_id: randomString(5),
    express_carrier_id: randomInt(1, 50),
    carrier_id: randomString(8),
    bs_partner_id: randomInt(1, 100),
    bs_train_number_id: randomString(10),
    bs_tourism_train_id: randomString(10),
    accounted_in_calculation: Math.random() > 0.5,
    cancelled: Math.random() > 0.9,
    bs_quota_id: randomInt(1, 1000),
    doc_to_track_type_id: randomString(5),
    doc_to_track_id: randomString(10),
    doc_to_track_date: new Date(now.getTime() - randomInt(0, 180) * 24 * 60 * 60 * 1000),
    active_date: new Date(now.getTime() - randomInt(0, 30) * 24 * 60 * 60 * 1000),
    trip_for_another_person: Math.random() > 0.8,
    ticket_number: randomString(15),
    currency_amount: randomInt(100, 10000),
    bs_partner_bonus_type_id: randomString(8),
    express_service_class_id: randomInt(1, 5),
    date_to_cancelled: Math.random() > 0.9 ? new Date() : null,
    prolongable: Math.random() > 0.7,
    active_by_trips: Math.random() > 0.6,
    is_empty: Math.random() > 0.95,
    amount_calculation: randomString(20),
    distance: randomInt(100, 5000),
    addition_amount: randomInt(0, 1000),
    operation_doc_type_id: randomString(5),
    is_merged: Math.random() > 0.9,
    merged_date: Math.random() > 0.9 ? new Date() : null,
  };
}

/**
 * Запись одной записи в PostgreSQL и Trino через Saga
 */
async function writeRecord(
  sagaManager: SagaManager,
  sql: Sql,
  trino: Trino,
  record: {
    registrar_type_id: string;
    registrar_id: string;
    row: number;
    amount: number | null;
  }
): Promise<void> {
  const sagaId = await sagaManager.beginSaga({
    description: `Write bonus registry record: ${record.registrar_type_id}/${record.registrar_id}/${String(record.row)}`,
  });

  console.log(`\n[${sagaId}] Starting saga for record`);

  let postgresRecord: BonusRegistryRecord | null = null;

  // Операция 1: Запись в PostgreSQL
  sagaManager.addOperation({
    id: "insert-postgres",
    execute: async () => {
      const result = await sql<BonusRegistryRecord[]>`
        INSERT INTO ${sql(POSTGRES_TABLE)} (
          "sagaId",
          registrar_type_id,
          registrar_id,
          row,
          amount
        )
        VALUES (
          ${sagaId},
          ${record.registrar_type_id},
          ${record.registrar_id},
          ${record.row},
          ${record.amount}
        )
        RETURNING *
      `;

      if (result.length === 0) {
        throw new Error("Failed to insert record into PostgreSQL");
      }

      const insertedRecord = result[0];
      if (!insertedRecord) {
        throw new Error("Failed to insert record into PostgreSQL");
      }

      postgresRecord = insertedRecord;
      console.log(`✓ Inserted into PostgreSQL: ${postgresRecord.id}`);
      return postgresRecord;
    },
    compensate: async (data) => {
      const record = data as BonusRegistryRecord | undefined;
      if (record) {
        await sql`
          DELETE FROM ${sql(POSTGRES_TABLE)}
          WHERE id = ${record.id}
        `;
        console.log(`✓ Deleted from PostgreSQL: ${record.id} (compensation)`);
      }
    },
  });

  // Операция 2: Чтение данных обратно из PostgreSQL (для проверки)
  sagaManager.addOperation({
    id: "read-postgres",
    execute: async () => {
      if (!postgresRecord) {
        throw new Error("PostgreSQL record not found");
      }

      const result = await sql<BonusRegistryRecord[]>`
        SELECT * FROM ${sql(POSTGRES_TABLE)}
        WHERE id = ${postgresRecord.id}
      `;

      if (result.length === 0) {
        throw new Error("Record not found after insert");
      }

      const readRecord = result[0];
      if (!readRecord) {
        throw new Error("Record not found after insert");
      }

      console.log(`✓ Read from PostgreSQL: ${readRecord.id}`);
      return readRecord;
    },
    compensate: (): void => {
      // Нет необходимости в компенсации для операции чтения
      console.log("✓ Read operation compensation skipped");
    },
  });

  // Операция 3: Запись в Trino
  sagaManager.addOperation({
    id: "insert-trino",
    execute: async () => {
      if (!postgresRecord) {
        throw new Error("PostgreSQL record not found");
      }

      const trinoFields = generateTrinoFields(postgresRecord);
      const fullTableName = `${escapeTrinoIdentifier(TRINO_CATALOG)}.${escapeTrinoIdentifier(TRINO_SCHEMA)}.${escapeTrinoIdentifier(TRINO_TABLE)}`;

      // Форматируем значения для безопасной вставки
      const formatValue = (value: unknown): string => {
        if (value === null || value === undefined) return "NULL";
        if (typeof value === "string") return escapeTrinoLiteral(value);
        if (typeof value === "number") return String(value);
        if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
        if (value instanceof Date) {
          // Trino требует формат: TIMESTAMP 'YYYY-MM-DD HH:MM:SS' (без миллисекунд и 'Z')
          const dateStr = value.toISOString().replace("T", " ").replace("Z", "").split(".")[0] ?? "";
          return `TIMESTAMP '${dateStr}'`;
        }
        if (typeof value === "object") {
          try {
            return escapeTrinoLiteral(JSON.stringify(value));
          } catch {
            // Fallback для объектов, которые не могут быть сериализованы
            return escapeTrinoLiteral("[Object]");
          }
        }
        // Для примитивных типов (symbol, bigint и т.д.)
        if (typeof value === "symbol") {
          return escapeTrinoLiteral(value.toString());
        }
        if (typeof value === "bigint") {
          return String(value);
        }
        // Для остальных примитивных типов
        const primitiveValue = value as string | number | boolean;
        return escapeTrinoLiteral(String(primitiveValue));
      };

      const formatDate = (date: Date): string => {
        return `DATE '${date.toISOString().split("T")[0] ?? ""}'`;
      };

      const now = new Date();
      const amountValue =
        postgresRecord.amount !== null ? String(postgresRecord.amount) : "NULL";

      // Формируем SQL запрос с правильным форматированием всех значений
      const insertSql = `
        INSERT INTO ${fullTableName} (
          id, date, registrar_type_id, registrar_id, row, amount,
          manager_id, bs_profile_id, accounted_for_bs_profile_id,
          first_name, first_name_latin, last_name, last_name_latin,
          departure_id, arrival_id, departure_date, currency_entry_id,
          bonus_type_id, action_source_id, bs_bonus_ticket_id,
          validity_time, date_of_expire, car_type_id, express_carrier_id,
          carrier_id, bs_partner_id, bs_train_number_id, bs_tourism_train_id,
          accounted_in_calculation, cancelled, bs_quota_id,
          doc_to_track_type_id, doc_to_track_id, doc_to_track_date,
          active_date, trip_for_another_person, ticket_number,
          currency_amount, bs_partner_bonus_type_id, express_service_class_id,
          date_to_cancelled, prolongable, active_by_trips, is_empty,
          amount_calculation, distance, addition_amount,
          operation_doc_type_id, is_merged, merged_date
        ) VALUES (
          ${formatValue(postgresRecord.id)},
          ${formatValue(now)},
          ${formatValue(postgresRecord.registrar_type_id)},
          ${formatValue(postgresRecord.registrar_id)},
          ${String(postgresRecord.row)},
          ${amountValue},
          ${String(trinoFields.manager_id)},
          ${formatValue(trinoFields.bs_profile_id)},
          ${formatValue(trinoFields.accounted_for_bs_profile_id)},
          ${formatValue(trinoFields.first_name)},
          ${formatValue(trinoFields.first_name_latin)},
          ${formatValue(trinoFields.last_name)},
          ${formatValue(trinoFields.last_name_latin)},
          ${String(trinoFields.departure_id)},
          ${String(trinoFields.arrival_id)},
          ${formatDate(trinoFields.departure_date)},
          ${String(trinoFields.currency_entry_id)},
          ${formatValue(trinoFields.bonus_type_id)},
          ${formatValue(trinoFields.action_source_id)},
          ${formatValue(trinoFields.bs_bonus_ticket_id)},
          ${String(trinoFields.validity_time)},
          ${formatDate(trinoFields.date_of_expire)},
          ${formatValue(trinoFields.car_type_id)},
          ${String(trinoFields.express_carrier_id)},
          ${formatValue(trinoFields.carrier_id)},
          ${String(trinoFields.bs_partner_id)},
          ${formatValue(trinoFields.bs_train_number_id)},
          ${formatValue(trinoFields.bs_tourism_train_id)},
          ${trinoFields.accounted_in_calculation ? "TRUE" : "FALSE"},
          ${trinoFields.cancelled ? "TRUE" : "FALSE"},
          ${String(trinoFields.bs_quota_id)},
          ${formatValue(trinoFields.doc_to_track_type_id)},
          ${formatValue(trinoFields.doc_to_track_id)},
          ${formatDate(trinoFields.doc_to_track_date)},
          ${formatDate(trinoFields.active_date)},
          ${trinoFields.trip_for_another_person ? "TRUE" : "FALSE"},
          ${formatValue(trinoFields.ticket_number)},
          ${String(trinoFields.currency_amount)},
          ${formatValue(trinoFields.bs_partner_bonus_type_id)},
          ${String(trinoFields.express_service_class_id)},
          ${trinoFields.date_to_cancelled ? formatValue(trinoFields.date_to_cancelled) : "NULL"},
          ${trinoFields.prolongable ? "TRUE" : "FALSE"},
          ${trinoFields.active_by_trips ? "TRUE" : "FALSE"},
          ${trinoFields.is_empty ? "TRUE" : "FALSE"},
          ${formatValue(trinoFields.amount_calculation)},
          ${String(trinoFields.distance)},
          ${String(trinoFields.addition_amount)},
          ${formatValue(trinoFields.operation_doc_type_id)},
          ${trinoFields.is_merged ? "TRUE" : "FALSE"},
          ${trinoFields.merged_date ? formatDate(trinoFields.merged_date) : "NULL"}
        )
      `;

      const insertQuery = await trino.query(insertSql);

      // Проверяем результат
      for await (const result of insertQuery) {
        const trinoResult = result as { error?: { message: string } };
        if (trinoResult.error) {
          throw new Error(
            `Trino insert failed: ${trinoResult.error.message}`
          );
        }
      }

      console.log(`✓ Inserted into Trino: ${postgresRecord.id}`);
      return postgresRecord;
    },
    compensate: async (data) => {
      const record = data as BonusRegistryRecord | undefined;
      if (record) {
        // Удаляем из PostgreSQL по уникальным полям
        await sql`
          DELETE FROM ${sql(POSTGRES_TABLE)}
          WHERE registrar_type_id = ${record.registrar_type_id}
            AND registrar_id = ${record.registrar_id}
            AND row = ${String(record.row)}
        `;
        console.log(
          `✓ Deleted from PostgreSQL: ${record.registrar_type_id}/${record.registrar_id}/${String(record.row)} (compensation)`
        );
      }
    },
  });

  // Выполняем сагу
  try {
    const result = await sagaManager.commitSaga();
    console.log(
      `✓ Saga committed: ${result.sagaId} (${String(result.operationsCount)} operations)`
    );
  } catch (error) {
    console.error(`✗ Saga failed: ${error instanceof Error ? error.message : String(error)}`);
    // commitSaga() уже вызвал rollbackSaga() внутри при ошибке, не вызываем повторно
    throw error;
  }
}

async function main(): Promise<void> {
  console.log("Setting up PostgreSQL and Trino...");

  try {
    // Настройка PostgreSQL
    await setupPostgresTable(sql);

    // Настройка Trino
    trino = Trino.create({
      server: "http://localhost:8080",
      catalog: TRINO_CATALOG,
      schema: TRINO_SCHEMA,
      auth: new BasicAuth("trino"),
    });
    await setupTrinoTable(trino);

    // Создаем менеджер саг
    const sagaManager = new SagaManager(sql);

    // Тестовые данные
    const testRecords = [
      {
        registrar_type_id: "TYPE_1",
        registrar_id: "REG_001",
        row: 1,
        amount: 100.5,
      },
      {
        registrar_type_id: "TYPE_1",
        registrar_id: "REG_002",
        row: 1,
        amount: 200.75,
      },
      {
        registrar_type_id: "TYPE_2",
        registrar_id: "REG_001",
        row: 1,
        amount: null, // NULL amount для теста
      },
    ];

    console.log("\n=== Writing records ===");
    for (const record of testRecords) {
      try {
        await writeRecord(sagaManager, sql, trino, record);
      } catch (error) {
        console.error(
          `Failed to write record ${record.registrar_type_id}/${record.registrar_id}/${String(record.row)}:`,
          error
        );
      }
    }

    // Проверка: попытка вставить дубликат (должна упасть)
    console.log("\n=== Testing duplicate insert (should fail) ===");
    try {
      await writeRecord(sagaManager, sql, trino, {
        registrar_type_id: "TYPE_1",
        registrar_id: "REG_001",
        row: 1,
        amount: 300.0,
      });
      console.error("✗ Duplicate insert should have failed!");
    } catch (error) {
      console.log(
        `✓ Duplicate insert correctly failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Проверка: попытка вставить отрицательный баланс (должна упасть из-за триггера)
    console.log("\n=== Testing negative balance (should fail) ===");
    try {
      await writeRecord(sagaManager, sql, trino, {
        registrar_type_id: "TYPE_3",
        registrar_id: "REG_001",
        row: 1,
        amount: -100.0, // Отрицательный баланс
      });
      console.error("✗ Negative balance insert should have failed!");
    } catch (error) {
      console.log(
        `✓ Negative balance insert correctly failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    console.log("\n=== Done ===");
  } catch (error) {
    console.error("Fatal error:", error);
    throw error;
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});

