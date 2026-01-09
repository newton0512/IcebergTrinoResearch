import { HybridDataGeneratorV4 } from "../generator/index.js";
import type { HybridGeneratorConfigV4 } from "../generator/index.js";
import postgres from "postgres";

// Run: npx tsx scripts/clean-tables.ts [--drop] [--trino-only] [--postgres-only] [--v4] [--v3]

const args = process.argv.slice(2);
const shouldDrop = args.includes("--drop");
const trinoOnly = args.includes("--trino-only");
const postgresOnly = args.includes("--postgres-only");
const v4 = args.includes("--v4");
const v3 = args.includes("--v3");
// По умолчанию очищаем оба варианта, если не указан конкретный
const cleanV3 = !v4 || v3;
const cleanV4 = !v3 || v4;

async function cleanTables(): Promise<void> {
  // Используем V4 генератор для подключения к Trino (он имеет те же методы)
  const configV4: HybridGeneratorConfigV4 = {
    postgresConfig: {
      host: "localhost",
      port: 5432,
      database: "appdb",
      username: "postgres",
      password: "postgres",
    },
    trinoConfig: {
      host: "localhost",
      port: 8080,
      catalog: "iceberg",
      schema: "warehouse",
      user: "trino",
    },
    postgresColumnMapping: [],
    trinoColumnMapping: [],
    postgresTableName: "bonus_registry_lookup",
    trinoTableName: "bonus_registry",
    tempTableColumns: ["registrar_type_id", "registrar_id", "row", "amount"],
    uniqueCheckTableName: "bonus_registry_unique_check",
    balanceCheckTableName: "bonus_registry_balance_check",
    sagaBatchSize: 100000,
  };
  
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const generator = new HybridDataGeneratorV4(configV4);
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await generator.connect();
    console.log("✓ Connected to databases");

    if (!trinoOnly) {
      const sql = postgres({
        host: "localhost",
        port: 5432,
        database: "appdb",
        username: "postgres",
        password: "postgres",
      });

      try {
        // Очистка таблиц для V3
        if (cleanV3) {
          if (shouldDrop) {
            await sql`DROP TABLE IF EXISTS ${sql("bonus_registry_lookup")} CASCADE`;
            console.log("✓ PostgreSQL lookup table 'bonus_registry_lookup' dropped (V3)");
          } else {
            // TRUNCATE не поддерживает IF EXISTS, проверяем существование через DO блок
            await sql.unsafe(`
              DO $$
              BEGIN
                IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bonus_registry_lookup') THEN
                  TRUNCATE TABLE bonus_registry_lookup CASCADE;
                END IF;
              END $$;
            `);
            console.log("✓ PostgreSQL lookup table 'bonus_registry_lookup' truncated (V3)");
          }
        }

        // Очистка таблиц для V4
        if (cleanV4) {
          // Check таблицы
          if (shouldDrop) {
            await sql`DROP TABLE IF EXISTS ${sql("bonus_registry_unique_check")} CASCADE`;
            await sql`DROP TABLE IF EXISTS ${sql("bonus_registry_balance_check")} CASCADE`;
            await sql`DROP TABLE IF EXISTS ${sql("trino_queue")} CASCADE`;
            console.log("✓ PostgreSQL check tables and queue dropped (V4)");
          } else {
            // TRUNCATE не поддерживает IF EXISTS, проверяем существование через DO блок
            await sql.unsafe(`
              DO $$
              BEGIN
                IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bonus_registry_unique_check') THEN
                  TRUNCATE TABLE bonus_registry_unique_check CASCADE;
                END IF;
                IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bonus_registry_balance_check') THEN
                  TRUNCATE TABLE bonus_registry_balance_check CASCADE;
                END IF;
                IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'trino_queue') THEN
                  TRUNCATE TABLE trino_queue CASCADE;
                END IF;
              END $$;
            `);
            console.log("✓ PostgreSQL check tables and queue truncated (V4)");
          }

          // Удаление временных таблиц (всегда DROP, так как они временные)
          await sql.unsafe(`
            DO $$
            DECLARE
                r RECORD;
            BEGIN
                FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'temp_bonus_registry_%') 
                LOOP
                    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
                END LOOP;
            END $$;
          `);
          console.log("✓ Temporary tables cleaned (V4)");
        }
      } finally {
        await sql.end();
      }
    }

    if (!postgresOnly) {
      // Очистить/удалить Trino таблицу (общая для V3 и V4)
      if (shouldDrop) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        await generator.dropTable("bonus_registry");
        console.log("✓ Trino table 'bonus_registry' dropped");
      } else {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          await generator.truncateTable("bonus_registry");
          console.log("✓ Trino table 'bonus_registry' truncated");
        } catch (error: unknown) {
          // Если таблица не существует, это нормально
          if (error instanceof Error && error.message.includes("does not exist")) {
            console.log("ℹ Trino table 'bonus_registry' does not exist (skipping)");
          } else {
            throw error;
          }
        }
      }
    }

    console.log("\n✓ Tables cleaned successfully");
  } catch (error: unknown) {
    console.error("✗ Error cleaning tables:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await generator.disconnect();
  }
}

console.log("Cleaning tables...");
console.log(`Mode: ${shouldDrop ? "DROP" : "TRUNCATE"}`);
if (trinoOnly) console.log("Scope: Trino only");
if (postgresOnly) console.log("Scope: PostgreSQL only");
if (cleanV3) console.log("Including: Hybrid V3 tables");
if (cleanV4) console.log("Including: Hybrid V4 tables");
console.log("");

cleanTables().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

