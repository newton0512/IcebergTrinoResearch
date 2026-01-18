/**
 * Контроллер для проверки задержек чтения
 */

import type { Request, Response } from "express";
import { Trino } from "trino-client";
import { BasicAuth } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../../generator/escape.js";
import { getTrinoConfig } from "../../hybrid-writer/utils.js";
import type { ApiResponse, ReadDelayRequest } from "../types.js";

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
 * Проверка задержек чтения
 * GET /api/read-delay?iterations=10&recordId=xxx
 */
export async function readDelay(req: Request, res: Response): Promise<void> {
  try {
    const query = req.query as unknown as ReadDelayRequest;
    const iterations = query.iterations ?? 10;
    const recordId = query.recordId;

    if (iterations > 100) {
      res.status(400).json({
        success: false,
        error: "Iterations cannot exceed 100",
      });
      return;
    }

    const trino = getTrinoClient();
    const escapedCatalog = escapeTrinoIdentifier(trinoConfig.catalog);
    const escapedSchema = escapeTrinoIdentifier(trinoConfig.schema);
    const escapedTable = escapeTrinoIdentifier("bonus_registry");
    const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

    let targetId = recordId;

    // Если recordId не указан, выбираем случайную запись
    if (!targetId) {
      // В Trino используется random() (строчными буквами), но проще использовать OFFSET
      // Получаем общее количество и выбираем случайный OFFSET
      const countQuery = `SELECT COUNT(*) as count FROM ${fullTableName}`;
      const countResult = await trino.query(countQuery);
      let totalCount = 0;
      
      for await (const row of countResult) {
        if (row && typeof row === "object" && "data" in row) {
          if (Array.isArray((row as { data: unknown }).data) && (row as { data: unknown[] }).data.length > 0) {
            const firstRow = (row as { data: unknown[][] }).data[0];
            if (Array.isArray(firstRow) && firstRow.length > 0) {
              totalCount = Number(firstRow[0]) || 0;
            }
          }
        }
      }

      if (totalCount === 0) {
        res.status(404).json({
          success: false,
          error: "No records found in table",
        });
        return;
      }

      const randomOffset = Math.floor(Math.random() * totalCount);
      const randomQuery = `
        SELECT id FROM ${fullTableName}
        ORDER BY id
        LIMIT 1
        OFFSET ${randomOffset}
      `;

      const randomResult = await trino.query(randomQuery);
      for await (const row of randomResult) {
        if (row && typeof row === "object" && "error" in row) {
          const error = (row as { error: { message?: string } }).error;
          throw new Error(error?.message || "Query failed");
        }
        if (row && typeof row === "object" && "data" in row) {
          if (Array.isArray((row as { data: unknown }).data) && (row as { data: unknown[] }).data.length > 0) {
            const firstRow = (row as { data: unknown[][] }).data[0];
            if (Array.isArray(firstRow) && firstRow.length > 0) {
              targetId = String(firstRow[0]);
            }
          }
        }
      }

      if (!targetId) {
        res.status(404).json({
          success: false,
          error: "Failed to select random record",
        });
        return;
      }
    }

    // Выполняем N чтений одной и той же записи
    const readTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const readStartTime = Date.now();
      
      const readQuery = `SELECT * FROM ${fullTableName} WHERE id = ${escapeTrinoLiteral(targetId)} LIMIT 1`;
      const readResult = await trino.query(readQuery);

      // Потребляем результат
      for await (const row of readResult) {
        if (row && typeof row === "object" && "error" in row) {
          const error = (row as { error: { message?: string } }).error;
          throw new Error(error?.message || "Read failed");
        }
      }

      const readDuration = Date.now() - readStartTime;
      readTimes.push(readDuration);
    }

    // Статистика
    const minTime = Math.min(...readTimes);
    const maxTime = Math.max(...readTimes);
    const avgTime = readTimes.reduce((sum, time) => sum + time, 0) / readTimes.length;
    const medianTime = [...readTimes].sort((a, b) => a - b)[Math.floor(readTimes.length / 2)];

    const response: ApiResponse<{
      recordId: string;
      iterations: number;
      readTimes: number[];
      statistics: {
        min: number;
        max: number;
        avg: number;
        median: number;
      };
    }> = {
      success: true,
      data: {
        recordId: targetId,
        iterations,
        readTimes,
        statistics: {
          min: minTime,
          max: maxTime,
          avg: avgTime,
          median: medianTime,
        },
      },
    };

    res.json(response);
  } catch (error) {
    console.error("Error checking read delay:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
