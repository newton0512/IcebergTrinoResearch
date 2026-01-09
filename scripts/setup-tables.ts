/**
 * Скрипт для создания всех необходимых таблиц
 * 
 * Запуск: pnpm tsx scripts/setup-tables.ts
 */

import { createAllTables } from "../src/hybrid-writer-with-ps-query/create-tables.js";
import { getPostgresConfig, getTrinoConfig, connectPostgres, connectTrino } from "../src/hybrid-writer/utils.js";

async function main(): Promise<void> {
  console.log("============================================================");
  console.log("Setting up tables for HybridWriter with Queue");
  console.log("============================================================\n");

  const postgresConfig = getPostgresConfig();
  const trinoConfig = getTrinoConfig();

  const sql = await connectPostgres(postgresConfig);
  const trino = connectTrino(trinoConfig);

  try {
    await createAllTables({
      postgres: { sql },
      trino: {
        trino,
        catalog: trinoConfig.catalog,
        schema: trinoConfig.schema,
      },
    });

    console.log("\n============================================================");
    console.log("✓ Setup completed successfully");
    console.log("============================================================");
  } catch (error) {
    console.error("\n✗ Setup failed:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error("Stack:", error.stack);
    }
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
