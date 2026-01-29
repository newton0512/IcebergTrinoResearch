/**
 * Общие конфиг и имена таблиц для бенчмарка партиционирования Iceberg.
 * Используется partitioning-create-tables, partitioning-ensure-and-fill, partitioning-read-benchmark.
 */

export const PARTITIONING_TABLE_NAMES = [
  "part_bench_none",
  "part_bench_bucket32",
  "part_bench_month",
  "part_bench_month_trunc2",
  "part_bench_trunc2",
  "part_bench_trunc2_month",
] as const;

export type PartitioningTableName = (typeof PARTITIONING_TABLE_NAMES)[number];

export interface PartitioningTrinoConfig {
  host: string;
  port: number;
  catalog: string;
  schema: string;
  user: string;
}

export function getPartitioningTrinoConfig(): PartitioningTrinoConfig {
  return {
    host: process.env.TRINO_HOST ?? "localhost",
    port: Number.parseInt(process.env.TRINO_PORT ?? "8080", 10),
    catalog: process.env.TRINO_CATALOG ?? "iceberg",
    schema: process.env.TRINO_SCHEMA ?? "partitioning_bench",
    user: process.env.TRINO_USER ?? "trino",
  };
}
