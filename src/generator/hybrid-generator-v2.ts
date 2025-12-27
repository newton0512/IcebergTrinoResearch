import { HybridDataGenerator } from "./hybrid-generator.js";
import type { HybridGeneratorConfigV2 } from "./hybrid-types.js";
import type {
  TableConfig,
  GeneratedRow,
  GeneratorConfig,
} from "./types.js";
import { Trino } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "./escape.js";

export class HybridDataGeneratorV2 extends HybridDataGenerator {
  readonly name = "hybrid-postgres-trino-v2";

  private sagaBatchSize: number;

  constructor(config: HybridGeneratorConfigV2) {
    super(config);
    this.sagaBatchSize = config.sagaBatchSize || 100000; // 100K по умолчанию
  }

  protected async generateNative(
    table: TableConfig,
    rowCount: number,
    startSequence: number
  ): Promise<void> {
    const sagaManager = this.getSagaManager();

    // Разбиваем на подбатчи для Saga
    const sagaBatches = Math.ceil(rowCount / this.sagaBatchSize);

    console.log(
      `[${this.name}] Generating ${rowCount.toLocaleString()} rows in ${sagaBatches} saga batches (${this.sagaBatchSize.toLocaleString()} rows each)`
    );

    for (let sagaBatchNum = 0; sagaBatchNum < sagaBatches; sagaBatchNum++) {
      const sagaBatchStart = sagaBatchNum * this.sagaBatchSize;
      const sagaBatchCount = Math.min(
        this.sagaBatchSize,
        rowCount - sagaBatchStart
      );
      const sagaBatchSequence = startSequence + sagaBatchStart;

      // Начинаем сагу для подбатча
      const sagaId = await sagaManager.beginSaga({
        description: `Hybrid sub-batch ${String(sagaBatchNum + 1)}/${String(sagaBatches)}: ${sagaBatchCount.toLocaleString()} rows`,
      });

      // Операция 1: Генерация подбатча в PostgreSQL
      sagaManager.addOperation({
        id: `postgres-batch-${String(sagaBatchNum)}`,
        execute: async () => {
          await this.generatePostgresSubBatch(
            table,
            sagaBatchCount,
            sagaBatchSequence,
            sagaId
          );
          return { batchNum: sagaBatchNum, count: sagaBatchCount, sagaId };
        },
        compensate: async (data) => {
          if (data) {
            const { sagaId: batchSagaId } = data as {
              sagaId: string;
              batchNum: number;
              count: number;
            };
            await this.deletePostgresSubBatch(batchSagaId);
          }
        },
      });

      // Операция 2: Чтение подбатча из PostgreSQL
      let postgresData: GeneratedRow[] = [];
      sagaManager.addOperation({
        id: `read-postgres-batch-${String(sagaBatchNum)}`,
        execute: async () => {
          postgresData = await this.readPostgresSubBatch(
            sagaId,
            sagaBatchCount
          );
          return postgresData;
        },
        compensate: () => {
          // Чтение не требует компенсации
        },
      });

      // Операция 3: Генерация подбатча в Trino
      sagaManager.addOperation({
        id: `trino-batch-${String(sagaBatchNum)}`,
        execute: async () => {
          await this.generateTrinoSubBatch(
            table,
            postgresData,
            sagaBatchSequence
          );
          return { batchNum: sagaBatchNum, count: postgresData.length };
        },
        compensate: async (data) => {
          // Удаляем из PostgreSQL при ошибке в Trino
          await this.deletePostgresSubBatch(sagaId);
        },
      });

      // Выполняем сагу для подбатча
      try {
        const result = await sagaManager.commitSaga();
        console.log(
          `✓ Saga batch ${String(sagaBatchNum + 1)}/${String(sagaBatches)} committed: ${result.sagaId}`
        );
      } catch (error) {
        console.error(
          `✗ Saga batch ${String(sagaBatchNum + 1)}/${String(sagaBatches)} failed: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }
  }

  private async generatePostgresSubBatch(
    table: TableConfig,
    rowCount: number,
    startSequence: number,
    sagaId: string
  ): Promise<void> {
    const config = this.getConfig();
    const postgresGen = this.getPostgresGenerator();
    const postgresTable: TableConfig = {
      ...table,
      name: config.postgresTableName,
      columns: config.postgresColumnMapping.map((mapping) => {
        const sourceCol = table.columns.find(
          (c) => c.name === mapping.sourceColumn
        );
        if (!sourceCol) {
          throw new Error(
            `Column ${mapping.sourceColumn} not found in table config`
          );
        }
        return {
          ...sourceCol,
          name: mapping.targetColumn,
        };
      }),
    };

    // Добавляем sagaId
    const hasSagaId = postgresTable.columns.some((c) => c.name === "sagaId");
    if (!hasSagaId) {
      postgresTable.columns.unshift({
        name: "sagaId",
        type: "string",
        generator: { kind: "constant", value: sagaId },
      });
    }

    await postgresGen.generateNative(
      postgresTable,
      rowCount,
      startSequence
    );
  }

  private async readPostgresSubBatch(
    sagaId: string,
    expectedCount: number
  ): Promise<GeneratedRow[]> {
    const sql = this.getPostgresSql();
    const config = this.getConfig();
    const batchSize = 50000;
    const allRows: GeneratedRow[] = [];

    for (let offset = 0; offset < expectedCount; offset += batchSize) {
      const batch = await sql<GeneratedRow[]>`
        SELECT ${config.postgresColumnMapping
          .map((m) => sql(m.targetColumn))
          .join(", ")}
        FROM ${sql(config.postgresTableName)}
        WHERE "sagaId" = ${sagaId}
        ORDER BY id
        LIMIT ${batchSize} OFFSET ${offset}
      `;
      allRows.push(...batch);
    }

    return allRows;
  }

  private async generateTrinoSubBatch(
    table: TableConfig,
    postgresData: GeneratedRow[],
    startSequence: number
  ): Promise<void> {
    const trino = this.getTrino();
    const config = this.getConfig();
    const trinoTable = `${escapeTrinoIdentifier(config.trinoConfig.catalog)}.${escapeTrinoIdentifier(config.trinoConfig.schema)}.${escapeTrinoIdentifier(config.trinoTableName)}`;

    // Всегда используем VALUES с разбиением на небольшие батчи
    // для избежания превышения лимита Trino на длину запроса (~1MB)
    await this.insertTrinoViaValues(
      trino,
      trinoTable,
      postgresData,
      table,
      startSequence
    );
  }

  private async insertTrinoViaValues(
    trino: Trino,
    trinoTable: string,
    postgresData: GeneratedRow[],
    table: TableConfig,
    startSequence: number
  ): Promise<void> {
    // Формируем VALUES для каждой строки
    const formatValue = (value: unknown): string => {
      if (value === null || value === undefined) return "NULL";
      if (typeof value === "string") return escapeTrinoLiteral(value);
      if (typeof value === "number") return String(value);
      if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
      if (value instanceof Date) {
        const dateStr = value
          .toISOString()
          .replace("T", " ")
          .replace("Z", "")
          .split(".")[0];
        return `TIMESTAMP '${dateStr ?? ""}'`;
      }
      return escapeTrinoLiteral(String(value));
    };

    const formatDate = (date: Date): string => {
      return `DATE '${date.toISOString().split("T")[0] ?? ""}'`;
    };

    // Функция для генерации значений в JavaScript (для VALUES запросов)
    const generateValue = (
      generator: GeneratorConfig,
      rowIndex: number
    ): unknown => {
      switch (generator.kind) {
        case "sequence": {
          const start = generator.start ?? 1;
          const step = generator.step ?? 1;
          return start + (startSequence - 1 + rowIndex) * step;
        }
        case "randomInt": {
          return (
            Math.floor(Math.random() * (generator.max - generator.min + 1)) +
            generator.min
          );
        }
        case "randomFloat": {
          const precision = generator.precision ?? 2;
          const value =
            Math.random() * (generator.max - generator.min) + generator.min;
          return Number(value.toFixed(precision));
        }
        case "randomString": {
          const len = generator.length;
          return Math.random().toString(36).substring(2, 2 + len).padEnd(len, "0");
        }
        case "choice": {
          const values = generator.values;
          return values[Math.floor(Math.random() * values.length)];
        }
        case "choiceByLookup": {
          // Генерируем значение из массива в JavaScript
          const values = generator.values;
          return values[Math.floor(Math.random() * values.length)];
        }
        case "constant": {
          return generator.value;
        }
        case "datetime": {
          const from = generator.from ?? new Date("2020-01-01");
          const to = generator.to ?? new Date();
          const fromTs = from.getTime();
          const toTs = to.getTime();
          const randomTs = fromTs + Math.floor(Math.random() * (toTs - fromTs));
          return new Date(randomTs);
        }
        case "uuid": {
          // Генерируем UUID в JavaScript
          return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
            /[xy]/g,
            (c) => {
              const r = (Math.random() * 16) | 0;
              const v = c === "x" ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            }
          );
        }
        default: {
          // Для неизвестных типов возвращаем null
          return null;
        }
      }
    };

    const config = this.getConfig();
    const trinoColumns = config.trinoColumnMapping.map((m) =>
      escapeTrinoIdentifier(m.targetColumn)
    );
    const valuesClauses: string[] = [];

    for (let i = 0; i < postgresData.length; i++) {
      const pgRow = postgresData[i];
      if (!pgRow) continue;

      const values: string[] = [];

      for (const mapping of config.trinoColumnMapping) {
        // Если колонка есть в PostgreSQL - берем оттуда
        const postgresMapping = config.postgresColumnMapping.find(
          (pm) => pm.sourceColumn === mapping.sourceColumn
        );
        if (
          postgresMapping &&
          pgRow[postgresMapping.targetColumn] !== undefined
        ) {
          values.push(formatValue(pgRow[postgresMapping.targetColumn]));
        } else {
          // Генерируем значение в JavaScript (не через SQL)
          const sourceCol = table.columns.find(
            (c) => c.name === mapping.sourceColumn
          );
          if (sourceCol) {
            const generator = mapping.generator || sourceCol.generator;
            const generatedValue = generateValue(generator, i);
            // Для дат используем formatDate, для остальных formatValue
            if (generatedValue instanceof Date && sourceCol.type === "date") {
              values.push(formatDate(generatedValue));
            } else {
              values.push(formatValue(generatedValue));
            }
          } else {
            values.push("NULL");
          }
        }
      }

      valuesClauses.push(`(${values.join(", ")})`);
    }

    // Вставляем батчами (Trino имеет ограничение на длину запроса ~1MB)
    // С ~50 колонками используем очень маленький размер батча для избежания превышения лимита
    // Примерно 250 строк * ~200 байт = ~50KB, что безопасно ниже лимита 1MB
    const trinoBatchSize = 250;
    let batchNum = 0;
    const totalBatches = Math.ceil(valuesClauses.length / trinoBatchSize);

    for (let i = 0; i < valuesClauses.length; i += trinoBatchSize) {
      batchNum++;
      const batch = valuesClauses.slice(i, i + trinoBatchSize);

      // Retry логика для обработки временных сбоев соединения
      const maxRetries = 3;
      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          const insertSql = `
            INSERT INTO ${trinoTable} (${trinoColumns.join(", ")})
            VALUES ${batch.join(", ")}
          `;

          // Проверка размера запроса перед отправкой (для отладки)
          const querySize = insertSql.length;
          if (querySize > 900000) {
            // Если запрос близок к лимиту, уменьшаем размер батча
            console.log(
              `  Warning: Query size ${querySize} bytes is close to limit, using smaller batch`
            );
          }

          const query = await trino.query(insertSql);
          for await (const result of query) {
            const trinoResult = result as { error?: { message: string } };
            if (trinoResult.error) {
              throw new Error(
                `Trino insert failed: ${trinoResult.error.message}`
              );
            }
          }
          success = true;

          // Небольшая задержка между батчами для снижения нагрузки
          if (i + trinoBatchSize < valuesClauses.length) {
            await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms задержка
          }
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw error;
          }
          // Экспоненциальная задержка перед retry
          const delay = Math.min(
            1000 * Math.pow(2, retryCount - 1),
            10000
          );
          console.log(
            `  Retrying batch ${batchNum}/${totalBatches} (attempt ${retryCount + 1}/${maxRetries}) after ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Прогресс для больших батчей
      if (totalBatches > 10 && batchNum % 10 === 0) {
        const progress = Math.round((i / valuesClauses.length) * 100);
        console.log(
          `  Inserted ${batchNum}/${totalBatches} batches (${progress}%)`
        );
      }
    }
  }


  private async deletePostgresSubBatch(sagaId: string): Promise<void> {
    const sql = this.getPostgresSql();
    const config = this.getConfig();
    await sql`
      DELETE FROM ${sql(config.postgresTableName)}
      WHERE "sagaId" = ${sagaId}
    `;
  }
}

