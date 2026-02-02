/**
 * Общие конфиг и имена таблиц для бенчмарка партиционирования bonus_registry.
 * Используется bonus-registry-partitioning-create-tables, -fill, -read-benchmark.
 */

export const BONUS_REGISTRY_PARTITIONING_TABLE_NAMES = [
  "bonus_registry_bucket32",
  "bonus_registry_bucket64",
] as const;

export type BonusRegistryPartitioningTableName =
  (typeof BONUS_REGISTRY_PARTITIONING_TABLE_NAMES)[number];

export { getPartitioningTrinoConfig } from "./partitioning-common.js";
export type { PartitioningTrinoConfig } from "./partitioning-common.js";
