/**
 * Контроллер для прямых запросов к PostgreSQL
 */

import type { Request, Response } from "express";
import { connectPostgres, getPostgresConfig } from "../../hybrid-writer/utils.js";
import type { ApiResponse, PostgresQueryRequest } from "../types.js";

/**
 * Выполнение произвольного SQL запроса к PostgreSQL
 * POST /api/postgres/query
 */
export async function postgresQuery(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as PostgresQueryRequest;

    if (!body.query) {
      res.status(400).json({
        success: false,
        error: "Query is required",
      });
      return;
    }

    // Ограничиваем только SELECT, INSERT, UPDATE, DELETE запросы для безопасности
    const query = body.query.trim().toUpperCase();
    const allowedCommands = ["SELECT", "INSERT", "UPDATE", "DELETE"];
    const firstWord = query.split(/\s+/)[0];

    if (!allowedCommands.includes(firstWord)) {
      res.status(400).json({
        success: false,
        error: `Only ${allowedCommands.join(", ")} queries are allowed`,
      });
      return;
    }

    const postgresConfig = getPostgresConfig();
    const sql = await connectPostgres(postgresConfig);

    try {
      const result = await sql.unsafe(body.query);

      const response: ApiResponse<unknown> = {
        success: true,
        data: result,
      };

      res.json(response);
    } finally {
      await sql.end();
    }
  } catch (error) {
    console.error("Error executing PostgreSQL query:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
