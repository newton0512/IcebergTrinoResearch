/**
 * Создание двух Iceberg-таблиц bonus_registry с разным партиционированием для бенчмарка.
 * 1) bonus_registry_bucket32 — bucket(accounted_for_bs_profile_id, 32)
 * 2) bonus_registry_bucket64 — bucket(accounted_for_bs_profile_id, 64)
 *
 * Запуск: pnpm tsx scripts/bonus-registry-partitioning-create-tables.ts [--drop]
 */

import { parseArgs } from "node:util";
import { BasicAuth, Trino } from "trino-client";
import { escapeTrinoIdentifier } from "../src/generator/escape.js";
import {
  getPartitioningTrinoConfig,
  BONUS_REGISTRY_PARTITIONING_TABLE_NAMES,
} from "./bonus-registry-partitioning-common.js";

const BONUS_REGISTRY_COLUMNS = [
  "id VARCHAR",
  '"date" TIMESTAMP',
  "registrar_type_id VARCHAR",
  "registrar_id VARCHAR",
  '"row" INTEGER',
  "manager_id INTEGER",
  "bs_profile_id VARCHAR NOT NULL",
  "accounted_for_bs_profile_id VARCHAR NOT NULL",
  "first_name VARCHAR",
  "first_name_latin VARCHAR",
  "last_name VARCHAR",
  "last_name_latin VARCHAR",
  "departure_id INTEGER",
  "arrival_id INTEGER",
  "departure_date DATE",
  "currency_entry_id INTEGER",
  "bonus_type_id VARCHAR NOT NULL",
  "action_source_id VARCHAR NOT NULL",
  "bs_bonus_ticket_id VARCHAR",
  "validity_time INTEGER",
  "date_of_expire DATE",
  "car_type_id VARCHAR",
  "express_carrier_id INTEGER",
  "carrier_id VARCHAR",
  "bs_partner_id INTEGER",
  "bs_train_number_id VARCHAR",
  "bs_tourism_train_id VARCHAR",
  "accounted_in_calculation BOOLEAN",
  "cancelled BOOLEAN",
  "bs_quota_id INTEGER",
  "doc_to_track_type_id VARCHAR NOT NULL",
  "doc_to_track_id VARCHAR NOT NULL",
  "doc_to_track_date DATE",
  "active_date DATE",
  "trip_for_another_person BOOLEAN",
  "ticket_number VARCHAR",
  "currency_amount INTEGER",
  "amount INTEGER NOT NULL",
  "bs_partner_bonus_type_id VARCHAR",
  "express_service_class_id INTEGER",
  "date_to_cancelled TIMESTAMP",
  "prolongable BOOLEAN",
  "active_by_trips BOOLEAN",
  "is_empty BOOLEAN",
  "amount_calculation VARCHAR",
  "distance INTEGER",
  "addition_amount INTEGER",
  "operation_doc_type_id VARCHAR",
  "is_merged BOOLEAN",
  "merged_date DATE",
  "created_at TIMESTAMP",
  "ingested_at TIMESTAMP",
].join(", ");

const TABLE_SPECS: ReadonlyArray<{
  name: (typeof BONUS_REGISTRY_PARTITIONING_TABLE_NAMES)[number];
  partitioning: string;
}> = [
  { name: "bonus_registry_bucket16", partitioning: "bucket(accounted_for_bs_profile_id, 16)" },
  { name: "bonus_registry_bucket32", partitioning: "bucket(accounted_for_bs_profile_id, 32)" },
  { name: "bonus_registry_bucket64", partitioning: "bucket(accounted_for_bs_profile_id, 64)" },
  { name: "bonus_registry_bucket128", partitioning: "bucket(accounted_for_bs_profile_id, 128)" },
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

export async function createBonusRegistryPartitioningTables(
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
    const partitioningEscaped = spec.partitioning.replace(/'/g, "''");
    const withClause = `format = 'PARQUET', format_version = 2, partitioning = ARRAY['${partitioningEscaped}']`;
    const createSql = `CREATE TABLE IF NOT EXISTS ${fullTable} (${BONUS_REGISTRY_COLUMNS}) WITH (${withClause})`;
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
Usage: pnpm tsx scripts/bonus-registry-partitioning-create-tables.ts [options]

Options:
  --drop   Drop existing bonus_registry partitioning tables before creating.
  -h       Show this help.
`);
    process.exit(0);
  }

  const config = getPartitioningTrinoConfig();
  console.log("Bonus registry partitioning: create tables");
  console.log(`Trino: ${config.host}:${config.port} / ${config.catalog}.${config.schema}\n`);

  const trino = Trino.create({
    server: `http://${config.host}:${String(config.port)}`,
    catalog: config.catalog,
    schema: config.schema,
    auth: new BasicAuth(config.user),
  });

  try {
    await createBonusRegistryPartitioningTables(
      trino,
      config.catalog,
      config.schema,
      values.drop ?? false
    );
    console.log("\n✓ All bonus_registry partitioning tables created.");
  } catch (err) {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const invoked = process.argv[1]?.includes("bonus-registry-partitioning-create-tables");
if (invoked) {
  main().catch((err: unknown) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
