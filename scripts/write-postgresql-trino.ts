import { HybridWriter } from "../src/hybrid-writer/hybrid-writer.js";
import {
  getPostgresConfig,
  getTrinoConfig,
  connectPostgres,
  connectTrino,
  checkTables,
} from "../src/hybrid-writer/utils.js";

// Run: pnpm tsx scripts/write-postgresql-trino.ts [-v|--verbose]

// Парсим аргументы командной строки
const args = process.argv.slice(2);
const verbose = args.includes("-v") || args.includes("--verbose");

// Функция для условного логирования
const log = (...args: unknown[]): void => {
  if (verbose) {
    console.log(...args);
  }
};

const logError = (...args: unknown[]): void => {
  // Ошибки всегда выводим
  console.error(...args);
};

const POSTGRES_UNIQUE_CHECK_TABLE = "bonus_registry_unique_check";
const POSTGRES_BALANCE_CHECK_TABLE = "bonus_registry_balance_check";
const TRINO_TABLE = "bonus_registry";


/**
 * Запись одной записи с детальными измерениями времени
 */
async function writeSingleRecord(writer: HybridWriter): Promise<void> {
  log("\n=== Writing single record ===");
  
  const totalStartTime = Date.now();
  
  // Выполняем запись через HybridWriter (pessimistic режим)
  // Все измерения времени будут внутри write() с verbose=verbose
  // HybridWriter уже логирует время для каждого шага:
  // - Открытие саги (beginSaga)
  // - Генерация registrar данных (generateRegistrarObject)
  // - Запись в bonus_registry_unique_check
  // - Генерация баланса
  // - Запись в bonus_registry_balance_check
  // - Вызов bonus_registry_faker()
  // - Запись в Trino/Iceberg
  // - Завершение саги (commitSaga)
  log("\nExecuting write operation with detailed timing...");
  const writeStartTime = Date.now();
  
  try {
    const result = await writer.write({
      optimistic: false, // Pessimistic режим - запись напрямую в Trino
      verbose: verbose, // Используем флаг verbose из командной строки
    });
    
    const writeDuration = Date.now() - writeStartTime;
    const totalDuration = Date.now() - totalStartTime;
    
    log("\n=== Write operation summary ===");
    log(`  Total write duration: ${writeDuration}ms`);
    log(`  Total execution time: ${totalDuration}ms`);
    log("  Result:", {
      sagaId: result.sagaId,
      registrar_type_id: result.registrar_type_id,
      registrar_id: result.registrar_id,
      row: result.row,
      amount: result.amount,
      optimistic: result.optimistic,
    });
    log("\n  Note: Detailed timing for each step is shown above in the verbose logs.");
  } catch (error) {
    const writeDuration = Date.now() - writeStartTime;
    const totalDuration = Date.now() - totalStartTime;
    
    logError("\n=== Write operation failed ===");
    logError(`  Write duration: ${writeDuration}ms`);
    logError(`  Total duration: ${totalDuration}ms`);
    logError(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack && verbose) {
      logError(`  Stack: ${error.stack}`);
    }
    // Не пробрасываем ошибку дальше - скрипт должен завершиться успешно
    // Сага уже откатилась в методе write()
    logError("  Note: Saga has been rolled back successfully.");
  }
}

