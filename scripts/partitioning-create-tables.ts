/**
 * Создание шести Iceberg-таблиц с разным партиционированием для бенчмарка чтения.
 *
 * Запуск: pnpm tsx scripts/partitioning-create-tables.ts
 */

import { parseArgs } from "node:util";
import { BasicAuth, Trino } from "trino-client";
import { escapeTrinoIdentifier } from "../src/generator/escape.js";
import {
  getPartitioningTrinoConfig,
  PARTITIONING_TABLE_NAMES,
} from "./partitioning-common.js";

const COLUMNS = "id VARCHAR NOT NULL, dt TIMESTAMP NOT NULL";

interface TablePartitionSpec {
  name: (typeof PARTITIONING_TABLE_NAMES)[number];
  /** partition transforms for WITH (partitioning = ARRAY[...]). Omit = no partitioning. */
  partitioning?: string[];
}

const TABLE_SPECS: TablePartitionSpec[] = [
  { name: "part_bench_none" },
  { name: "part_bench_bucket32", partitioning: ["bucket(id, 32)"] },
  { name: "part_bench_month", partitioning: ["month(dt)"] },
  {
    name: "part_bench_month_trunc2",
    partitioning: ["month(dt)", "truncate(id, 2)"],
  },
  { name: "part_bench_trunc2", partitioning: ["truncate(id, 2)"] },
  {
    name: "part_bench_trunc2_month",
    partitioning: ["truncate(id, 2)", "month(dt)"],
  },
];

async function executeQuery(
  query: AsyncIterable<unknown>,
  operation: string,
  sql?: string
): Promise<void> {
  for await (const result of query) {
    const r = result as { error?: { message?: string; code?: number } };
    if (r?.error) {
      const msg = `Trino ${operation} failed: ${r.error.message ?? "unknown"}`;
      const code = r.error.code != null ? ` (code: ${r.error.code})` : "";
      const sqlHint = sql ? `\nSQL: ${sql}` : "";
      throw new Error(`${msg}${code}${sqlHint}`);
    }
  }
}

/**
 * Создаёт схему и шесть Iceberg-таблиц в Trino.
 * Используется скриптом и partitioning-ensure-and-fill.
 * @param dropFirst – если true, перед созданием выполняет DROP TABLE IF EXISTS для каждой таблицы.
 */
export async function createPartitioningTables(
  trino: Trino,
  catalog: string,
  schema: string,
  dropFirst = false
): Promise<void> {
  const ec = escapeTrinoIdentifier(catalog);
  const es = escapeTrinoIdentifier(schema);
  const fullSchema = `${ec}.${es}`;

  const schemaSql = `CREATE SCHEMA IF NOT EXISTS ${fullSchema}`;
  await executeQuery(await trino.query(schemaSql), "create schema");
  console.log(`✓ Schema ${fullSchema} created or already exists`);

  if (dropFirst) {
    for (const spec of TABLE_SPECS) {
      const et = escapeTrinoIdentifier(spec.name);
      const fullTable = `${fullSchema}.${et}`;
      await executeQuery(
        await trino.query(`DROP TABLE IF EXISTS ${fullTable}`),
        "drop table"
      );
      console.log(`  Dropped ${spec.name}`);
    }
    console.log("");
  }

  for (const spec of TABLE_SPECS) {
    const et = escapeTrinoIdentifier(spec.name);
    const fullTable = `${fullSchema}.${et}`;
    const withClause = spec.partitioning
      ? `format = 'PARQUET', partitioning = ARRAY[${spec.partitioning.map((p) => `'${p.replace(/'/g, "''")}'`).join(", ")}]`
      : "format = 'PARQUET'";
    const createSql = `CREATE TABLE IF NOT EXISTS ${fullTable} (${COLUMNS}) WITH (${withClause})`;
    try {
      await executeQuery(await trino.query(createSql), "create table", createSql);
      console.log(`✓ Table ${fullTable} created or already exists`);
    } catch (err) {
      console.error(`✗ Failed to create ${fullTable}:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      drop: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(`
Usage: pnpm tsx scripts/partitioning-create-tables.ts [options]

Options:
  --drop   Drop existing partitioning tables before creating (use after schema changes).
  -h       Show this help.
`);
    process.exit(0);
  }

  const config = getPartitioningTrinoConfig();
  console.log("Partitioning benchmark: create tables");
  console.log(`Trino: ${config.host}:${config.port} / ${config.catalog}.${config.schema}\n`);

  const trino = Trino.create({
    server: `http://${config.host}:${String(config.port)}`,
    catalog: config.catalog,
    schema: config.schema,
    auth: new BasicAuth(config.user),
  });

  try {
    await createPartitioningTables(
      trino,
      config.catalog,
      config.schema,
      values.drop ?? false
    );
    console.log("\n✓ All partitioning tables created.");
  } catch (err) {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const invoked = process.argv[1]?.includes("partitioning-create-tables");
if (invoked) {
  main().catch((err: unknown) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
