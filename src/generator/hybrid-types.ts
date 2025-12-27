import type { PostgresConfig, TrinoConfig } from "./index.js";
import type { GeneratorConfig } from "./types.js";

export interface HybridGeneratorConfig {
  postgresConfig: PostgresConfig;
  trinoConfig: TrinoConfig;
  
  // Маппинг: какие колонки из TableConfig идут в PostgreSQL
  postgresColumnMapping: {
    sourceColumn: string; // имя колонки из TableConfig
    targetColumn: string; // имя колонки в PostgreSQL таблице
  }[];
  
  // Маппинг: какие колонки идут в Trino (остальные генерируются)
  trinoColumnMapping: {
    sourceColumn: string; // имя колонки из TableConfig или из PostgreSQL
    targetColumn: string; // имя колонки в Trino таблице
    generator?: GeneratorConfig; // если нужно генерировать в Trino
  }[];
  
  // Имена таблиц
  postgresTableName: string;
  trinoTableName: string;
  
  // Связующие колонки для JOIN (опционально)
  joinColumns?: {
    postgresColumn: string;
    trinoColumn: string;
  }[];
}

export interface HybridGeneratorConfigV2 extends HybridGeneratorConfig {
  // Размер подбатча для Saga (по умолчанию 100K)
  sagaBatchSize?: number;
}

