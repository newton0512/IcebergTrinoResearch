/**
 * Проверка/создание таблиц bonus_registry с партиционированием и заполнение обеих батчами.
 * Данные генерируются в каждую таблицу отдельно (не копируются из одной в другую).
 *
 * Запуск:
 *   pnpm tsx scripts/bonus-registry-partitioning-fill.ts [--rows 1000000] [--batch-size 50000]
 *   pnpm tsx scripts/bonus-registry-partitioning-fill.ts --truncate --rows 500000
 */

import { parseArgs } from "node:util";
import { BasicAuth, Trino } from "trino-client";
import { escapeTrinoIdentifier } from "../src/generator/escape.js";
import {
  getPartitioningTrinoConfig,
  BONUS_REGISTRY_PARTITIONING_TABLE_NAMES,
} from "./bonus-registry-partitioning-common.js";
import { createBonusRegistryPartitioningTables } from "./bonus-registry-partitioning-create-tables.js";
import {
  BONUS_REGISTRY_INSERT_COLUMNS,
  generateBonusRegistryColumnExpressions,
} from "./bonus-registry-insert-generator.js";

const DEFAULT_ROWS = 100_000;
const DEFAULT_BATCH_SIZE = 10_000;
const SEQUENCE_LIMIT = 10_000;

function fullTableName(
  catalog: string,
  schema: string,
  table: string
): string {
  return `${escapeTrinoIdentifier(catalog)}.${escapeTrinoIdentifier(schema)}.${escapeTrinoIdentifier(table)}`;
}

async function runTrinoStatement(
  trino: Trino,
  sql: string,
  label: string
): Promise<void> {
  const q = await trino.query(sql);
  for await (const result of q) {
    const r = result as { error?: { message?: string } };
    if (r?.error) {
      throw new Error(`${label}: ${r.error.message ?? "unknown"}\nSQL: ${sql}`);
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      rows: { type: "string", short: "r", default: String(DEFAULT_ROWS) },
      "batch-size": { type: "string", short: "b", default: String(DEFAULT_BATCH_SIZE) },
      truncate: { type: "boolean", short: "t", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`
Usage: pnpm tsx scripts/bonus-registry-partitioning-fill.ts [options]

Options:
  -r, --rows <n>        Number of rows per table (default: ${DEFAULT_ROWS.toLocaleString()})
  -b, --batch-size <n>  Batch size for INSERT (default: ${DEFAULT_BATCH_SIZE.toLocaleString()})
  -t, --truncate        Truncate both tables before filling
  -h, --help            Show this help

Examples:
  pnpm tsx scripts/bonus-registry-partitioning-fill.ts
  pnpm tsx scripts/bonus-registry-partitioning-fill.ts --truncate --rows 500000
`);
    process.exit(0);
  }

  const rowCount = Math.max(
    1,
    Number.parseInt(String(values.rows).replace(/_/g, ""), 10)
  );
  const batchSize = Math.max(
    1,
    Number.parseInt(String(values["batch-size"]).replace(/_/g, ""), 10)
  );
  const doTruncate = values.truncate === true;
  const numBatches = Math.ceil(rowCount / batchSize);

  const config = getPartitioningTrinoConfig();
  const trino = Trino.create({
    server: `http://${config.host}:${String(config.port)}`,
    catalog: config.catalog,
    schema: config.schema,
    auth: new BasicAuth(config.user),
  });

  console.log("Bonus registry partitioning fill");
  console.log(`Trino: ${config.catalog}.${config.schema}`);
  console.log(`Rows per table: ${rowCount.toLocaleString()}, batch: ${batchSize.toLocaleString()}, truncate: ${doTruncate}\n`);

  try {
    // Всегда вызываем создание таблиц (CREATE TABLE IF NOT EXISTS), чтобы таблицы
    // гарантированно существовали перед INSERT; иначе возможна ошибка "Table does not exist".
    console.log("Ensuring tables exist (CREATE TABLE IF NOT EXISTS)...\n");
    await createBonusRegistryPartitioningTables(
      trino,
      config.catalog,
      config.schema,
      false
    );
    console.log("");

    if (doTruncate) {
      console.log("Truncating tables...");
      for (const name of BONUS_REGISTRY_PARTITIONING_TABLE_NAMES) {
        const full = fullTableName(config.catalog, config.schema, name);
        await runTrinoStatement(trino, `TRUNCATE TABLE ${full}`, `TRUNCATE ${name}`);
        console.log(`  ✓ ${name}`);
      }
      console.log("");
    }

    const columnsEscaped = BONUS_REGISTRY_INSERT_COLUMNS.map((c) =>
      escapeTrinoIdentifier(c)
    );
    const columnExpressions = generateBonusRegistryColumnExpressions("row_num");

    for (const tableName of BONUS_REGISTRY_PARTITIONING_TABLE_NAMES) {
      const full = fullTableName(config.catalog, config.schema, tableName);
      console.log(`Filling ${tableName} (${rowCount.toLocaleString()} rows, ${numBatches} batches)...`);
      const tableStart = performance.now();
      let inserted = 0;

      for (let batchNum = 0; batchNum < numBatches; batchNum++) {
        const batchStart = batchNum * batchSize;
        const batchEnd = Math.min((batchNum + 1) * batchSize, rowCount);
        const currentBatchSize = batchEnd - batchStart;

        const level1Size = Math.ceil(currentBatchSize / SEQUENCE_LIMIT);
        const rowNumExpr = `(CAST(level1 AS BIGINT) * BIGINT '${SEQUENCE_LIMIT}' + level2)`;
        const batchColumnExpressions = columnExpressions.map((expr) =>
          expr.replace(/row_num/g, rowNumExpr)
        );

        const insertSql = `
          INSERT INTO ${full} (${columnsEscaped.join(", ")})
          SELECT ${batchColumnExpressions.join(", ")}
          FROM UNNEST(sequence(0, ${level1Size - 1})) AS t1(level1)
          CROSS JOIN UNNEST(sequence(1, ${SEQUENCE_LIMIT})) AS t2(level2)
          WHERE (CAST(level1 AS BIGINT) * BIGINT '${SEQUENCE_LIMIT}' + level2) <= ${currentBatchSize}
        `;

        await runTrinoStatement(trino, insertSql, `INSERT ${tableName} batch ${batchNum + 1}`);
        inserted += currentBatchSize;
        if (numBatches > 1 && (batchNum + 1) % 5 === 0) {
          console.log(`  ${tableName}: ${inserted.toLocaleString()}/${rowCount.toLocaleString()}`);
        }
      }

      const tableMs = Math.round(performance.now() - tableStart);
      console.log(`✓ ${tableName}: ${inserted.toLocaleString()} rows in ${tableMs.toLocaleString()} ms\n`);
    }

    console.log("✓ Fill done.");
  } catch (err) {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
