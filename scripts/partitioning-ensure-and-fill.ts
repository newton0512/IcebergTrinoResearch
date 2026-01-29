/**
 * Проверка/создание таблиц партиционирования и заполнение одинаковыми данными.
 * Использует TrinoDataGenerator для part_bench_none, затем INSERT…SELECT в остальные.
 *
 * Запуск:
 *   pnpm tsx scripts/partitioning-ensure-and-fill.ts
 *   pnpm tsx scripts/partitioning-ensure-and-fill.ts -r 1_000_000 -b 50_000
 */

import { parseArgs } from "node:util";
import { BasicAuth, Trino } from "trino-client";
import { TrinoDataGenerator } from "../src/generator/trino-generator.js";
import type { TableConfig } from "../src/generator/types.js";
import {
  escapeTrinoIdentifier,
  escapeTrinoLiteral,
} from "../src/generator/escape.js";
import { checkTrinoTableExists } from "../src/hybrid-writer/utils.js";
import {
  getPartitioningTrinoConfig,
  PARTITIONING_TABLE_NAMES,
} from "./partitioning-common.js";
import { createPartitioningTables } from "./partitioning-create-tables.js";

const SOURCE_TABLE = "part_bench_none";
const DEFAULT_ROWS = 100_000;
const DEFAULT_BATCH = 10_000;

const TABLE_CONFIG: TableConfig = {
  name: SOURCE_TABLE,
  description: "partitioning benchmark source (unpartitioned)",
  columns: [
    {
      name: "id",
      type: "string",
      generator: { kind: "uuid", asVarchar: true },
    },
    {
      name: "dt",
      type: "datetime",
      generator: {
        kind: "datetime",
        from: new Date("2020-01-01"),
        to: new Date(),
      },
    },
  ],
};

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

interface TrinoRowResult {
  data?: unknown[][];
  error?: { message: string };
}

async function runTrinoQueryScalar(
  trino: Trino,
  sql: string,
  label: string
): Promise<string | null> {
  const q = await trino.query(sql);
  for await (const result of q) {
    const r = result as TrinoRowResult;
    if (r?.error) {
      throw new Error(`${label}: ${r.error.message ?? "unknown"}\nSQL: ${sql}`);
    }
    const row = r.data?.[0];
    if (row && row.length > 0 && row[0] != null) {
      return String(row[0]);
    }
  }
  return null;
}

function fullTableName(
  catalog: string,
  schema: string,
  table: string
): string {
  return `${escapeTrinoIdentifier(catalog)}.${escapeTrinoIdentifier(schema)}.${escapeTrinoIdentifier(table)}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      rows: { type: "string", short: "r", default: String(DEFAULT_ROWS) },
      "batch-size": { type: "string", short: "b", default: String(DEFAULT_BATCH) },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`
Usage: pnpm tsx scripts/partitioning-ensure-and-fill.ts [options]

Options:
  -r, --rows <n>        Number of rows to generate (default: ${DEFAULT_ROWS.toLocaleString()})
  -b, --batch-size <n>  Batch size for generation (default: ${DEFAULT_BATCH.toLocaleString()})
  -h, --help            Show this help

Examples:
  pnpm tsx scripts/partitioning-ensure-and-fill.ts
  pnpm tsx scripts/partitioning-ensure-and-fill.ts -r 1_000_000 -b 50_000
`);
    process.exit(0);
  }

  const rowCount = Number.parseInt(values.rows!.replace(/_/g, ""), 10);
  const batchSize = Number.parseInt(
    (values["batch-size"] ?? String(DEFAULT_BATCH)).replace(/_/g, ""),
    10
  );

  const config = getPartitioningTrinoConfig();
  const trino = Trino.create({
    server: `http://${config.host}:${String(config.port)}`,
    catalog: config.catalog,
    schema: config.schema,
    auth: new BasicAuth(config.user),
  });

  console.log("Partitioning ensure-and-fill");
  console.log(`Trino: ${config.catalog}.${config.schema}`);
  console.log(`Rows: ${rowCount.toLocaleString()}, batch: ${batchSize.toLocaleString()}\n`);

  try {
    let allExist = true;
    for (const name of PARTITIONING_TABLE_NAMES) {
      const ok = await checkTrinoTableExists(
        trino,
        config.catalog,
        config.schema,
        name,
        true
      );
      if (!ok) allExist = false;
    }
    if (!allExist) {
      console.log("Creating missing tables...\n");
      await createPartitioningTables(trino, config.catalog, config.schema);
    }

    const fillTimesMs: Record<string, number> = {};

    const gen = new TrinoDataGenerator({
      host: config.host,
      port: config.port,
      catalog: config.catalog,
      schema: config.schema,
      user: config.user,
    });
    await gen.connect();

    try {
      console.log(`Generating ${rowCount.toLocaleString()} rows into ${SOURCE_TABLE} (batch ${batchSize.toLocaleString()})...`);
      const genResult = await gen.generate({
        table: TABLE_CONFIG,
        rowCount,
        batchSize,
        createTable: false,
        truncateFirst: true,
        optimize: false,
      });
      fillTimesMs[SOURCE_TABLE] = genResult.generateMs;
      console.log(`✓ ${SOURCE_TABLE} in ${genResult.generateMs.toLocaleString()} ms\n`);
    } finally {
      await gen.disconnect();
    }

    const srcFull = fullTableName(config.catalog, config.schema, SOURCE_TABLE);
    const others = PARTITIONING_TABLE_NAMES.filter((n) => n !== SOURCE_TABLE);

    const globalMaxId = await runTrinoQueryScalar(
      trino,
      `SELECT max(id) FROM ${srcFull}`,
      "SELECT max(id) source"
    );
    if (globalMaxId == null) {
      console.log("Source table empty, skipping copy.");
    } else {
      for (const tbl of others) {
        const full = fullTableName(config.catalog, config.schema, tbl);
        console.log(`Copying ${SOURCE_TABLE} -> ${tbl} (batch ${batchSize.toLocaleString()})...`);
        await runTrinoStatement(trino, `DELETE FROM ${full}`, `DELETE ${tbl}`);
        let lastId = "";
        let tableFillMs = 0;
        let batchNum = 0;
        for (;;) {
          const insertSql = `INSERT INTO ${full} (id, dt) SELECT id, dt FROM ${srcFull} WHERE id > ${escapeTrinoLiteral(lastId)} ORDER BY id LIMIT ${String(batchSize)}`;
          const t0 = performance.now();
          await runTrinoStatement(trino, insertSql, `INSERT ${tbl}`);
          tableFillMs += performance.now() - t0;
          batchNum++;
          const newMax = await runTrinoQueryScalar(
            trino,
            `SELECT max(id) FROM ${full}`,
            `SELECT max(id) ${tbl}`
          );
          if (newMax == null || newMax === lastId) break;
          lastId = newMax;
          if (lastId >= globalMaxId) break;
        }
        fillTimesMs[tbl] = Math.round(tableFillMs);
        console.log(`✓ ${tbl} in ${fillTimesMs[tbl]!.toLocaleString()} ms (${String(batchNum)} batches)`);
      }
    }

    console.log("\n--- Fill times (ms) ---");
    for (const name of PARTITIONING_TABLE_NAMES) {
      const ms = fillTimesMs[name];
      console.log(`  ${name}: ${ms != null ? ms.toLocaleString() : "—"}`);
    }
    console.log("\n✓ Ensure-and-fill done.");
  } catch (err) {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
