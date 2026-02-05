/**
 * Бенчмарк скорости выполнения запросов из queries.txt к таблице bonus_registry_*.
 * Этап 1: подготовка (discovery + при необходимости UPDATE), лог и общее время.
 * Этап 2: несколько прогонов по каждому запросу с разными параметрами, min/max/avg/median.
 *
 * Запуск:
 *   pnpm tsx scripts/bonus-registry-queries-benchmark.ts
 *   pnpm tsx scripts/bonus-registry-queries-benchmark.ts --table bonus_registry_bucket32 --runs 5
 *   pnpm tsx scripts/bonus-registry-queries-benchmark.ts --no-prepare
 */

import { parseArgs } from "node:util";
import { BasicAuth, Trino } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../src/generator/escape.js";
import {
  getPartitioningTrinoConfig,
  BONUS_REGISTRY_PARTITIONING_TABLE_NAMES,
} from "./bonus-registry-partitioning-common.js";

// --- Константа таблицы (варианты: bonus_registry_bucket16, bonus_registry_bucket32, bonus_registry_bucket64, bonus_registry_bucket128)
const TABLE_NAME = "bonus_registry_bucket16";

const DEFAULT_RUNS = 5;
const DISCOVERY_LIMIT = 50;

interface TrinoRowResult {
  data?: unknown[][];
  columns?: { name: string }[];
  error?: { message: string };
}

interface QueryDef {
  id: number;
  name: string;
  /** SQL template: use {TABLE} for qualified table name, $1 $2 ... for parameters */
  sqlTemplate: string;
  paramCount: number;
}

function fullTableName(
  catalog: string,
  schema: string,
  table: string
): string {
  return `${escapeTrinoIdentifier(catalog)}.${escapeTrinoIdentifier(schema)}.${escapeTrinoIdentifier(table)}`;
}

/** Trino-варианты запросов 1–10 из queries.txt (snake_case, {TABLE} подставляется). */
function buildQueryDefs(fullTable: string): QueryDef[] {
  const T = fullTable;
  return [
    {
      id: 1,
      name: "Списания по документу",
      sqlTemplate: `SELECT amount FROM ${T} WHERE doc_to_track_id = $1 AND doc_to_track_type_id = $2 AND accounted_for_bs_profile_id = $3 AND bonus_type_id = $4 AND amount < 0 AND cancelled = false AND (date_of_expire IS NULL OR date_of_expire >= $5)`,
      paramCount: 5,
    },
    {
      id: 2,
      name: "Пагинация по профилю",
      sqlTemplate: `SELECT * FROM ${T} WHERE accounted_for_bs_profile_id = $1 ORDER BY "date" DESC LIMIT $2 OFFSET $3`,
      paramCount: 3,
    },
    {
      id: 3,
      name: "Записи по профилю без отменённых",
      sqlTemplate: `SELECT * FROM ${T} WHERE accounted_for_bs_profile_id = $1 AND cancelled = false`,
      paramCount: 1,
    },
    {
      id: 4,
      name: "Записи по bs_profile_id",
      sqlTemplate: `SELECT * FROM ${T} WHERE bs_profile_id = $1 AND cancelled = false`,
      paramCount: 1,
    },
    {
      id: 5,
      name: "Профиль + тип бонуса",
      sqlTemplate: `SELECT * FROM ${T} WHERE accounted_for_bs_profile_id = $1 AND cancelled = false AND bonus_type_id = $2`,
      paramCount: 2,
    },
    {
      id: 6,
      name: "Действующие по дате",
      sqlTemplate: `SELECT * FROM ${T} WHERE accounted_for_bs_profile_id = $1 AND date_of_expire >= $2`,
      paramCount: 2,
    },
    {
      id: 7,
      name: "GROUP BY bs_quota_id",
      sqlTemplate: `SELECT bs_quota_id, COUNT(bs_quota_id) AS _count_bs_quota_id FROM ${T} WHERE registrar_type_id = $1 AND cancelled = false AND bs_quota_id IS NOT NULL AND "row" = 1 GROUP BY bs_quota_id`,
      paramCount: 1,
    },
    {
      id: 8,
      name: "По документу (registrar)",
      sqlTemplate: `SELECT * FROM ${T} WHERE registrar_type_id = $1 AND registrar_id = $2`,
      paramCount: 2,
    },
    {
      id: 9,
      name: "Общая пагинация",
      sqlTemplate: `SELECT * FROM ${T} ORDER BY "date" DESC LIMIT $1 OFFSET $2`,
      paramCount: 2,
    },
    {
      id: 10,
      name: "По id",
      sqlTemplate: `SELECT * FROM ${T} WHERE id = $1 LIMIT 1`,
      paramCount: 1,
    },
  ];
}

