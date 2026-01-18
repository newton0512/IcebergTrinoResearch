/**
 * Контроллер для аналитических запросов к bonus_registry
 */

import type { Request, Response } from "express";
import { Trino } from "trino-client";
import { BasicAuth } from "trino-client";
import { escapeTrinoIdentifier } from "../../generator/escape.js";
import { getTrinoConfig } from "../../hybrid-writer/utils.js";
import type { ApiResponse, AnalyticsRequest } from "../types.js";

const trinoConfig = getTrinoConfig();

function getTrinoClient(): Trino {
  return Trino.create({
    server: `http://${trinoConfig.host}:${String(trinoConfig.port)}`,
    catalog: trinoConfig.catalog,
    schema: trinoConfig.schema,
    auth: new BasicAuth(trinoConfig.user),
  });
}

/**
 * Выполнение аналитических запросов
 * GET /api/analytics/:type?limit=10&dateFrom=2024-01-01&dateTo=2024-12-31
 */
export async function analytics(req: Request, res: Response): Promise<void> {
  try {
    const params = (req.params || {}) as { type?: string };
    const query = (req.query || {}) as unknown as Omit<AnalyticsRequest, "type">;
    
    const analyticsType = (params.type ?? "count") as AnalyticsRequest["type"];
    const limitNum = typeof query.limit === "number" ? query.limit : Number.parseInt(String(query.limit ?? 100), 10);
    const limit = Number.isNaN(limitNum) ? 100 : limitNum;
    const dateFrom: string | undefined = typeof query.dateFrom === "string" ? query.dateFrom : undefined;
    const dateTo: string | undefined = typeof query.dateTo === "string" ? query.dateTo : undefined;

    const trino = getTrinoClient();
    const escapedCatalog = escapeTrinoIdentifier(trinoConfig.catalog);
    const escapedSchema = escapeTrinoIdentifier(trinoConfig.schema);
    const escapedTable = escapeTrinoIdentifier("bonus_registry");
    const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

    let sql = "";

    switch (analyticsType) {
      case "count": {
        sql = `SELECT COUNT(*) as count FROM ${fullTableName}`;
        if (dateFrom || dateTo) {
          const conditions: string[] = [];
          if (dateFrom) {
            conditions.push(`"date" >= DATE '${dateFrom}'`);
          }
          if (dateTo) {
            conditions.push(`"date" <= DATE '${dateTo}'`);
          }
          if (conditions.length > 0) {
            sql += ` WHERE ${conditions.join(" AND ")}`;
          }
        }
        break;
      }

      case "sum-amount": {
        sql = `SELECT SUM(amount) as sum_amount FROM ${fullTableName}`;
        if (dateFrom || dateTo) {
          const conditions: string[] = [];
          if (dateFrom) {
            conditions.push(`"date" >= DATE '${String(dateFrom)}'`);
          }
          if (dateTo) {
            conditions.push(`"date" <= DATE '${String(dateTo)}'`);
          }
          sql += ` WHERE ${conditions.join(" AND ")}`;
        }
        break;
      }

      case "avg-amount": {
        sql = `SELECT AVG(CAST(amount AS DOUBLE)) as avg_amount FROM ${fullTableName}`;
        if (dateFrom || dateTo) {
          const conditions: string[] = [];
          if (dateFrom) {
            conditions.push(`"date" >= DATE '${String(dateFrom)}'`);
          }
          if (dateTo) {
            conditions.push(`"date" <= DATE '${String(dateTo)}'`);
          }
          sql += ` WHERE ${conditions.join(" AND ")}`;
        }
        break;
      }

      case "min-amount": {
        sql = `SELECT MIN(amount) as min_amount FROM ${fullTableName}`;
        if (dateFrom || dateTo) {
          const conditions: string[] = [];
          if (dateFrom) {
            conditions.push(`"date" >= DATE '${String(dateFrom)}'`);
          }
          if (dateTo) {
            conditions.push(`"date" <= DATE '${String(dateTo)}'`);
          }
          sql += ` WHERE ${conditions.join(" AND ")}`;
        }
        break;
      }

      case "max-amount": {
        sql = `SELECT MAX(amount) as max_amount FROM ${fullTableName}`;
        if (dateFrom || dateTo) {
          const conditions: string[] = [];
          if (dateFrom) {
            conditions.push(`"date" >= DATE '${String(dateFrom)}'`);
          }
          if (dateTo) {
            conditions.push(`"date" <= DATE '${String(dateTo)}'`);
          }
          sql += ` WHERE ${conditions.join(" AND ")}`;
        }
        break;
      }

      case "group-by-registrar-type": {
        sql = `
          SELECT registrar_type_id, COUNT(*) as count, SUM(amount) as total_amount
          FROM ${fullTableName}
          WHERE registrar_type_id IS NOT NULL
        `;
        if (dateFrom || dateTo) {
          const conditions: string[] = [];
          if (dateFrom) {
            conditions.push(`"date" >= DATE '${dateFrom}'`);
          }
          if (dateTo) {
            conditions.push(`"date" <= DATE '${dateTo}'`);
          }
          sql += ` AND ${conditions.join(" AND ")}`;
        }
        sql += ` GROUP BY registrar_type_id ORDER BY count DESC LIMIT ${String(limit)}`;
        break;
      }

      case "group-by-date": {
        sql = `
          SELECT DATE("date") as date, COUNT(*) as count, SUM(amount) as total_amount
          FROM ${fullTableName}
          WHERE "date" IS NOT NULL
        `;
        if (dateFrom || dateTo) {
          const conditions: string[] = [];
          if (dateFrom) {
            conditions.push(`"date" >= DATE '${String(dateFrom)}'`);
          }
          if (dateTo) {
            conditions.push(`"date" <= DATE '${String(dateTo)}'`);
          }
          sql += ` AND ${conditions.join(" AND ")}`;
        }
        sql += ` GROUP BY DATE("date") ORDER BY date DESC LIMIT ${String(limit)}`;
        break;
      }

      case "top-balances": {
        sql = `
          SELECT id, amount, registrar_type_id, registrar_id, "date"
          FROM ${fullTableName}
          WHERE amount IS NOT NULL
        `;
        if (dateFrom || dateTo) {
          const conditions: string[] = [];
          if (dateFrom) {
            conditions.push(`"date" >= DATE '${String(dateFrom)}'`);
          }
          if (dateTo) {
            conditions.push(`"date" <= DATE '${String(dateTo)}'`);
          }
          sql += ` AND ${conditions.join(" AND ")}`;
        }
        sql += ` ORDER BY amount DESC LIMIT ${String(limit)}`;
        break;
      }

      default: {
        const errorResponse: ApiResponse = {
          success: false,
          error: `Unknown analytics type: ${analyticsType}. Available types: count, sum-amount, avg-amount, min-amount, max-amount, group-by-registrar-type, group-by-date, top-balances`,
        };
        res.status(400).json(errorResponse);
        return;
      }
    }

    const result = await trino.query(sql);
    const data: unknown[] = [];

    for await (const row of result) {
      if (row && typeof row === "object" && "error" in row) {
        const trinoResult = row as { error: { message?: string } };
        const error = trinoResult.error;
        throw new Error(error.message ?? "Query failed");
      }
      
      if (row && typeof row === "object" && "data" in row) {
        const trinoResult = row as { data: unknown };
        if (Array.isArray(trinoResult.data)) {
          data.push(...(trinoResult.data as unknown[]));
        }
      }
    }

    const response: ApiResponse<unknown[]> = {
      success: true,
      data,
    };

    res.json(response);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Error executing analytics query:", error);
    const errorResponse: ApiResponse = {
      success: false,
      error: error.message,
    };
    res.status(500).json(errorResponse);
  }
}
