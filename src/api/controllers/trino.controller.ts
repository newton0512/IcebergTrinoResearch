/**
 * Контроллер для прямых запросов к Trino
 */

import type { Request, Response } from "express";
import { Trino } from "trino-client";
import { BasicAuth } from "trino-client";
import { getTrinoConfig } from "../../hybrid-writer/utils.js";
import type { ApiResponse, TrinoQueryRequest } from "../types.js";

const trinoConfig = getTrinoConfig();

// Переиспользуем одно соединение Trino для всех запросов (connection pooling)
// Это уменьшает нагрузку на Trino и улучшает производительность
let trinoClient: Trino | null = null;

function getTrinoClient(): Trino {
  if (!trinoClient) {
    trinoClient = Trino.create({
      server: `http://${trinoConfig.host}:${trinoConfig.port}`,
      catalog: trinoConfig.catalog,
      schema: trinoConfig.schema,
      auth: new BasicAuth(trinoConfig.user),
    });
  }
  return trinoClient;
}

/**
 * Выполнение произвольного SQL запроса к Trino
 * POST /api/trino/query
 */
export async function trinoQuery(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as TrinoQueryRequest;

    if (!body.query) {
      res.status(400).json({
        success: false,
        error: "Query is required",
      });
      return;
    }

    // Ограничиваем только SELECT, INSERT, UPDATE, DELETE запросы для безопасности
    const query = body.query.trim().toUpperCase();
    const allowedCommands = ["SELECT", "INSERT", "UPDATE", "DELETE", "SHOW", "DESCRIBE", "EXPLAIN"];
    const firstWord = query.split(/\s+/)[0];

    if (!allowedCommands.includes(firstWord)) {
      res.status(400).json({
        success: false,
        error: `Only ${allowedCommands.join(", ")} queries are allowed`,
      });
      return;
    }

    const trino = getTrinoClient();
    const result = await trino.query(body.query);
    
    const data: unknown[] = [];
    
    for await (const row of result) {
      // Проверяем на ошибки
      if (row && typeof row === "object" && "error" in row) {
        const error = (row as { error: { message?: string } }).error;
        throw new Error(error?.message || "Query failed");
      }
      
      if (row && typeof row === "object" && "data" in row) {
        if (Array.isArray((row as { data: unknown }).data)) {
          data.push(...(row as { data: unknown[] }).data);
        }
      } else if (row && typeof row === "string") {
        // Если это строка с ошибкой
        throw new Error(row);
      }
    }

    const response: ApiResponse<unknown> = {
      success: true,
      data,
    };

    res.json(response);
  } catch (error) {
    console.error("Error executing Trino query:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
