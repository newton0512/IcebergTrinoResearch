/**
 * Скрипт для создания таблицы Saga в PostgreSQL
 * Запуск: npx tsx scripts/setup-saga-table.ts
 */

import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = postgres({
  host: "localhost",
  port: 5432,
  database: "appdb",
  username: "postgres",
  password: "postgres",
});

async function setupSagaTable(): Promise<void> {
  try {
    console.log("Creating Saga table...");

    // Читаем SQL из файла миграции
    const migrationPath = join(
      process.cwd(),
      "prisma",
      "migrations",
      "001_create_saga_table.sql"
    );
    const migrationSQL = readFileSync(migrationPath, "utf-8");

    // Выполняем SQL
    await sql.unsafe(migrationSQL);

    console.log("✓ Saga table created successfully");

    // Проверяем, что таблица создана
    const result = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'Saga'
    `;

    if (result.length > 0) {
      console.log("✓ Table 'Saga' exists in database");
    } else {
      console.error("✗ Table 'Saga' was not created");
    }
  } catch (error) {
    console.error("Error creating Saga table:", error);
    throw error;
  } finally {
    await sql.end();
  }
}

setupSagaTable().catch(console.error);

