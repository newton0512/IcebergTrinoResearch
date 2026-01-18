/**
 * Скрипт для массовой вставки данных в таблицу bonus_registry в Trino
 * 
 * Запуск: pnpm tsx scripts/write-trino-mass.ts [--rows 500000000] [--batch-size 10000000]
 * 
 * Параметры:
 *   --rows <num>        - Общее количество записей для вставки (по умолчанию 500000000)
 *   --batch-size <num>  - Размер батча (по умолчанию 10000000)
 *   --truncate          - Очистить таблицу перед вставкой
 */

import { BasicAuth, Trino } from "trino-client";
import { getTrinoConfig } from "../src/hybrid-writer/utils.js";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../src/generator/escape.js";

// Списки допустимых значений
const REGISTRAR_TYPE_IDS = [
  "bsBonusReceiveForTrip",
  "bsRecoveryRequestDoc",
  "bsTripForBonusDoc",
  "bsBonusDocument",
  "bsCustomTransaction",
  "bsCharityDocument",
  "bsExpirationDocument",
  "bsReturnDocument",
  "bsSurveyDoc",
  "bsCompensationDoc",
  "bsSouvenirRequest",
  "bsAdvanceDoc",
  "bsReturnAdvanceDoc",
];

const BONUS_TYPE_IDS = ["premial", "qualification"];
const ACTION_SOURCE_IDS = ["operator", "auto"];
const CARRIER_IDS = ["fpk", "tver", "rzd"];
const OPERATION_DOC_TYPE_IDS = [
  "operation_transfer",
  "operation_status_assignment",
  "operation_manual_bonus",
];

// Парсинг аргументов командной строки
const args = process.argv.slice(2);
const rowsIndex = args.indexOf("--rows");
const batchSizeIndex = args.indexOf("--batch-size");
const truncate = args.includes("--truncate");

const TOTAL_ROWS = rowsIndex >= 0 && args[rowsIndex + 1]
  ? Number.parseInt(args[rowsIndex + 1], 10)
  : 500_000_000;

const BATCH_SIZE = batchSizeIndex >= 0 && args[batchSizeIndex + 1]
  ? Number.parseInt(args[batchSizeIndex + 1], 10)
  : 10_000_000;

const NUM_BATCHES = Math.ceil(TOTAL_ROWS / BATCH_SIZE);

