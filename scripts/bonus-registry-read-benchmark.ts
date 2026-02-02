/**
 * Бенчмарк чтения по id для таблиц bonus_registry с разным партиционированием.
 * По умолчанию перед тестом выполняется optimize по всем таблицам.
 *
 * Запуск:
 *   pnpm tsx scripts/bonus-registry-read-benchmark.ts
 *   pnpm tsx scripts/bonus-registry-read-benchmark.ts -n 200
 *   pnpm tsx scripts/bonus-registry-read-benchmark.ts --no-optimize
 */

import { parseArgs } from "node:util";
import { BasicAuth, Trino } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../src/generator/escape.js";
import {
  getPartitioningTrinoConfig,
  BONUS_REGISTRY_PARTITIONING_TABLE_NAMES,
} from "./bonus-registry-partitioning-common.js";

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

/** Минимальный процент для TABLESAMPLE SYSTEM (%). Меньшие значения часто дают 0 строк из-за блочной выборки. */
const SAMPLE_PERCENT_MIN = 0.5;
const SAMPLE_PERCENT_MAX = 100;

async function getTableRowCount(
  trino: Trino,
  catalog: string,
  schema: string,
  table: string
): Promise<number> {
  const full = fullTableName(catalog, schema, table);
  const sql = `SELECT count(*) AS cnt FROM ${full}`;
  const results = await consumeQuery(trino, sql);
  for (const r of results) {
    const row = r.data?.[0];
    if (row && row.length > 0 && row[0] != null) {
      return Number(row[0]);
    }
  }
  return 0;
}

async function collectIds(
  trino: Trino,
  catalog: string,
  schema: string,
  table: string,
  limit: number,
  log?: (msg: string) => void
): Promise<string[]> {
  const full = fullTableName(catalog, schema, table);
  const rowCount = await getTableRowCount(trino, catalog, schema, table);
  if (rowCount === 0) {
    return [];
  }
  // Процент выборки: чтобы получить примерно limit строк, берём (limit / rowCount) * 100,
  // с ограничениями и небольшим запасом (×1.5), т.к. SYSTEM даёт приблизительный объём.
  const rawPercent = (limit / rowCount) * 100 * 1.5;
  const percent = Math.min(
    SAMPLE_PERCENT_MAX,
    Math.max(SAMPLE_PERCENT_MIN, rawPercent)
  );
  log?.(`  rows: ${rowCount.toLocaleString()}, TABLESAMPLE SYSTEM (${percent.toFixed(2)}%), limit ${String(limit)}`);
  let sql = `SELECT id FROM ${full} TABLESAMPLE SYSTEM (${String(percent)}) LIMIT ${String(limit)}`;
  let results = await consumeQuery(trino, sql);
  const ids: string[] = [];
  for (const r of results) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length > 0 && row[0] != null) {
        ids.push(String(row[0]));
      }
    }
  }
  // TABLESAMPLE SYSTEM при малом проценте может вернуть 0 строк (блочная выборка). Fallback на ORDER BY random().
  if (ids.length === 0 && rowCount > 0) {
    log?.("  TABLESAMPLE returned 0 rows, using ORDER BY random()");
    sql = `SELECT id FROM ${full} ORDER BY random() LIMIT ${String(limit)}`;
    results = await consumeQuery(trino, sql);
    for (const r of results) {
      if (!r.data) continue;
      for (const row of r.data) {
        if (row.length > 0 && row[0] != null) {
          ids.push(String(row[0]));
        }
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
Usage: pnpm tsx scripts/bonus-registry-read-benchmark.ts [options]

Options:
  -n, --samples <n>   Number of random IDs to query per table (default: ${DEFAULT_SAMPLES})
  -o, --optimize      Run optimize on all tables before benchmark (default: true)
  --no-optimize       Skip optimize before benchmark
  -h, --help          Show this help

Examples:
  pnpm tsx scripts/bonus-registry-read-benchmark.ts
  pnpm tsx scripts/bonus-registry-read-benchmark.ts -n 200
  pnpm tsx scripts/bonus-registry-read-benchmark.ts --no-optimize
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

  console.log("Bonus registry partitioning read benchmark");
  console.log(`Trino: ${config.catalog}.${config.schema}`);
  console.log(`Samples per table: ${samples}, optimize before test: ${doOptimize}\n`);

  try {
    const optimizeTimesMs: Record<string, number> = {};
    if (doOptimize) {
      console.log("Running optimize on all tables...");
      for (const tbl of BONUS_REGISTRY_PARTITIONING_TABLE_NAMES) {
        process.stdout.write(`  ${tbl}... `);
        const t0 = performance.now();
        await runOptimize(trino, config.catalog, config.schema, tbl);
        optimizeTimesMs[tbl] = Math.round(performance.now() - t0);
        console.log(`${optimizeTimesMs[tbl]!.toLocaleString()} ms`);
      }
      console.log("\n--- Optimize times (ms) ---");
      for (const name of BONUS_REGISTRY_PARTITIONING_TABLE_NAMES) {
        console.log(`  ${name}: ${optimizeTimesMs[name]!.toLocaleString()}`);
      }
      console.log("");
    }

    const stats: Record<
      string,
      { min: number; max: number; avg: number; median: number; n: number }
    > = {};

    for (const tbl of BONUS_REGISTRY_PARTITIONING_TABLE_NAMES) {
      console.log(`Sampling ${samples} random IDs from ${tbl}...`);
      const ids = await collectIds(
        trino,
        config.catalog,
        config.schema,
        tbl,
        samples,
        console.log
      );
      if (ids.length === 0) {
        throw new Error(
          `No rows in ${tbl}; run bonus-registry-partitioning-fill first.`
        );
      }
      console.log(`Got ${ids.length} IDs. Benchmarking ${tbl}... `);

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
    const header = "Table                     |  Min    Max    Avg   Median | N";
    console.log(header);
    console.log("-".repeat(header.length));
    for (const tbl of BONUS_REGISTRY_PARTITIONING_TABLE_NAMES) {
      const s = stats[tbl]!;
      const row = `${tbl.padEnd(26)} | ${String(s.min.toFixed(2)).padStart(6)} ${String(s.max.toFixed(2)).padStart(6)} ${String(s.avg.toFixed(2)).padStart(6)} ${String(s.median.toFixed(2)).padStart(6)} | ${String(s.n)}`;
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