/** Подставить параметры в SQL: $1, $2, ... заменяются на литералы (строка экранируется, число как есть). */
function substituteParams(
  sql: string,
  params: (string | number)[],
  options?: { dateParamIndexes?: Set<number> }
): string {
  let out = sql;
  const dateIndexes = options?.dateParamIndexes ?? new Set();
  for (let i = 0; i < params.length; i++) {
    const val = params[i];
    const replacement =
      typeof val === "number"
        ? String(val)
        : dateIndexes.has(i + 1)
          ? `DATE ${escapeTrinoLiteral(String(val))}`
          : escapeTrinoLiteral(String(val));
    out = out.replace(new RegExp(`\\$${i + 1}\\b`, "g"), replacement);
  }
  return out;
}

async function consumeQuery(
  trino: Trino,
  sql: string
): Promise<TrinoRowResult[]> {
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

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** Набор подготовленных значений для подстановки в запросы по прогонам. */
export interface PreparedParams {
  /** Для запроса 1: [ [doc_to_track_id, doc_to_track_type_id, accounted_for_bs_profile_id, bonus_type_id, date], ... ] */
  q1Rows: (string | number)[][];
  /** Для запросов 2,3,5,6: accounted_for_bs_profile_id[] */
  profileIds: string[];
  /** Для запроса 4: bs_profile_id[] */
  bsProfileIds: string[];
  /** Для запроса 5: (accounted_for_bs_profile_id, bonus_type_id)[] */
  q5Rows: [string, string][];
  /** Для запроса 6: (accounted_for_bs_profile_id, date_str)[] */
  q6Rows: [string, string][];
  /** Для запроса 7: registrar_type_id[] */
  registrarTypeIds: string[];
  /** Для запроса 8: (registrar_type_id, registrar_id)[] */
  q8Rows: [string, string][];
  /** Для запроса 9: (limit, offset)[] */
  q9Rows: [number, number][];
  /** Для запроса 10: id[] */
  ids: string[];
}

async function runPreparation(
  trino: Trino,
  catalog: string,
  schema: string,
  table: string,
  skipUpdates: boolean,
  log: (msg: string) => void
): Promise<PreparedParams> {
  const full = fullTableName(catalog, schema, table);

  log("Preparation: starting discovery queries...");

  const profileIds: string[] = [];
  const bsProfileIds: string[] = [];
  const q1Rows: (string | number)[][] = [];
  const q5Rows: [string, string][] = [];
  const q6Rows: [string, string][] = [];
  const registrarTypeIds: string[] = [];
  const q8Rows: [string, string][] = [];
  const ids: string[] = [];

  // Discovery: accounted_for_bs_profile_id с cancelled = false
  log("  Discovery: accounted_for_bs_profile_id (cancelled = false)...");
  const sqlProfiles = `SELECT DISTINCT accounted_for_bs_profile_id FROM ${full} WHERE cancelled = false LIMIT ${DISCOVERY_LIMIT}`;
  const resProfiles = await consumeQuery(trino, sqlProfiles);
  for (const r of resProfiles) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length > 0 && row[0] != null) profileIds.push(String(row[0]));
    }
  }
  log(`    Found ${profileIds.length} profile id(s).`);

  // Discovery: bs_profile_id с cancelled = false
  log("  Discovery: bs_profile_id (cancelled = false)...");
  const sqlBsProfiles = `SELECT DISTINCT bs_profile_id FROM ${full} WHERE cancelled = false LIMIT ${DISCOVERY_LIMIT}`;
  const resBsProfiles = await consumeQuery(trino, sqlBsProfiles);
  for (const r of resBsProfiles) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length > 0 && row[0] != null) bsProfileIds.push(String(row[0]));
    }
  }
  log(`    Found ${bsProfileIds.length} bs_profile id(s).`);

  // Discovery: строки для запроса 1 (amount < 0, cancelled = false)
  log("  Discovery: rows for query 1 (doc + amount < 0, cancelled = false)...");
  const sqlQ1 = `SELECT doc_to_track_id, doc_to_track_type_id, accounted_for_bs_profile_id, bonus_type_id, COALESCE(CAST(date_of_expire AS VARCHAR), '2099-01-01') FROM ${full} WHERE amount < 0 AND cancelled = false LIMIT ${DISCOVERY_LIMIT}`;
  const resQ1 = await consumeQuery(trino, sqlQ1);
  for (const r of resQ1) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length >= 5 && row[0] != null && row[1] != null && row[2] != null && row[3] != null) {
        const dateVal = row[4] != null ? String(row[4]) : "2099-01-01";
        q1Rows.push([String(row[0]), String(row[1]), String(row[2]), String(row[3]), dateVal]);
      }
    }
  }
  log(`    Found ${q1Rows.length} row(s) for query 1.`);

  // Discovery: пары (accounted_for_bs_profile_id, bonus_type_id) для запроса 5
  log("  Discovery: (profile_id, bonus_type_id) for query 5...");
  const sqlQ5 = `SELECT DISTINCT accounted_for_bs_profile_id, bonus_type_id FROM ${full} WHERE cancelled = false LIMIT ${DISCOVERY_LIMIT}`;
  const resQ5 = await consumeQuery(trino, sqlQ5);
  for (const r of resQ5) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length >= 2 && row[0] != null && row[1] != null)
        q5Rows.push([String(row[0]), String(row[1])]);
    }
  }
  log(`    Found ${q5Rows.length} pair(s) for query 5.`);

  // Discovery: (accounted_for_bs_profile_id, date_of_expire) для запроса 6
  log("  Discovery: (profile_id, date_of_expire) for query 6...");
  const sqlQ6 = `SELECT DISTINCT accounted_for_bs_profile_id, CAST(date_of_expire AS VARCHAR) FROM ${full} WHERE date_of_expire IS NOT NULL LIMIT ${DISCOVERY_LIMIT}`;
  const resQ6 = await consumeQuery(trino, sqlQ6);
  for (const r of resQ6) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length >= 2 && row[0] != null && row[1] != null)
        q6Rows.push([String(row[0]), String(row[1])]);
    }
  }
  log(`    Found ${q6Rows.length} pair(s) for query 6.`);

  // Discovery: registrar_type_id для запроса 7 (cancelled = false, bs_quota_id IS NOT NULL, row = 1)
  log("  Discovery: registrar_type_id for query 7...");
  const sqlQ7 = `SELECT DISTINCT registrar_type_id FROM ${full} WHERE cancelled = false AND bs_quota_id IS NOT NULL AND "row" = 1 LIMIT ${DISCOVERY_LIMIT}`;
  const resQ7 = await consumeQuery(trino, sqlQ7);
  for (const r of resQ7) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length > 0 && row[0] != null) registrarTypeIds.push(String(row[0]));
    }
  }
  log(`    Found ${registrarTypeIds.length} registrar_type_id(s) for query 7.`);

  // Discovery: (registrar_type_id, registrar_id) для запроса 8
  log("  Discovery: (registrar_type_id, registrar_id) for query 8...");
  const sqlQ8 = `SELECT DISTINCT registrar_type_id, registrar_id FROM ${full} WHERE registrar_type_id IS NOT NULL AND registrar_id IS NOT NULL LIMIT ${DISCOVERY_LIMIT}`;
  const resQ8 = await consumeQuery(trino, sqlQ8);
  for (const r of resQ8) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length >= 2 && row[0] != null && row[1] != null)
        q8Rows.push([String(row[0]), String(row[1])]);
    }
  }
  log(`    Found ${q8Rows.length} pair(s) for query 8.`);

  // Discovery: id для запроса 10
  log("  Discovery: id for query 10...");
  const sqlIds = `SELECT id FROM ${full} LIMIT ${DISCOVERY_LIMIT}`;
  const resIds = await consumeQuery(trino, sqlIds);
  for (const r of resIds) {
    if (!r.data) continue;
    for (const row of r.data) {
      if (row.length > 0 && row[0] != null) ids.push(String(row[0]));
    }
  }
  log(`    Found ${ids.length} id(s) for query 10.`);

  // Опционально: если по какому-то запросу данных нет — обновить несколько строк
  if (!skipUpdates) {
    if (q1Rows.length === 0 && ids.length > 0) {
      log("  Update: no rows for query 1; updating one row to satisfy query 1...");
      const idToUpdate = ids[0]!;
      const updSql = `UPDATE ${full} SET amount = -1, cancelled = false, date_of_expire = DATE '2099-01-01', doc_to_track_id = 'bench_doc_1', doc_to_track_type_id = 'bench_type_1', bonus_type_id = 'premial' WHERE id = ${escapeTrinoLiteral(idToUpdate)}`;
      await consumeQuery(trino, updSql);
      q1Rows.push(["bench_doc_1", "bench_type_1", profileIds[0] ?? "bench_profile_1", "premial", "2099-01-01"]);
      log("    Updated one row.");
    }
    if (registrarTypeIds.length === 0 && ids.length > 0) {
      log("  Update: no rows for query 7; updating a few rows (row=1, bs_quota_id NOT NULL, registrar_type_id)...");
      for (let i = 0; i < Math.min(3, ids.length); i++) {
        const idToUpdate = ids[i]!;
        const updSql = `UPDATE ${full} SET "row" = 1, bs_quota_id = 1, cancelled = false, registrar_type_id = 'bsBonusDocument' WHERE id = ${escapeTrinoLiteral(idToUpdate)}`;
        await consumeQuery(trino, updSql);
      }
      registrarTypeIds.push("bsBonusDocument");
      log("    Updated up to 3 rows.");
    }
    if (q8Rows.length === 0 && ids.length > 0) {
      log("  Update: no rows for query 8; updating one row (registrar_type_id, registrar_id)...");
      const idToUpdate = ids[0]!;
      const updSql = `UPDATE ${full} SET registrar_type_id = 'bsBonusDocument', registrar_id = 'bench_reg_1' WHERE id = ${escapeTrinoLiteral(idToUpdate)}`;
      await consumeQuery(trino, updSql);
      q8Rows.push(["bsBonusDocument", "bench_reg_1"]);
      log("    Updated one row.");
    }
  }

  // Пагинация для запроса 9: разные OFFSET
  const q9Rows: [number, number][] = [];
  const limits = [10, 20, 50];
  const offsets = [0, 100, 500, 1000, 2000];
  for (let i = 0; i < Math.max(limits.length, offsets.length) * 2; i++) {
    q9Rows.push([limits[i % limits.length]!, offsets[i % offsets.length]!]);
  }

  return {
    q1Rows: q1Rows.length > 0 ? q1Rows : [["bench_doc_1", "bench_type_1", "bench_profile_1", "premial", "2099-01-01"]],
    profileIds: profileIds.length > 0 ? profileIds : ["bench_profile_1"],
    bsProfileIds: bsProfileIds.length > 0 ? bsProfileIds : ["bench_bs_1"],
    q5Rows: q5Rows.length > 0 ? q5Rows : [[profileIds[0] ?? "bench_profile_1", "premial"]],
    q6Rows: q6Rows.length > 0 ? q6Rows : [[profileIds[0] ?? "bench_profile_1", "2020-01-01"]],
    registrarTypeIds: registrarTypeIds.length > 0 ? registrarTypeIds : ["bsBonusDocument"],
    q8Rows: q8Rows.length > 0 ? q8Rows : [["bsBonusDocument", "bench_reg_1"]],
    q9Rows,
    ids: ids.length > 0 ? ids : [],
  };
}