async function main(): Promise<void> {
  log("============================================================");
  log("PostgreSQL + Trino Write Test");
  log("============================================================");
  
  const mainStartTime = Date.now();
  
  const postgresConfig = getPostgresConfig();
  const trinoConfig = getTrinoConfig();
  
  let sql = null;
  let trino: ReturnType<typeof connectTrino> | null = null;
  let writer: HybridWriter | null = null;
  
  try {
    // Подключение к PostgreSQL
    log("\n=== Connecting to PostgreSQL ===");
    const pgConnectStart = Date.now();
    sql = await connectPostgres(postgresConfig);
    const pgConnectDuration = Date.now() - pgConnectStart;
    log(`  [${pgConnectDuration}ms] PostgreSQL connected`);
    
    // Подключение к Trino
    log("\n=== Connecting to Trino ===");
    const trinoConnectStart = Date.now();
    trino = connectTrino(trinoConfig);
    const trinoConnectDuration = Date.now() - trinoConnectStart;
    log(`  [${trinoConnectDuration}ms] Trino connected`);
    
    // Проверка таблиц
    const tablesCheck = await checkTables(
      sql,
      trino,
      {
        postgresUniqueCheck: POSTGRES_UNIQUE_CHECK_TABLE,
        postgresBalanceCheck: POSTGRES_BALANCE_CHECK_TABLE,
        trinoCatalog: trinoConfig.catalog,
        trinoSchema: trinoConfig.schema,
        trinoTable: TRINO_TABLE,
      },
      verbose
    );
    
    if (!tablesCheck.postgresUniqueCheck) {
      logError(`\n✗ PostgreSQL table '${POSTGRES_UNIQUE_CHECK_TABLE}' not found!`);
      logError("  Please create the table first using hybrid-generator-v4 or manually.");
      process.exit(1);
    }
    
    if (!tablesCheck.postgresBalanceCheck) {
      logError(`\n✗ PostgreSQL table '${POSTGRES_BALANCE_CHECK_TABLE}' not found!`);
      logError("  Please create the table first using hybrid-generator-v4 or manually.");
      process.exit(1);
    }
    
    if (!tablesCheck.trinoTable) {
      logError(`\n✗ Trino table '${TRINO_TABLE}' not found!`);
      logError("  Please create the table first using hybrid-generator-v4 or manually.");
      process.exit(1);
    }
    
    log("\n✓ All required tables exist");
    
    // Создание HybridWriter
    log("\n=== Creating HybridWriter ===");
    const writerCreateStart = Date.now();
    writer = new HybridWriter({
      postgres: postgresConfig,
      trino: {
        ...trinoConfig,
        table: TRINO_TABLE,
      },
      tables: {
        uniqueCheck: POSTGRES_UNIQUE_CHECK_TABLE,
        balanceCheck: POSTGRES_BALANCE_CHECK_TABLE,
      },
    });
    const writerCreateDuration = Date.now() - writerCreateStart;
    log(`  [${writerCreateDuration}ms] HybridWriter created`);
    
    // Подключение HybridWriter
    log("\n=== Connecting HybridWriter ===");
    const writerConnectStart = Date.now();
    await writer.connect();
    const writerConnectDuration = Date.now() - writerConnectStart;
    log(`  [${writerConnectDuration}ms] HybridWriter connected`);
    
    // Запись одной записи    
    for (let i = 0; i < 10; i++) {
      console.log(`Writing record ${i + 1} of 1000`);
      await writeSingleRecord(writer);
    }
    
    const mainDuration = Date.now() - mainStartTime;
    // Общее время выполнения всегда выводим
    console.log(`Total execution time: ${mainDuration}ms`);
  } catch (error) {
    const mainDuration = Date.now() - mainStartTime;
    logError("\n============================================================");
    logError("✗ Test failed");
    logError(`  Total execution time: ${mainDuration}ms`);
    logError(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logError(`  Stack: ${error.stack}`);
    }
    logError("============================================================");
    throw error;
  } finally {
    // Отключение
    log("\n=== Disconnecting ===");
    const disconnectStart = Date.now();
    
    if (writer) {
      await writer.disconnect();
    }
    
    if (trino) {
      // Trino не требует явного отключения
    }
    
    if (sql) {
      await sql.end();
    }
    
    const disconnectDuration = Date.now() - disconnectStart;
    log(`  [${disconnectDuration}ms] All connections closed`);
  }
}

main().catch((err: unknown) => {
  logError("Fatal error:", err);
  process.exit(1);
});
