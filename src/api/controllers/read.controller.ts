/**
 * Контроллер для операций чтения из bonus_registry
 */

import type { Request, Response } from "express";
import { Trino } from "trino-client";
import { BasicAuth } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../../generator/escape.js";
import { getTrinoConfig } from "../../hybrid-writer/utils.js";
import type { ApiResponse, ReadListRequest } from "../types.js";

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
 * Чтение записи по ID
 * GET /api/read/:id
 */
export async function readById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        error: "ID is required",
      });
      return;
    }

    const trino = getTrinoClient();
    const escapedCatalog = escapeTrinoIdentifier(trinoConfig.catalog);
    const escapedSchema = escapeTrinoIdentifier(trinoConfig.schema);
    const escapedTable = escapeTrinoIdentifier("bonus_registry");
    const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

    const query = `SELECT * FROM ${fullTableName} WHERE id = ${escapeTrinoLiteral(id)} LIMIT 1`;

    const result = await trino.query(query);
    let record = null;

    for await (const row of result) {
      if (row.data) {
        record = row.data[0];
        break;
      }
    }

    if (!record) {
      res.status(404).json({
        success: false,
        error: "Record not found",
      });
      return;
    }

    const response: ApiResponse<typeof record> = {
      success: true,
      data: record,
    };

    res.json(response);
  } catch (error) {
    console.error("Error reading record:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Получение списка записей (первые или последние N записей)
 * GET /api/list?limit=100&order=desc&orderBy=date
 */
export async function readList(req: Request, res: Response): Promise<void> {
  try {
    const query = req.query as unknown as ReadListRequest;
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const order = query.order ?? "desc";
    const orderBy = query.orderBy ?? "date";

    if (limit > 10000) {
      res.status(400).json({
        success: false,
        error: "Limit cannot exceed 10000",
      });
      return;
    }

    const trino = getTrinoClient();
    const escapedCatalog = escapeTrinoIdentifier(trinoConfig.catalog);
    const escapedSchema = escapeTrinoIdentifier(trinoConfig.schema);
    const escapedTable = escapeTrinoIdentifier("bonus_registry");
    const escapedOrderBy = escapeTrinoIdentifier(orderBy);
    const fullTableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

    const querySql = `
      SELECT * FROM ${fullTableName}
      ORDER BY ${escapedOrderBy} ${order.toUpperCase()}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const result = await trino.query(querySql);
    const records: unknown[] = [];

    for await (const row of result) {
      if (row.data) {
        records.push(...row.data);
      }
    }

    const response: ApiResponse<{ records: unknown[]; count: number }> = {
      success: true,
      data: {
        records,
        count: records.length,
      },
    };

    res.json(response);
  } catch (error) {
    console.error("Error reading list:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
