/**
 * Контроллер для операций удаления из bonus_registry
 */

import type { Request, Response } from "express";
import { Trino } from "trino-client";
import { BasicAuth } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../../generator/escape.js";
import { getTrinoConfig } from "../../hybrid-writer/utils.js";
import type { ApiResponse } from "../types.js";

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
 * Удаление записи по ID
 * DELETE /api/delete/:id
 */
export async function deleteById(req: Request, res: Response): Promise<void> {
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

    // Для Iceberg таблиц используется DELETE FROM ... WHERE
    const deleteQuery = `DELETE FROM ${fullTableName} WHERE id = ${escapeTrinoLiteral(id)}`;

    const result = await trino.query(deleteQuery);
    
    // Потребляем результаты
    let deleted = false;
    for await (const row of result) {
      if (row.data && row.data.length > 0) {
        deleted = true;
      }
      // Проверяем на ошибки
      if (row && typeof row === "object" && "error" in row) {
        const error = (row as { error: { message?: string } }).error;
        throw new Error(error?.message || "Delete failed");
      }
    }

    const response: ApiResponse<{ deleted: boolean; id: string }> = {
      success: true,
      data: {
        deleted,
        id,
      },
    };

    res.json(response);
  } catch (error) {
    console.error("Error deleting record:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
