import { HybridWriter, type HybridWriterConfig } from "../src/hybrid-writer/hybrid-writer.js";

/**
 * Парсинг аргументов командной строки
 */
function parseArgs(): { count: number; optimistic: boolean; useBatching: boolean } {
  const args = process.argv.slice(2);
  let count = 100; // По умолчанию 100 записей
  let optimistic = false; // По умолчанию pessimistic режим
  let useBatching = false; // По умолчанию без батчинга

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--count" || arg === "-c") {
      const value = args[i + 1];
      if (value) {
        count = Number.parseInt(value, 10);
        if (Number.isNaN(count) || count <= 0) {
          console.error("Error: --count must be a positive number");
          process.exit(1);
        }
        i++; // Пропускаем следующий аргумент
      }
    } else if (arg === "--optimistic" || arg === "-o") {
      optimistic = true;
    } else if (arg === "--batch" || arg === "-b") {
      useBatching = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: tsx test-hybrid-writer/index.ts [options]

Options:
  --count, -c <number>     Number of records to generate (default: 100)
  --optimistic, -o         Use optimistic mode (send to RabbitMQ instead of direct Trino write)
  --batch, -b               Use batching for Trino writes (only for pessimistic mode)
  --verbose, -v             Enable verbose logging (shows details for each operation)
  --help, -h                Show this help message

Environment Variables:
  CONCURRENCY               Number of parallel writes (default: 20)
                           Higher values increase throughput but may overload the system
  BATCH_SIZE                Batch size for Trino INSERT operations (default: 10)
                           Only used when --batch flag is set

Examples:
  tsx test-hybrid-writer/index.ts --count 1000
  tsx test-hybrid-writer/index.ts --count 500 --optimistic
  tsx test-hybrid-writer/index.ts -c 100 -o
  tsx test-hybrid-writer/index.ts --count 1000 --batch
  CONCURRENCY=50 tsx test-hybrid-writer/index.ts --count 1000 --optimistic
  tsx test-hybrid-writer/index.ts --count 100 --verbose
      `);
      process.exit(0);
    }
  }

  return { count, optimistic, useBatching };
}

/**
 * Конфигурация для HybridWriter
 */
function getConfig(): HybridWriterConfig {
  return {
    postgres: {
      host: process.env.POSTGRES_HOST || "localhost",
      port: Number.parseInt(process.env.POSTGRES_PORT || "5432", 10),
      database: process.env.POSTGRES_DB || "appdb",
      username: process.env.POSTGRES_USER || "postgres",
      password: process.env.POSTGRES_PASSWORD || "postgres",
    },
    trino: {
      host: process.env.TRINO_HOST || "localhost",
      port: Number.parseInt(process.env.TRINO_PORT || "8080", 10),
      catalog: process.env.TRINO_CATALOG || "iceberg",
      schema: process.env.TRINO_SCHEMA || "warehouse",
      user: process.env.TRINO_USER || "trino",
      table: process.env.TRINO_TABLE || "bonus_registry",
    },
    rabbitmq: {
      host: process.env.RABBITMQ_HOST || "localhost",
      port: Number.parseInt(process.env.RABBITMQ_PORT || "5672", 10),
      username: process.env.RABBITMQ_USERNAME || "guest",
      password: process.env.RABBITMQ_PASSWORD || "guest",
      queue: process.env.RABBITMQ_QUEUE || "bonus_registry_queue",
    },
    tables: {
      uniqueCheck: "bonus_registry_unique_check",
      balanceCheck: "bonus_registry_balance_check",
    },
  };
}

/**
 * Основная функция
 */
async function main() {
  const { count, optimistic, useBatching } = parseArgs();
  const config = getConfig();

  console.log("=".repeat(60));
  console.log("Hybrid Writer Test");
  console.log("=".repeat(60));
  console.log(`Mode: ${optimistic ? "OPTIMISTIC (RabbitMQ)" : "PESSIMISTIC (Direct Trino)"}`);
  console.log(`Records to generate: ${count.toLocaleString()}`);
  console.log(`PostgreSQL: ${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`);
  console.log(`Trino: ${config.trino.host}:${config.trino.port} (${config.trino.catalog}.${config.trino.schema}.${config.trino.table})`);
  if (optimistic) {
    console.log(`RabbitMQ: ${config.rabbitmq!.host}:${config.rabbitmq!.port} (queue: ${config.rabbitmq!.queue})`);
    console.log("\n⚠️  IMPORTANT: Make sure the worker is running!");
    console.log("   Run: pnpm run worker");
  }
  console.log("=".repeat(60));
  console.log();

  const writer = new HybridWriter(config);

  try {
    // Подключаемся
    console.log("Connecting to services...");
    await writer.connect();
    console.log("✓ Connected\n");

    // Засекаем время
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    // Генерируем данные
    console.log(`Generating ${count.toLocaleString()} records...`);
    console.log();

    // Используем writeBatch для генерации с параллельностью
    // По умолчанию verbose=false для лучшей производительности
    const concurrency = Number.parseInt(process.env.CONCURRENCY || "20", 10);
    const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
    
    console.log(`Concurrency: ${concurrency} parallel writes`);
    if (!optimistic && useBatching) {
      const batchSize = Number.parseInt(process.env.BATCH_SIZE || "10", 10);
      console.log(`Batch size: ${batchSize} records per Trino INSERT`);
    }
    console.log(`Verbose logging: ${verbose ? "enabled" : "disabled"}`);
    console.log();
    
    const results = await writer.writeBatch(count, { optimistic, verbose, useBatching }, concurrency);

    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;

    // Выводим статистику
    console.log();
    console.log("=".repeat(60));
    console.log("Results");
    console.log("=".repeat(60));
    console.log(`Total records: ${results.length.toLocaleString()}`);
    console.log(`Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`Average time per record: ${(duration / results.length).toFixed(2)}ms`);
    console.log(`Throughput: ${((results.length / duration) * 1000).toFixed(2)} records/sec`);

    // Статистика по памяти
    const memoryUsed = endMemory.heapUsed - startMemory.heapUsed;
    console.log(`Memory used: ${(memoryUsed / 1024 / 1024).toFixed(2)} MB`);

    // Статистика по режимам
    const optimisticCount = results.filter((r) => r.optimistic).length;
    const pessimisticCount = results.filter((r) => !r.optimistic).length;
    console.log(`Optimistic records: ${optimisticCount.toLocaleString()}`);
    console.log(`Pessimistic records: ${pessimisticCount.toLocaleString()}`);

    console.log("=".repeat(60));

    // Отключаемся
    await writer.disconnect();
    console.log("\n✓ Disconnected");
    
    // Явно завершаем процесс
    process.exit(0);
  } catch (error) {
    console.error("\n✗ Error:", error);
    await writer.disconnect().catch(() => {
      // Игнорируем ошибки при отключении
    });
    process.exit(1);
  }
}

// Запускаем
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});

