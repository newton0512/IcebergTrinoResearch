import { HybridWriter } from "../src/hybrid-writer/hybrid-writer.js";
import {
  parseArgs,
  getHybridWriterConfig,
  connectPostgres,
  connectTrino,
  checkTables,
  type ParsedArgs,
} from "../src/hybrid-writer/utils.js";

/**
 * Основная функция
 */
async function main() {
  const { count, optimistic, useBatching, verbose, concurrency }: ParsedArgs = parseArgs();
  const config = getHybridWriterConfig();

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

    // Проверяем таблицы
    const postgresConfig = config.postgres;
    const trinoConfig = config.trino;
    const sql = await connectPostgres(postgresConfig);
    const trino = connectTrino(trinoConfig);
    
    const tablesCheck = await checkTables(
      sql,
      trino,
      {
        postgresUniqueCheck: config.tables.uniqueCheck,
        postgresBalanceCheck: config.tables.balanceCheck,
        trinoCatalog: trinoConfig.catalog,
        trinoSchema: trinoConfig.schema,
        trinoTable: trinoConfig.table,
      },
      verbose
    );
    
    if (!tablesCheck.postgresUniqueCheck) {
      console.error(`\n✗ PostgreSQL table '${config.tables.uniqueCheck}' not found!`);
      console.error("  Please create the table first using hybrid-generator-v4 or manually.");
      await sql.end();
      process.exit(1);
    }
    
    if (!tablesCheck.postgresBalanceCheck) {
      console.error(`\n✗ PostgreSQL table '${config.tables.balanceCheck}' not found!`);
      console.error("  Please create the table first using hybrid-generator-v4 or manually.");
      await sql.end();
      process.exit(1);
    }
    
    if (!tablesCheck.trinoTable) {
      console.error(`\n✗ Trino table '${trinoConfig.table}' not found!`);
      console.error("  Please create the table first using hybrid-generator-v4 or manually.");
      await sql.end();
      process.exit(1);
    }
    
    if (verbose) {
      console.log("\n✓ All required tables exist\n");
    }
    
    await sql.end();

    // Засекаем время
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    // Генерируем данные
    console.log(`Generating ${count.toLocaleString()} records...`);
    console.log();

    // Используем writeBatch для генерации с параллельностью
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

