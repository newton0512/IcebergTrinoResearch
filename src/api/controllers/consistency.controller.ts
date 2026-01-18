/**
 * Контроллер для проверки согласованности данных
 * (запись через hybrid-writer и последующее чтение из Trino)
 */

import type { Request, Response } from "express";
import { Trino } from "trino-client";
import { BasicAuth } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../../generator/escape.js";
import { getTrinoConfig } from "../../hybrid-writer/utils.js";
import { HybridWriterWithQueue, getHybridWriterWithQueueConfig } from "../../hybrid-writer-with-ps-query/hybrid-writer.js";
import type { ApiResponse, ConsistencyCheckRequest } from "../types.js";

const trinoConfig = getTrinoConfig();

function getTrinoClient(): Trino {
  return Trino.create({
    server: `http://${trinoConfig.host}:${trinoConfig.port}`,
    catalog: trinoConfig.catalog,
    schema: trinoConfig.schema,
    auth: new BasicAuth(trinoConfig.user),
  });
}

let writerInstance: HybridWriterWithQueue | null = null;

async function getWriter(): Promise<HybridWriterWithQueue> {
  if (!writerInstance) {
    const config = getHybridWriterWithQueueConfig();
    writerInstance = new HybridWriterWithQueue(config);
    await writerInstance.connect();
  }
  return writerInstance;
}

/**
 * Проверка согласованности данных
 * POST /api/consistency-check?count=10
 */
export async function consistencyCheck(req: Request, res: Response): Promise<void> {
  try {
    const query = req.query as unknown as ConsistencyCheckRequest;
    const count = query.count ?? 10;
    
    if (count > 100) {
      res.status(400).json({
        success: false,
        error: "Count cannot exceed 100",
      });
      return;
    }

    const writer = await getWriter();
    const trino = getTrinoClient();
    const escapedCatalog = escapeTrinoIdentifier(trinoConfig.catalog);
    const escapedSchema = escapeTrinoIdentifier(trinoConfig.schema);
    const escapedTable = escapeTrinoIdentifier("bonus_registry");
    const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

    const results: Array<{
      writeResult: {
        registrar_type_id: string;
        registrar_id: string;
        row: number;
        amount: number;
        queueId: number;
      };
      foundInTrino: boolean;
      readDelay?: number; // время до появления в Trino (мс)
      error?: string;
    }> = [];

    // Записываем N записей и проверяем их наличие в Trino
    for (let i = 0; i < count; i++) {
      const writeStartTime = Date.now();
      
      try {
        // Шаг 1: Запись через hybrid-writer
        const writeResult = await writer.write({});
        const writeDuration = Date.now() - writeStartTime;

        // Шаг 2: Ожидание появления в Trino (проверяем по queueId или по данным)
        const checkStartTime = Date.now();
        let foundInTrino = false;
        let readDelay = 0;
        const maxWaitTime = 30000; // максимум 30 секунд ожидания
        const checkInterval = 1000; // проверяем каждую секунду
        let elapsed = 0;

        while (!foundInTrino && elapsed < maxWaitTime) {
          // Ищем запись по registrar_id и registrar_type_id
          const searchQuery = `
            SELECT id FROM ${fullTableName}
            WHERE registrar_id = ${escapeTrinoLiteral(writeResult.registrar_id)}
              AND registrar_type_id = ${escapeTrinoLiteral(writeResult.registrar_type_id)}
              AND "row" = ${writeResult.row}
            LIMIT 1
          `;

          const searchResult = await trino.query(searchQuery);
          let found = false;

          for await (const row of searchResult) {
            if (row && typeof row === "object" && "data" in row) {
              if (Array.isArray((row as { data: unknown }).data) && (row as { data: unknown[] }).data.length > 0) {
                found = true;
                break;
              }
            }
          }

          if (found) {
            foundInTrino = true;
            readDelay = Date.now() - checkStartTime;
          } else {
            await new Promise((resolve) => setTimeout(resolve, checkInterval));
            elapsed += checkInterval;
          }
        }

        results.push({
          writeResult,
          foundInTrino,
          readDelay: foundInTrino ? readDelay : undefined,
          error: !foundInTrino ? `Record not found in Trino after ${maxWaitTime}ms` : undefined,
        });
      } catch (error) {
        results.push({
          writeResult: {
            registrar_type_id: "",
            registrar_id: "",
            row: 0,
            amount: 0,
            queueId: 0,
          },
          foundInTrino: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Статистика
    const foundCount = results.filter((r) => r.foundInTrino).length;
    const notFoundCount = results.filter((r) => !r.foundInTrino).length;
    const avgReadDelay = results
      .filter((r) => r.readDelay !== undefined)
      .reduce((sum, r) => sum + (r.readDelay || 0), 0) / foundCount || 0;

    const response: ApiResponse<{
      results: typeof results;
      statistics: {
        total: number;
        found: number;
        notFound: number;
        successRate: number; // процент успешных
        avgReadDelay: number; // средняя задержка чтения в мс
      };
    }> = {
      success: true,
      data: {
        results,
        statistics: {
          total: count,
          found: foundCount,
          notFound: notFoundCount,
          successRate: (foundCount / count) * 100,
          avgReadDelay,
        },
      },
    };

    res.json(response);
  } catch (error) {
    console.error("Error in consistency check:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
