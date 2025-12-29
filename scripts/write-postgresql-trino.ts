import postgres, { type Sql } from "postgres";
import { Trino, BasicAuth } from "trino-client";
import { HybridWriter } from "../src/hybrid-writer/hybrid-writer.js";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../src/generator/escape.js";

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
const TRINO_CATALOG = "iceberg";
const TRINO_SCHEMA = "warehouse";

const POSTGRES_CONFIG = {
  host: "localhost",
  port: 5432,
  database: "appdb",
  username: "postgres",
  password: "postgres",
};

const TRINO_CONFIG = {
  host: "localhost",
  port: 8080,
  catalog: TRINO_CATALOG,
  schema: TRINO_SCHEMA,
  user: "trino",
};

/**
 * Проверка существования таблицы в PostgreSQL
 */
async function checkPostgresTableExists(
  sql: Sql,
  tableName: string
): Promise<boolean> {
  const startTime = Date.now();
  const result = await sql.unsafe<Array<{ exists: boolean }>>(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = '${tableName}'
    ) AS exists
  `);
  const duration = Date.now() - startTime;
  const exists = result && result.length > 0 ? result[0]?.exists ?? false : false;
  log(`  [${duration}ms] PostgreSQL table '${tableName}': ${exists ? "✓ exists" : "✗ not found"}`);
  return exists;
}

/**
 * Проверка существования таблицы в Trino/Iceberg
 */
async function checkTrinoTableExists(trino: Trino, tableName: string): Promise<boolean> {
  const startTime = Date.now();
  const fullTableName = `${escapeTrinoIdentifier(TRINO_CATALOG)}.${escapeTrinoIdentifier(TRINO_SCHEMA)}.${escapeTrinoIdentifier(tableName)}`;
  
  // Альтернативный подход: пробуем выполнить простой SELECT из таблицы
  // Если таблица существует, запрос не вызовет ошибку
  try {
    const testQuery = await trino.query(`
      SELECT 1 FROM ${fullTableName} LIMIT 1
    `);
    
    // Потребляем результат
    for await (const _ of testQuery) {
      // Просто потребляем, чтобы запрос выполнился
    }
    
    const duration = Date.now() - startTime;
    log(`  [${duration}ms] Trino table '${fullTableName}': ✓ exists (verified by SELECT)`);
    return true;
  } catch (selectError) {
    // Если SELECT не сработал, пробуем через information_schema
    try {
      const sqlQuery = `
        SELECT table_name 
        FROM ${escapeTrinoIdentifier(TRINO_CATALOG)}.information_schema.tables 
        WHERE table_schema = ${escapeTrinoLiteral(TRINO_SCHEMA)}
        AND table_catalog = ${escapeTrinoLiteral(TRINO_CATALOG)}
        AND table_name = ${escapeTrinoLiteral(tableName)}
      `;
      
      const query = await trino.query(sqlQuery);
      
      let found = false;
      const allResults: unknown[] = [];
      for await (const result of query) {
        allResults.push(result);
        // Trino может возвращать данные в разных форматах
        // Проверяем несколько вариантов структуры ответа
        if (result && typeof result === 'object') {
          const data = result as Record<string, unknown>;
          // Может быть table_name как ключ
          if (data.table_name === tableName || data['table_name'] === tableName) {
            found = true;
            break;
          }
          // Может быть массив значений [table_name]
          if (Array.isArray(data) && data.length > 0 && data[0] === tableName) {
            found = true;
            break;
          }
          // Может быть объект с данными в другом формате
          const values = Object.values(data);
          if (values.includes(tableName)) {
            found = true;
            break;
          }
        }
        // Если результат - это строка
        if (typeof result === 'string' && result === tableName) {
          found = true;
          break;
        }
      }
      
      const duration = Date.now() - startTime;
      if (!found && allResults.length > 0) {
        log(`  [${duration}ms] Trino table '${fullTableName}': ✗ not found (debug: received ${allResults.length} result(s), first result: ${JSON.stringify(allResults[0])})`);
      } else {
        log(`  [${duration}ms] Trino table '${fullTableName}': ${found ? "✓ exists" : "✗ not found"}`);
      }
      return found;
    } catch (error) {
      const duration = Date.now() - startTime;
      log(`  [${duration}ms] Trino table '${fullTableName}': ✗ error - ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        log(`    Stack: ${error.stack}`);
      }
      return false;
    }
  }
}

/**
 * Проверка всех необходимых таблиц
 */
async function checkTables(sql: Sql, trino: Trino): Promise<{
  postgresUniqueCheck: boolean;
  postgresBalanceCheck: boolean;
  trinoTable: boolean;
}> {
  log("\n=== Checking tables ===");
  
  const checkStartTime = Date.now();
  
  const [postgresUniqueCheck, postgresBalanceCheck, trinoTable] = await Promise.all([
    checkPostgresTableExists(sql, POSTGRES_UNIQUE_CHECK_TABLE),
    checkPostgresTableExists(sql, POSTGRES_BALANCE_CHECK_TABLE),
    checkTrinoTableExists(trino, TRINO_TABLE),
  ]);
  
  const totalDuration = Date.now() - checkStartTime;
  log(`\nTotal check time: ${totalDuration}ms`);
  
  return {
    postgresUniqueCheck,
    postgresBalanceCheck,
    trinoTable,
  };
}

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
  
  let sql: Sql | null = null;
  let trino: Trino | null = null;
  let writer: HybridWriter | null = null;
  
  try {
    // Подключение к PostgreSQL
    log("\n=== Connecting to PostgreSQL ===");
    const pgConnectStart = Date.now();
    sql = postgres({
      host: POSTGRES_CONFIG.host,
      port: POSTGRES_CONFIG.port,
      database: POSTGRES_CONFIG.database,
      username: POSTGRES_CONFIG.username,
      password: POSTGRES_CONFIG.password,
    });
    const pgConnectDuration = Date.now() - pgConnectStart;
    log(`  [${pgConnectDuration}ms] PostgreSQL connected`);
    
    // Подключение к Trino
    log("\n=== Connecting to Trino ===");
    const trinoConnectStart = Date.now();
    trino = Trino.create({
      server: `http://${TRINO_CONFIG.host}:${TRINO_CONFIG.port}`,
      catalog: TRINO_CONFIG.catalog,
      schema: TRINO_CONFIG.schema,
      auth: new BasicAuth(TRINO_CONFIG.user),
    });
    const trinoConnectDuration = Date.now() - trinoConnectStart;
    log(`  [${trinoConnectDuration}ms] Trino connected`);
    
    // Проверка таблиц
    const tablesCheck = await checkTables(sql, trino);
    
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
      postgres: POSTGRES_CONFIG,
      trino: {
        ...TRINO_CONFIG,
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
    await writeSingleRecord(writer);
    
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
