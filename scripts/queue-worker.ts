/**
 * Воркер для обработки очереди trino_queue
 * 
 * Запуск: pnpm tsx scripts/queue-worker.ts [--interval 2000] [--batch-size 5000]
 * 
 * Параметры:
 *   --interval <ms>     - Интервал между обработками батчей в миллисекундах (по умолчанию 2000)
 *   --batch-size <num>  - Количество записей, выбираемых из очереди за раз (по умолчанию 5000)
 *   --verbose, -v      - Подробный вывод логов
 * 
 * Воркер каждые N миллисекунд выбирает записи из trino_queue
 * и отправляет их батчами в Trino/Iceberg
 */

import { createAndStartWorker } from "../src/hybrid-writer-with-ps-query/queue-worker.js";

const args = process.argv.slice(2);

// Парсинг --interval
const intervalIndex = args.indexOf("--interval");
const batchIntervalMs = intervalIndex >= 0 && args[intervalIndex + 1]
  ? Number.parseInt(args[intervalIndex + 1], 10)
  : 2000;

// Парсинг --batch-size
const batchSizeIndex = args.indexOf("--batch-size");
const batchSize = batchSizeIndex >= 0 && args[batchSizeIndex + 1]
  ? Number.parseInt(args[batchSizeIndex + 1], 10)
  : 5000;

const verbose = args.includes("--verbose") || args.includes("-v");

console.log("============================================================");
console.log("Queue Worker - Processing trino_queue");
console.log("============================================================");
console.log(`Batch interval: ${batchIntervalMs}ms`);
console.log(`Batch size: ${batchSize} records`);
console.log(`Verbose: ${verbose}`);
console.log("Press Ctrl+C to stop");
console.log("============================================================\n");

createAndStartWorker({
  batchIntervalMs,
  batchSize,
  verbose,
}).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