function getParamsForRun(
  prep: PreparedParams,
  queryId: number,
  runIndex: number
): (string | number)[] {
  switch (queryId) {
    case 1: {
      const row = prep.q1Rows[runIndex % prep.q1Rows.length];
      return row ? [...row] : [];
    }
    case 2: {
      const profileId = prep.profileIds[runIndex % prep.profileIds.length];
      const limit = 20;
      const offset = (runIndex * 10) % 5000;
      return [profileId ?? "bench", limit, offset];
    }
    case 3:
      return [prep.profileIds[runIndex % prep.profileIds.length] ?? "bench"];
    case 4:
      return [prep.bsProfileIds[runIndex % prep.bsProfileIds.length] ?? "bench"];
    case 5: {
      const pair = prep.q5Rows[runIndex % prep.q5Rows.length];
      return pair ? [pair[0], pair[1]] : ["bench", "premial"];
    }
    case 6: {
      const pair = prep.q6Rows[runIndex % prep.q6Rows.length];
      return pair ? [pair[0], pair[1]] : ["bench", "2020-01-01"];
    }
    case 7:
      return [prep.registrarTypeIds[runIndex % prep.registrarTypeIds.length] ?? "bsBonusDocument"];
    case 8: {
      const pair = prep.q8Rows[runIndex % prep.q8Rows.length];
      return pair ? [pair[0], pair[1]] : ["bsBonusDocument", "bench_reg_1"];
    }
    case 9: {
      const pair = prep.q9Rows[runIndex % prep.q9Rows.length];
      return pair ? [pair[0], pair[1]] : [20, 0];
    }
    case 10: {
      const id = prep.ids.length > 0 ? prep.ids[runIndex % prep.ids.length] : "";
      return [id ?? ""];
    }
    default:
      return [];
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      table: { type: "string", short: "t" },
      runs: { type: "string", short: "n", default: String(DEFAULT_RUNS) },
      "no-prepare": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`
Usage: pnpm tsx scripts/bonus-registry-queries-benchmark.ts [options]

Options:
  -t, --table <name>   Table name (default: ${TABLE_NAME}). One of: ${BONUS_REGISTRY_PARTITIONING_TABLE_NAMES.join(", ")}
  -n, --runs <n>       Number of runs per query (default: ${DEFAULT_RUNS})
  --no-prepare         Skip preparation updates; only run discovery to collect param values
  -h, --help           Show this help

Examples:
  pnpm tsx scripts/bonus-registry-queries-benchmark.ts
  pnpm tsx scripts/bonus-registry-queries-benchmark.ts --table bonus_registry_bucket32 --runs 5
  pnpm tsx scripts/bonus-registry-queries-benchmark.ts --no-prepare
`);
    process.exit(0);
  }

  const tableName = (values.table ?? TABLE_NAME) as string;
  if (!BONUS_REGISTRY_PARTITIONING_TABLE_NAMES.includes(tableName as typeof BONUS_REGISTRY_PARTITIONING_TABLE_NAMES[number])) {
    console.error(`Invalid table: ${tableName}. Must be one of: ${BONUS_REGISTRY_PARTITIONING_TABLE_NAMES.join(", ")}`);
    process.exit(1);
  }

  const runs = Math.max(
    1,
    Number.parseInt(String(values.runs).replace(/_/g, ""), 10)
  );
  const skipPrepareUpdates = values["no-prepare"] === true;

  const config = getPartitioningTrinoConfig();
  const trino = Trino.create({
    server: `http://${config.host}:${String(config.port)}`,
    catalog: config.catalog,
    schema: config.schema,
    auth: new BasicAuth(config.user),
  });

  const fullTable = fullTableName(config.catalog, config.schema, tableName);
  const queryDefs = buildQueryDefs(fullTable);

  console.log("Bonus registry queries benchmark");
  console.log(`Table: ${tableName}, Trino: ${config.catalog}.${config.schema}`);
  console.log(`Runs per query: ${runs}, skip prepare updates: ${skipPrepareUpdates}\n`);

  try {
    // --- Preparation
    const prepStart = performance.now();
    const prep = await runPreparation(
      trino,
      config.catalog,
      config.schema,
      tableName,
      skipPrepareUpdates,
      console.log
    );
    const prepTotalMs = Math.round(performance.now() - prepStart);
    console.log(`Preparation total: ${prepTotalMs} ms\n`);

    if (prep.ids.length === 0) {
      console.warn("Warning: no ids found; query 10 may fail or use empty id.");
    }

    // --- Benchmark
    console.log("--- Benchmark ---");
    const stats: { id: number; name: string; min: number; max: number; avg: number; median: number; n: number }[] = [];

    for (const q of queryDefs) {
      const times: number[] = [];
      for (let run = 0; run < runs; run++) {
        const params = getParamsForRun(prep, q.id, run);
        if (q.id === 10 && params[0] === "") continue; // skip if no ids
        const dateParamIndexes =
          q.id === 1 ? new Set([5]) : q.id === 6 ? new Set([2]) : undefined;
        const sql = substituteParams(q.sqlTemplate, params, { dateParamIndexes });
        const start = performance.now();
        await consumeQuery(trino, sql);
        times.push(performance.now() - start);
      }
      if (times.length === 0) {
        console.warn(`  Query ${q.id} (${q.name}): no runs (missing params?).`);
        continue;
      }
      const min = Math.min(...times);
      const max = Math.max(...times);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const med = median(times);
      stats.push({ id: q.id, name: q.name, min, max, avg, median: med, n: times.length });
    }

    console.log("\n--- Results (ms) ---");
    const header = "Query | Name                          |  Min    Max    Avg  Median | N";
    console.log(header);
    console.log("-".repeat(header.length));
    for (const s of stats) {
      const row = `${String(s.id).padStart(5)} | ${s.name.padEnd(30)} | ${String(s.min.toFixed(2)).padStart(6)} ${String(s.max.toFixed(2)).padStart(6)} ${String(s.avg.toFixed(2)).padStart(6)} ${String(s.median.toFixed(2)).padStart(6)} | ${s.n}`;
      console.log(row);
    }
    console.log("\nDone.");
  } catch (err) {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
