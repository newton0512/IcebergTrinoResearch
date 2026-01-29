/**
 * Бенчмарк чтения по id для таблиц с разным партиционированием.
 * По умолчанию перед тестом выполняется optimize по всем таблицам.
 *
 * Запуск:
 *   pnpm tsx scripts/partitioning-read-benchmark.ts
 *   pnpm tsx scripts/partitioning-read-benchmark.ts -n 200
 *   pnpm tsx scripts/partitioning-read-benchmark.ts --no-optimize
 */

import { parseArgs } from "node:util";
import { BasicAuth, Trino } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../src/generator/escape.js";
import {
  getPartitioningTrinoConfig,
  PARTITIONING_TABLE_NAMES,
} from "./partitioning-common.js";

const SOURCE_TABLE = "part_bench_none";
const DEFAULT_SAMPLES = 100;

interface TrinoRowResult {
  data?: unknown[][];
  columns?: { name: string }[];
  error?: { message: string };
}

function fullTableName(
  catalog: string,
  schema: string,
  table: string
): string {
  return `${escapeTrinoIdentifier(catalog)}.${escapeTrinoIdentifier(schema)}.${escapeTrinoIdentifier(table)}`;
}

async function runOptimize(
  trino: Trino,
  catalog: string,
  schema: string,
  table: string
): Promise<void> {
  const full = fullTableName(catalog, schema, table);
  const stmts = [
    `ALTER TABLE ${full} EXECUTE optimize(file_size_threshold => '10MB')`,
    `ALTER TABLE ${full} EXECUTE expire_snapshots(retention_threshold => '7d')`,
    `ALTER TABLE ${full} EXECUTE remove_orphan_files(retention_threshold => '7d')`,
  ];
  for (const sql of stmts) {
    const q = await trino.query(sql);
    for await (const result of q) {
      const r = result as TrinoRowResult;
      if (r?.error) {
        throw new Error(`Trino optimize failed: ${r.error.message}\nSQL: ${sql}`);
      }
    }
  }
}

async function consumeQuery(trino: Trino, sql: string): Promise<TrinoRowResult[]> {
  const out: TrinoRowResult[] = [];
  const q = await trino.query(sql);
  for await (const result of q) {
    const r = result as TrinoRowResult;
    if (r?.error) {
      throw new Error(`Trino query failed: ${r.error.message}\nSQL: ${sql}`);
    }
    out.push(r);
  }
  return out;
}

async function collectIds(
  trino: Trino,
  catalog: string,
  schema: string,
  limit: number
): Promise<string[]> {
  const full = fullTableName(catalog, schema, SOURCE_TABLE);
  const sql = `SELECT id FROM ${full} ORDER BY random() LIMIT ${String(limit)}`;
  const results = await consumeQuery(trino, sql);
  const ids: string[] = [];
  for (const r of results) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length > 0 && row[0] != null) {
        ids.push(String(row[0]));
      }
    }
  }
  return ids;
}

async function measureSelectById(
  trino: Trino,
  catalog: string,
  schema: string,
  table: string,
  id: string
): Promise<number> {
  const full = fullTableName(catalog, schema, table);
  const sql = `SELECT * FROM ${full} WHERE id = ${escapeTrinoLiteral(id)} LIMIT 1`;
  const start = performance.now();
  await consumeQuery(trino, sql);
  return performance.now() - start;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      samples: { type: "string", short: "n", default: String(DEFAULT_SAMPLES) },
      optimize: { type: "boolean", short: "o", default: true },
      "no-optimize": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`
Usage: pnpm tsx scripts/partitioning-read-benchmark.ts [options]

Options:
  -n, --samples <n>   Number of random IDs to query per table (default: ${DEFAULT_SAMPLES})
  -o, --optimize      Run optimize on all tables before benchmark (default: true)
  --no-optimize       Skip optimize before benchmark
  -h, --help          Show this help

Examples:
  pnpm tsx scripts/partitioning-read-benchmark.ts
  pnpm tsx scripts/partitioning-read-benchmark.ts -n 200
  pnpm tsx scripts/partitioning-read-benchmark.ts --no-optimize
`);
    process.exit(0);
  }

  const doOptimize = values.optimize !== false && !values["no-optimize"];
  const samples = Math.max(
    1,
    Number.parseInt((values.samples ?? String(DEFAULT_SAMPLES)).replace(/_/g, ""), 10)
  );

  const config = getPartitioningTrinoConfig();
  const trino = Trino.create({
    server: `http://${config.host}:${String(config.port)}`,
    catalog: config.catalog,
    schema: config.schema,
    auth: new BasicAuth(config.user),
  });

  console.log("Partitioning read benchmark");
  console.log(`Trino: ${config.catalog}.${config.schema}`);
  console.log(`Samples per table: ${samples}, optimize before test: ${doOptimize}\n`);

  try {
    const optimizeTimesMs: Record<string, number> = {};
    if (doOptimize) {
      console.log("Running optimize on all tables...");
      for (const tbl of PARTITIONING_TABLE_NAMES) {
        process.stdout.write(`  ${tbl}... `);
        const t0 = performance.now();
        await runOptimize(trino, config.catalog, config.schema, tbl);
        optimizeTimesMs[tbl] = Math.round(performance.now() - t0);
        console.log(`${optimizeTimesMs[tbl]!.toLocaleString()} ms`);
      }
      console.log("\n--- Optimize times (ms) ---");
      for (const name of PARTITIONING_TABLE_NAMES) {
        console.log(`  ${name}: ${optimizeTimesMs[name]!.toLocaleString()}`);
      }
      console.log("");
    }

    console.log(`Sampling ${samples} random IDs from ${SOURCE_TABLE}...`);
    const ids = await collectIds(trino, config.catalog, config.schema, samples);
    if (ids.length === 0) {
      throw new Error(`No rows in ${SOURCE_TABLE}; run partitioning-ensure-and-fill first.`);
    }
    console.log(`Got ${ids.length} IDs.\n`);

    const stats: Record<
      string,
      { min: number; max: number; avg: number; median: number; n: number }
    > = {};

    for (const tbl of PARTITIONING_TABLE_NAMES) {
      process.stdout.write(`Benchmarking ${tbl}... `);
      const times: number[] = [];
      for (const id of ids) {
        const ms = await measureSelectById(
          trino,
          config.catalog,
          config.schema,
          tbl,
          id
        );
        times.push(ms);
      }
      const min = Math.min(...times);
      const max = Math.max(...times);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const med = median(times);
      stats[tbl] = { min, max, avg, median: med, n: times.length };
      console.log(`avg ${avg.toFixed(2)} ms`);
    }

    console.log("\n--- Results (ms) ---");
    const header = "Table                  |  Min    Max    Avg   Median | N";
    console.log(header);
    console.log("-".repeat(header.length));
    for (const tbl of PARTITIONING_TABLE_NAMES) {
      const s = stats[tbl]!;
      const row = `${tbl.padEnd(22)} | ${String(s.min.toFixed(2)).padStart(6)} ${String(s.max.toFixed(2)).padStart(6)} ${String(s.avg.toFixed(2)).padStart(6)} ${String(s.median.toFixed(2)).padStart(6)} | ${String(s.n)}`;
      console.log(row);
    }
    console.log("\n✓ Done.");
  } catch (err) {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
