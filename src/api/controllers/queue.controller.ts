/**
 * Контроллер для получения статуса очереди trino_queue
 */

import type { Request, Response } from "express";
import { connectPostgres, getPostgresConfig } from "../../hybrid-writer/utils.js";
import { escapePostgresIdentifier } from "../../generator/escape.js";
import type { ApiResponse, QueueStatusResponse } from "../types.js";

/**
 * Получение статуса очереди trino_queue
 * GET /api/queue/status
 */
export async function queueStatus(req: Request, res: Response): Promise<void> {
  try {
    const postgresConfig = getPostgresConfig();
    const sql = await connectPostgres(postgresConfig);

    try {
      const queueTable = escapePostgresIdentifier("trino_queue");

      // Общая статистика
      const totalStats = await sql.unsafe<Array<{
        total: number;
        min_id: number;
        max_id: number;
        oldest: Date;
        newest: Date;
      }>>(`
        SELECT 
          COUNT(*) as total,
          MIN(id) as min_id,
          MAX(id) as max_id,
          MIN(created_at) as oldest,
          MAX(created_at) as newest
        FROM ${queueTable}
      `);

      const totalRecords = Number(totalStats[0]?.total) || 0;

      // Статистика по типам операций
      const operationStats = await sql.unsafe<Array<{
        operation_type: string;
        count: number;
      }>>(`
        SELECT 
          operation_type,
          COUNT(*) as count
        FROM ${queueTable}
        GROUP BY operation_type
      `);

      const recordsByOperationType: Record<string, number> = {};
      for (const row of operationStats) {
        const opType = String(row.operation_type || "UNKNOWN");
        recordsByOperationType[opType] = Number(row.count) || 0;
      }

      // Самая старая запись
      let oldestRecord: { id: number; created_at: string } | undefined;
      if (totalStats[0]?.oldest) {
        oldestRecord = {
          id: Number(totalStats[0].min_id) || 0,
          created_at: new Date(totalStats[0].oldest).toISOString(),
        };
      }

      // Самая новая запись
      let newestRecord: { id: number; created_at: string } | undefined;
      if (totalStats[0]?.newest) {
        newestRecord = {
          id: Number(totalStats[0].max_id) || 0,
          created_at: new Date(totalStats[0].newest).toISOString(),
        };
      }

      const queueStatus: QueueStatusResponse = {
        totalRecords,
        oldestRecord,
        newestRecord,
        recordsByOperationType,
      };

      const response: ApiResponse<QueueStatusResponse> = {
        success: true,
        data: queueStatus,
      };

      res.json(response);
    } finally {
      await sql.end();
    }
  } catch (error) {
    console.error("Error getting queue status:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