// Функция для генерации SQL выражений для колонок
function generateColumnExpressions(seqExpr: string): string[] {
  const registrarTypeIdsArray = REGISTRAR_TYPE_IDS.map(v => escapeTrinoLiteral(v)).join(", ");
  const bonusTypeIdsArray = BONUS_TYPE_IDS.map(v => escapeTrinoLiteral(v)).join(", ");
  const actionSourceIdsArray = ACTION_SOURCE_IDS.map(v => escapeTrinoLiteral(v)).join(", ");
  const carrierIdsArray = CARRIER_IDS.map(v => escapeTrinoLiteral(v)).join(", ");
  const operationDocTypeIdsArray = OPERATION_DOC_TYPE_IDS.map(v => escapeTrinoLiteral(v)).join(", ");

  // Функция для nullable поля с вероятностью
  const nullable = (expr: string, probability: number): string => {
    return `CASE WHEN random() < ${probability} THEN NULL ELSE ${expr} END`;
  };

  // Функция для случайной строки фиксированной длины
  const randomString = (minLen: number, maxLen: number): string => {
    const len = maxLen - minLen + 1;
    return `substr(replace(cast(uuid() as varchar), '-', ''), 1, CAST(floor(random() * ${len} + ${minLen}) AS INTEGER))`;
  };

  return [
    // id VARCHAR
    `CAST(uuid() AS VARCHAR)`,
    
    // "date" TIMESTAMP (nullable, 80% вероятность)
    nullable(`from_unixtime(CAST(floor(random() * (${Math.floor(Date.now() / 1000)} - ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) + ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) AS BIGINT))`, 0.2),
    
    // registrar_type_id VARCHAR (nullable, 80% вероятность)
    nullable(`element_at(ARRAY[${registrarTypeIdsArray}], CAST(floor(random() * ${REGISTRAR_TYPE_IDS.length}) + 1 AS INTEGER))`, 0.2),
    
    // registrar_id VARCHAR (nullable, 80% вероятность)
    nullable(`CAST(uuid() AS VARCHAR)`, 0.2),
    
    // "row" INTEGER (nullable, 80% вероятность)
    nullable(`CAST(floor(random() * 10 + 1) AS INTEGER)`, 0.2),
    
    // manager_id INTEGER (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 1000 + 1) AS INTEGER)`, 0.3),
    
    // bs_profile_id VARCHAR NOT NULL
    `CAST(uuid() AS VARCHAR)`,
    
    // accounted_for_bs_profile_id VARCHAR NOT NULL (обычно совпадает с bs_profile_id)
    `CAST(uuid() AS VARCHAR)`,
    
    // first_name VARCHAR (nullable, 60% вероятность)
    nullable(`CAST(uuid() AS VARCHAR)`, 0.4), // Упрощенная генерация
    
    // first_name_latin VARCHAR (nullable, 60% вероятность)
    nullable(`CAST(uuid() AS VARCHAR)`, 0.4),
    
    // last_name VARCHAR (nullable, 60% вероятность)
    nullable(`CAST(uuid() AS VARCHAR)`, 0.4),
    
    // last_name_latin VARCHAR (nullable, 60% вероятность)
    nullable(`CAST(uuid() AS VARCHAR)`, 0.4),
    
    // departure_id INTEGER (nullable, 50% вероятность)
    nullable(`CAST(floor(random() * 100 + 1) AS INTEGER)`, 0.5),
    
    // arrival_id INTEGER (nullable, 50% вероятность)
    nullable(`CAST(floor(random() * 100 + 1) AS INTEGER)`, 0.5),
    
    // departure_date DATE (nullable, 50% вероятность)
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${Math.floor(Date.now() / 1000)} - ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) + ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) AS BIGINT)) AS DATE)`, 0.5),
    
    // currency_entry_id INTEGER (nullable, 50% вероятность)
    nullable(`CAST(floor(random() * 10 + 1) AS INTEGER)`, 0.5),
    
    // bonus_type_id VARCHAR NOT NULL
    `element_at(ARRAY[${bonusTypeIdsArray}], CAST(floor(random() * ${BONUS_TYPE_IDS.length}) + 1 AS INTEGER))`,
    
    // action_source_id VARCHAR NOT NULL
    `element_at(ARRAY[${actionSourceIdsArray}], CAST(floor(random() * ${ACTION_SOURCE_IDS.length}) + 1 AS INTEGER))`,
    
    // bs_bonus_ticket_id VARCHAR (nullable, 20% вероятность)
    nullable(`CAST(uuid() AS VARCHAR)`, 0.8),
    
    // validity_time INTEGER (nullable, 60% вероятность)
    nullable(`CAST(floor(random() * 336 + 30) AS INTEGER)`, 0.6),
    
    // date_of_expire DATE (nullable, 60% вероятность)
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${Math.floor(new Date("2025-12-31").getTime() / 1000)} - ${Math.floor(Date.now() / 1000)}) + ${Math.floor(Date.now() / 1000)}) AS BIGINT)) AS DATE)`, 0.6),
    
    // car_type_id VARCHAR (nullable, 80% вероятность)
    nullable(randomString(5, 10), 0.8),
    
    // express_carrier_id INTEGER (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 50 + 1) AS INTEGER)`, 0.7),
    
    // carrier_id VARCHAR (nullable, 60% вероятность)
    nullable(`element_at(ARRAY[${carrierIdsArray}], CAST(floor(random() * ${CARRIER_IDS.length}) + 1 AS INTEGER))`, 0.6),
    
    // bs_partner_id INTEGER (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 20 + 1) AS INTEGER)`, 0.7),
    
    // bs_train_number_id VARCHAR (nullable, 80% вероятность)
    nullable(randomString(5, 15), 0.8),
    
    // bs_tourism_train_id VARCHAR (nullable, 80% вероятность)
    nullable(randomString(5, 15), 0.8),
    
    // accounted_in_calculation BOOLEAN (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    
    // cancelled BOOLEAN (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    
    // bs_quota_id INTEGER (nullable, 80% вероятность)
    nullable(`CAST(floor(random() * 100 + 1) AS INTEGER)`, 0.8),
    
    // doc_to_track_type_id VARCHAR NOT NULL
    `element_at(ARRAY[${registrarTypeIdsArray}], CAST(floor(random() * ${REGISTRAR_TYPE_IDS.length}) + 1 AS INTEGER))`,
    
    // doc_to_track_id VARCHAR NOT NULL
    `CAST(uuid() AS VARCHAR)`,
    
    // doc_to_track_date DATE (nullable, 50% вероятность)
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${Math.floor(Date.now() / 1000)} - ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) + ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) AS BIGINT)) AS DATE)`, 0.5),
    
    // active_date DATE (nullable, 70% вероятность)
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${Math.floor(Date.now() / 1000)} - ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) + ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) AS BIGINT)) AS DATE)`, 0.7),
    
    // trip_for_another_person BOOLEAN (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    
    // ticket_number VARCHAR (nullable, 80% вероятность)
    nullable(randomString(10, 20), 0.8),
    
    // currency_amount INTEGER (nullable, 80% вероятность)
    nullable(`CAST(floor(random() * 9901 + 100) AS INTEGER)`, 0.8),
    
    // amount INTEGER NOT NULL (от -1000 до +10000)
    `CAST(floor(random() * 11001 - 1000) AS INTEGER)`,
    
    // bs_partner_bonus_type_id VARCHAR (nullable, 80% вероятность)
    nullable(randomString(5, 15), 0.8),
    
    // express_service_class_id INTEGER (nullable, 80% вероятность)
    nullable(`CAST(floor(random() * 5 + 1) AS INTEGER)`, 0.8),
    
    // date_to_cancelled TIMESTAMP (nullable, 90% вероятность)
    nullable(`from_unixtime(CAST(floor(random() * (${Math.floor(new Date("2025-12-31").getTime() / 1000)} - ${Math.floor(Date.now() / 1000)}) + ${Math.floor(Date.now() / 1000)}) AS BIGINT))`, 0.9),
    
    // prolongable BOOLEAN (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    
    // active_by_trips BOOLEAN (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    
    // is_empty BOOLEAN (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    
    // amount_calculation VARCHAR (nullable, 70% вероятность)
    nullable(`CAST(uuid() AS VARCHAR)`, 0.7), // Упрощенная генерация
    
    // distance INTEGER (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 4901 + 100) AS INTEGER)`, 0.7),
    
    // addition_amount INTEGER (nullable, 80% вероятность)
    nullable(`CAST(floor(random() * 491 + 10) AS INTEGER)`, 0.8),
    
    // operation_doc_type_id VARCHAR (nullable, 30% вероятность)
    nullable(`element_at(ARRAY[${operationDocTypeIdsArray}], CAST(floor(random() * ${OPERATION_DOC_TYPE_IDS.length}) + 1 AS INTEGER))`, 0.3),
    
    // is_merged BOOLEAN (nullable, 70% вероятность)
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    
    // merged_date DATE (nullable, 90% вероятность)
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${Math.floor(Date.now() / 1000)} - ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) + ${Math.floor(new Date("2020-01-01").getTime() / 1000)}) AS BIGINT)) AS DATE)`, 0.9),
  ];
}

async function main(): Promise<void> {
  console.log("============================================================");
  console.log("Mass Insert into bonus_registry (Trino/Iceberg)");
  console.log("============================================================");
  console.log(`Total rows: ${TOTAL_ROWS.toLocaleString()}`);
  console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`);
  console.log(`Number of batches: ${NUM_BATCHES}`);
  console.log("============================================================\n");

  const trinoConfig = getTrinoConfig();
  
  console.log("Connecting to Trino...");
  const trino = Trino.create({
    server: `http://${trinoConfig.host}:${trinoConfig.port}`,
    catalog: trinoConfig.catalog,
    schema: trinoConfig.schema,
    auth: new BasicAuth(trinoConfig.user),
  });

  const escapedCatalog = escapeTrinoIdentifier(trinoConfig.catalog);
  const escapedSchema = escapeTrinoIdentifier(trinoConfig.schema);
  const escapedTable = escapeTrinoIdentifier("bonus_registry");
  const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

  // Очистка таблицы, если указан флаг
  if (truncate) {
    console.log("Truncating table...");
    const truncateQuery = await trino.query(`TRUNCATE TABLE ${fullTableName}`);
    for await (const _ of truncateQuery) {
      // Потребляем результаты
    }
    console.log("✓ Table truncated\n");
  }

  const startTime = Date.now();
  let totalInserted = 0;

  // Генерируем выражения для колонок один раз
  // Используем placeholder, который будет заменен на реальное выражение в каждом батче
  const columnExpressions = generateColumnExpressions("row_num");

  // Список колонок (в том же порядке, что и выражения)
  const columns = [
    "id", "date", "registrar_type_id", "registrar_id", "row",
    "manager_id", "bs_profile_id", "accounted_for_bs_profile_id",
    "first_name", "first_name_latin", "last_name", "last_name_latin",
    "departure_id", "arrival_id", "departure_date", "currency_entry_id",
    "bonus_type_id", "action_source_id", "bs_bonus_ticket_id",
    "validity_time", "date_of_expire", "car_type_id", "express_carrier_id",
    "carrier_id", "bs_partner_id", "bs_train_number_id", "bs_tourism_train_id",
    "accounted_in_calculation", "cancelled", "bs_quota_id",
    "doc_to_track_type_id", "doc_to_track_id", "doc_to_track_date",
    "active_date", "trip_for_another_person", "ticket_number",
    "currency_amount", "amount", "bs_partner_bonus_type_id",
    "express_service_class_id", "date_to_cancelled", "prolongable",
    "active_by_trips", "is_empty", "amount_calculation",
    "distance", "addition_amount", "operation_doc_type_id",
    "is_merged", "merged_date",
  ].map(c => escapeTrinoIdentifier(c));

  // Обрабатываем батчи
  for (let batchNum = 0; batchNum < NUM_BATCHES; batchNum++) {
    const batchStart = batchNum * BATCH_SIZE;
    const batchEnd = Math.min((batchNum + 1) * BATCH_SIZE, TOTAL_ROWS);
    const currentBatchSize = batchEnd - batchStart;

    console.log(`\nBatch ${batchNum + 1}/${NUM_BATCHES}: ${currentBatchSize.toLocaleString()} rows (${((batchNum + 1) / NUM_BATCHES * 100).toFixed(1)}%)`);
    
    const batchStartTime = Date.now();

    // Используем многоуровневый CROSS JOIN для генерации больших объемов данных
    // Trino sequence() имеет лимит 10,000
    // Для 10M строк используем: level1 (0 до 999) * 10K + level2 (1 до 10K) = до 10M
    const SEQUENCE_LIMIT = 10_000;
    const level1Size = Math.ceil(currentBatchSize / SEQUENCE_LIMIT);
    
    // Вычисляем выражение для row_num: level1 * 10K + level2 (номер строки в батче)
    // row_num может использоваться в выражениях колонок для генерации данных
    const rowNumExpr = `(CAST(level1 AS BIGINT) * BIGINT '${SEQUENCE_LIMIT}' + level2)`;
    
    // Заменяем row_num в выражениях колонок на rowNumExpr (если используется)
    const batchColumnExpressions = columnExpressions.map(expr => 
      expr.replace(/row_num/g, rowNumExpr)
    );

    const insertSql = `
      INSERT INTO ${fullTableName} (${columns.join(", ")})
      SELECT ${batchColumnExpressions.join(", ")}
      FROM UNNEST(sequence(0, ${level1Size - 1})) AS t1(level1)
      CROSS JOIN UNNEST(sequence(1, ${SEQUENCE_LIMIT})) AS t2(level2)
      WHERE (CAST(level1 AS BIGINT) * BIGINT '${SEQUENCE_LIMIT}' + level2) <= ${currentBatchSize}
    `;

    try {
      const query = await trino.query(insertSql);
      
      // Потребляем результаты
      for await (const result of query) {
        // Проверяем на ошибки
        if (result && typeof result === "object") {
          const trinoResult = result as { 
            error?: { 
              message?: string; 
              errorCode?: number; 
            };
          };
          
          if (trinoResult.error) {
            throw new Error(`Trino error: ${trinoResult.error.message || "Unknown error"}`);
          }
        } else if (result && typeof result === "string" && result.toLowerCase().includes("error")) {
          throw new Error(`Trino error: ${result}`);
        }
      }

      const batchDuration = Date.now() - batchStartTime;
      totalInserted += currentBatchSize;
      const rowsPerSecond = (currentBatchSize / (batchDuration / 1000)).toFixed(0);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const estimatedTotal = NUM_BATCHES > 1 
        ? ((Date.now() - startTime) / (batchNum + 1) * NUM_BATCHES / 1000).toFixed(0)
        : elapsed;

      console.log(`  ✓ Inserted ${currentBatchSize.toLocaleString()} rows in ${batchDuration}ms (${rowsPerSecond} rows/s)`);
      console.log(`  Progress: ${totalInserted.toLocaleString()}/${TOTAL_ROWS.toLocaleString()} (${(totalInserted / TOTAL_ROWS * 100).toFixed(1)}%)`);
      console.log(`  Elapsed: ${elapsed}s, Estimated total: ${estimatedTotal}s`);
    } catch (error) {
      console.error(`\n✗ Batch ${batchNum + 1} failed:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  const totalDuration = Date.now() - startTime;
  const avgRowsPerSecond = (TOTAL_ROWS / (totalDuration / 1000)).toFixed(0);

  console.log("\n============================================================");
  console.log("✓ Mass insert completed!");
  console.log(`  Total rows inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Total time: ${(totalDuration / 1000).toFixed(2)}s (${(totalDuration / 60000).toFixed(2)} minutes)`);
  console.log(`  Average speed: ${avgRowsPerSecond} rows/second`);
  console.log("============================================================");
}

main().catch((err: unknown) => {
  console.error("\n✗ Fatal error:", err);
  process.exit(1);
});
