/**
 * Контроллер для получения статистики таблиц
 */

import type { Request, Response } from "express";
import { Trino } from "trino-client";
import { BasicAuth } from "trino-client";
import { escapeTrinoIdentifier } from "../../generator/escape.js";
import { getTrinoConfig } from "../../hybrid-writer/utils.js";
import { connectPostgres, getPostgresConfig } from "../../hybrid-writer/utils.js";
import { escapePostgresIdentifier } from "../../generator/escape.js";
import type { ApiResponse, StatsResponse } from "../types.js";

const trinoConfig = getTrinoConfig();

function getTrinoClient(): Trino {
  return Trino.create({
    server: `http://${trinoConfig.host}:${trinoConfig.port}`,
    catalog: trinoConfig.catalog,
    schema: trinoConfig.schema,
    auth: new BasicAuth(trinoConfig.user),
  });
}

/**
 * Получение статистики всех таблиц
 * GET /api/stats
 */
export async function stats(req: Request, res: Response): Promise<void> {
  try {
    const stats: StatsResponse = {
      bonusRegistry: {
        totalRecords: 0,
      },
      trinoQueue: {
        totalRecords: 0,
        recordsByOperationType: {},
      },
      postgresTables: {
        uniqueCheck: 0,
        balanceCheck: 0,
      },
    };

    // Статистика bonus_registry в Trino
    try {
      const trino = getTrinoClient();
      const escapedCatalog = escapeTrinoIdentifier(trinoConfig.catalog);
      const escapedSchema = escapeTrinoIdentifier(trinoConfig.schema);
      const escapedTable = escapeTrinoIdentifier("bonus_registry");
      const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

      const countQuery = `SELECT COUNT(*) as count FROM ${fullTableName}`;
      const countResult = await trino.query(countQuery);

      for await (const row of countResult) {
        if (row && typeof row === "object" && "data" in row) {
          if (Array.isArray((row as { data: unknown }).data) && (row as { data: unknown[] }).data.length > 0) {
            const firstRow = (row as { data: unknown[][] }).data[0];
            if (Array.isArray(firstRow) && firstRow.length > 0) {
              stats.bonusRegistry.totalRecords = Number(firstRow[0]) || 0;
            }
          }
        }
      }
    } catch (error) {
      console.error("Error getting bonus_registry stats:", error);
    }

    // Статистика trino_queue и других таблиц в PostgreSQL
    try {
      const postgresConfig = getPostgresConfig();
      const sql = await connectPostgres(postgresConfig);

      try {
        // Статистика trino_queue
        const queueTable = escapePostgresIdentifier("trino_queue");
        const queueStats = await sql.unsafe<Array<{
          total: number;
          operation_type: string;
          min_id: number;
          max_id: number;
          oldest: Date;
          newest: Date;
        }>>(`
          SELECT 
            COUNT(*) as total,
            operation_type,
            MIN(id) as min_id,
            MAX(id) as max_id,
            MIN(created_at) as oldest,
            MAX(created_at) as newest
          FROM ${queueTable}
          GROUP BY operation_type
        `);

        let totalRecords = 0;
        const recordsByOperationType: Record<string, number> = {};
        let oldestRecord: { id: number; created_at: string } | undefined;
        let newestRecord: { id: number; created_at: string } | undefined;

        for (const row of queueStats) {
          const count = Number(row.total) || 0;
          totalRecords += count;
          const opType = String(row.operation_type || "UNKNOWN");
          recordsByOperationType[opType] = count;

          // Обновляем oldest/newest
          if (row.oldest && (!oldestRecord || new Date(row.oldest) < new Date(oldestRecord.created_at))) {
            oldestRecord = {
              id: Number(row.min_id) || 0,
              created_at: new Date(row.oldest).toISOString(),
            };
          }
          if (row.newest && (!newestRecord || new Date(row.newest) > new Date(newestRecord.created_at))) {
            newestRecord = {
              id: Number(row.max_id) || 0,
              created_at: new Date(row.newest).toISOString(),
            };
          }
        }

        stats.trinoQueue = {
          totalRecords,
          oldestRecord,
          newestRecord,
          recordsByOperationType,
        };

        // Статистика bonus_registry_unique_check
        const uniqueCheckTable = escapePostgresIdentifier("bonus_registry_unique_check");
        const uniqueCheckCount = await sql.unsafe<Array<{ count: number }>>(
          `SELECT COUNT(*) as count FROM ${uniqueCheckTable}`
        );
        stats.postgresTables.uniqueCheck = Number(uniqueCheckCount[0]?.count) || 0;

        // Статистика bonus_registry_balance_check
        const balanceCheckTable = escapePostgresIdentifier("bonus_registry_balance_check");
        const balanceCheckCount = await sql.unsafe<Array<{ count: number }>>(
          `SELECT COUNT(*) as count FROM ${balanceCheckTable}`
        );
        stats.postgresTables.balanceCheck = Number(balanceCheckCount[0]?.count) || 0;
      } finally {
        await sql.end();
      }
    } catch (error) {
      console.error("Error getting PostgreSQL stats:", error);
    }

    const response: ApiResponse<StatsResponse> = {
      success: true,
      data: stats,
    };

    res.json(response);
  } catch (error) {
    console.error("Error getting stats:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
