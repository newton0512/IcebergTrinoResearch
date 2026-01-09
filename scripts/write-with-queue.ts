/**
 * Скрипт для записи данных через новый HybridWriter с очередью
 * 
 * Запуск: pnpm tsx scripts/write-with-queue.ts [count] [-v|--verbose] [-d|--delete]
 * 
 * Примеры:
 *   pnpm tsx scripts/write-with-queue.ts 100
 *   pnpm tsx scripts/write-with-queue.ts 1000 -v
 *   pnpm tsx scripts/write-with-queue.ts 1000 -d
 */

import { HybridWriterWithQueue, getHybridWriterWithQueueConfig } from "../src/hybrid-writer-with-ps-query/hybrid-writer.js";
import { connectPostgres, getPostgresConfig } from "../src/hybrid-writer/utils.js";
import { escapePostgresIdentifier } from "../src/generator/escape.js";

const args = process.argv.slice(2);
const count = Number.parseInt(args.find((arg) => !arg.startsWith("-")) || "100", 10);
const verbose = args.includes("-v") || args.includes("--verbose");
const shouldDelete = args.includes("-d") || args.includes("--delete");

const log = (...args: unknown[]): void => {
  if (verbose) {
    console.log(...args);
  }
};

const logError = (...args: unknown[]): void => {
  console.error(...args);
};

/**
 * Очистка таблиц перед записью
 */
async function cleanTablesBeforeWrite(): Promise<void> {
  const postgresConfig = getPostgresConfig();
  const sql = await connectPostgres(postgresConfig);
  
  try {
    console.log("\n=== Cleaning tables ===");
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
    console.log("✓ Tables cleaned");
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  log("============================================================");
  log("HybridWriter with Queue - Write Test");
  log("============================================================");
  
  const mainStartTime = Date.now();
  
  // Очистка таблиц перед записью (если указан флаг -d)
  if (shouldDelete) {
    await cleanTablesBeforeWrite();
  }
  
  const config = getHybridWriterWithQueueConfig();
  const writer = new HybridWriterWithQueue(config);
  
  try {
    // Подключение (автоматически создаст таблицы если нужно)
    log("\n=== Connecting ===");
    const connectStart = Date.now();
    await writer.connect();
    const connectDuration = Date.now() - connectStart;
    log(`  [${connectDuration}ms] Connected`);
    
    // Запись данных
    log(`\n=== Writing ${count} records ===`);
    const writeStart = Date.now();
    
    const results = await writer.writeBatch(count, { verbose }, 10);
    
    const writeDuration = Date.now() - writeStart;
    const totalDuration = Date.now() - mainStartTime;
    
    // Статистика
    console.log("\n============================================================");
    console.log("✓ Write completed");
    console.log("============================================================");
    console.log(`  Records written: ${results.length}`);
    console.log(`  Write duration: ${writeDuration}ms`);
    console.log(`  Total duration: ${totalDuration}ms`);
    console.log(`  Average per record: ${(writeDuration / results.length).toFixed(2)}ms`);
    console.log(`  Rate: ${((results.length / writeDuration) * 1000).toFixed(2)} records/sec`);
    console.log("============================================================");
    console.log("\nNote: Records are queued in trino_queue.");
    console.log("      Make sure queue-worker.ts is running to process them.");
    console.log("");
    
  } catch (error) {
    const totalDuration = Date.now() - mainStartTime;
    logError("\n============================================================");
    logError("✗ Write failed");
    logError("============================================================");
    logError(`  Total duration: ${totalDuration}ms`);
    logError(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack && verbose) {
      logError(`  Stack: ${error.stack}`);
    }
    logError("============================================================");
    throw error;
  } finally {
    // Отключение
    log("\n=== Disconnecting ===");
    const disconnectStart = Date.now();
    await writer.disconnect();
    const disconnectDuration = Date.now() - disconnectStart;
    log(`  [${disconnectDuration}ms] Disconnected`);
  }
}

main().catch((err: unknown) => {
  logError("Fatal error:", err);
  process.exit(1);
});
