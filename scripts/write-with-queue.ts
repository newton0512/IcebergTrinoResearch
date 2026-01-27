/**
 * Скрипт для записи данных через HybridWriter с очередью.
 * Работает непрерывно до прерывания (Ctrl+C).
 *
 * Параметры:
 *   --pause-from, --pause-to    пауза между батчами, мс (default: 100..2000)
 *   --batch-from, --batch-to    размер батча, кол-во записей (default: 100..2000)
 *   -d, --delete                очистить таблицы перед стартом
 *
 * Запуск: pnpm tsx scripts/write-with-queue.ts [options]
 *
 * Примеры:
 *   pnpm tsx scripts/write-with-queue.ts
 *   pnpm tsx scripts/write-with-queue.ts --pause-from 50 --pause-to 500 --batch-from 50 --batch-to 500
 *   pnpm tsx scripts/write-with-queue.ts -d
 */

import { HybridWriterWithQueue, getHybridWriterWithQueueConfig } from "../src/hybrid-writer-with-ps-query/hybrid-writer.js";
import { connectPostgres, getPostgresConfig } from "../src/hybrid-writer/utils.js";

function parseArg(name: string, defaultValue: number): number {
  const re = new RegExp(`^--${name}=(\\d+)$`, "i");
  for (const a of process.argv.slice(2)) {
    const m = a.match(re);
    const v = m?.[1];
    if (v) return Number.parseInt(v, 10);
  }
  return defaultValue;
}

const pauseFrom = parseArg("pause-from", 100);
const pauseTo = parseArg("pause-to", 2000);
const batchFrom = parseArg("batch-from", 100);
const batchTo = parseArg("batch-to", 2000);
const shouldDelete = process.argv.includes("-d") || process.argv.includes("--delete");

const logError = (...args: unknown[]): void => {
  console.error(...args);
};

function randomInt(from: number, to: number): number {
  return Math.floor(Math.random() * (to - from + 1)) + from;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  console.log("============================================================");
  console.log("HybridWriter with Queue — continuous write (Ctrl+C to stop)");
  console.log("============================================================");
  console.log(`  pause: ${String(pauseFrom)}..${String(pauseTo)} ms`);
  console.log(`  batch: ${String(batchFrom)}..${String(batchTo)} records`);
  console.log("============================================================\n");

  if (shouldDelete) {
    await cleanTablesBeforeWrite();
  }

  const config = getHybridWriterWithQueueConfig();
  const writer = new HybridWriterWithQueue(config);

  let stopped = false;

  const onSignal = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    console.log("\n\nStopping... (Ctrl+C again to force)");
    try {
      await writer.disconnect();
      console.log("Disconnected.");
    } catch (e) {
      logError("Disconnect error:", e);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void onSignal();
  });
  process.on("SIGTERM", () => {
    void onSignal();
  });

  try {
    const connectStart = Date.now();
    await writer.connect();
    console.log(`[${String(Date.now() - connectStart)}ms] Connected\n`);

    let round = 0;
    let totalWritten = 0;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- stopped is set by SIGINT/SIGTERM handler
    while (!stopped) {
      round += 1;
      const batchSize = randomInt(batchFrom, batchTo);
      const pauseMs = randomInt(pauseFrom, pauseTo);

      console.log(`[round ${String(round)}] batch=${String(batchSize)} pause=${String(pauseMs)}ms — writing...`);

      const writeStart = Date.now();
      const results = await writer.writeBatch(batchSize, { verbose: true }, 10);
      const writeDuration = Date.now() - writeStart;
      const ok = results.length;
      const err = batchSize - ok;
      totalWritten += ok;

      console.log(
        `[round ${String(round)}] done: ${String(ok)} records in ${String(writeDuration)}ms` +
          (err > 0 ? `, ${String(err)} errors` : "") +
          ` | total written: ${String(totalWritten)}`
      );
      console.log(`[round ${String(round)}] waiting ${String(pauseMs)}ms...\n`);

      await sleep(pauseMs);
    }
  } catch (error) {
    logError("\n============================================================");
    logError("✗ Write failed");
    logError("============================================================");
    logError(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    logError(`  Stack: ${error instanceof Error ? (error.stack ?? "") : ""}`);
    logError("============================================================");
    throw error;
  } finally {
    await writer.disconnect();
  }
}

main().catch((err: unknown) => {
  logError("Fatal error:", err);
  process.exit(1);
});
