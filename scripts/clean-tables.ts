import { HybridDataGeneratorV3 } from "../src/generator/index.js";
import type { HybridGeneratorConfigV3 } from "../src/generator/index.js";
import postgres from "postgres";

// Run: npx tsx scripts/clean-tables.ts [--drop] [--trino-only] [--postgres-only]

const args = process.argv.slice(2);
const shouldDrop = args.includes("--drop");
const trinoOnly = args.includes("--trino-only");
const postgresOnly = args.includes("--postgres-only");

const config: HybridGeneratorConfigV3 = {
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
  postgresLookupColumns: ["registrar_type_id", "registrar_id", "amount"],
  sagaBatchSize: 100000,
};

async function cleanTables() {
  const generator = new HybridDataGeneratorV3(config);
  
  try {
    await generator.connect();
    console.log("✓ Connected to databases");

    if (!trinoOnly) {
      // Очистить/удалить PostgreSQL lookup таблицу
      const sql = postgres({
        host: "localhost",
        port: 5432,
        database: "appdb",
        username: "postgres",
        password: "postgres",
      });

      try {
        if (shouldDrop) {
          await sql`DROP TABLE IF EXISTS ${sql("bonus_registry_lookup")} CASCADE`;
          console.log("✓ PostgreSQL lookup table 'bonus_registry_lookup' dropped");
        } else {
          await sql`TRUNCATE TABLE ${sql("bonus_registry_lookup")} CASCADE`;
          console.log("✓ PostgreSQL lookup table 'bonus_registry_lookup' truncated");
        }
      } finally {
        await sql.end();
      }
    }

    if (!postgresOnly) {
      // Очистить/удалить Trino таблицу
      if (shouldDrop) {
        await generator.dropTable("bonus_registry");
        console.log("✓ Trino table 'bonus_registry' dropped");
      } else {
        await generator.truncateTable("bonus_registry");
        console.log("✓ Trino table 'bonus_registry' truncated");
      }
    }

    console.log("\n✓ Tables cleaned successfully");
  } catch (error) {
    console.error("✗ Error cleaning tables:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await generator.disconnect();
  }
}

console.log("Cleaning tables...");
console.log(`Mode: ${shouldDrop ? "DROP" : "TRUNCATE"}`);
if (trinoOnly) console.log("Scope: Trino only");
if (postgresOnly) console.log("Scope: PostgreSQL only");
console.log("");

cleanTables().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

