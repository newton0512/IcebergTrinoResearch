import postgres, { type Sql } from "postgres";
import { BasicAuth, Trino } from "trino-client";
import { BaseDataGenerator } from "./base-generator.js";
import { PostgresDataGenerator, generatorToPostgresExpr } from "./postgres-generator.js";
import { TrinoDataGenerator, generatorToTrinoExpr } from "./trino-generator.js";
import { SagaManager } from "../saga/index.js";
import type {
  TableConfig,
  GeneratedRow,
  Transformation,
  TransformationBatch,
  ColumnConfig,
  GeneratorConfig,
} from "./types.js";
import type { HybridGeneratorConfig } from "./hybrid-types.js";
import {
  escapePostgresIdentifier,
  escapePostgresLiteral,
  escapeTrinoIdentifier,
  escapeTrinoLiteral,
} from "./escape.js";
import { getLookupTableName } from "./utils.js";
import type { ChoiceByLookupGenerator } from "./types.js";

export class HybridDataGenerator extends BaseDataGenerator {
  readonly name = "hybrid-postgres-trino";

  private postgresSql: Sql | null = null;
  private trino: Trino | null = null;
  private sagaManager: SagaManager | null = null;
  private postgresGenerator: PostgresDataGenerator;
  private trinoGenerator: TrinoDataGenerator;

  constructor(private config: HybridGeneratorConfig) {
    super();
    this.postgresGenerator = new PostgresDataGenerator(
      config.postgresConfig
    );
    this.trinoGenerator = new TrinoDataGenerator(config.trinoConfig);
  }

  async connect(): Promise<void> {
    // Подключаемся к PostgreSQL
    this.postgresSql = postgres({
      host: this.config.postgresConfig.host,
      port: this.config.postgresConfig.port,
      database: this.config.postgresConfig.database,
      username: this.config.postgresConfig.username,
      password: this.config.postgresConfig.password,
    });

    // Подключаемся к Trino
    this.trino = Trino.create({
      server: `http://${this.config.trinoConfig.host}:${String(this.config.trinoConfig.port)}`,
      catalog: this.config.trinoConfig.catalog,
      schema: this.config.trinoConfig.schema,
      auth: new BasicAuth(this.config.trinoConfig.user),
    });

    // Создаем менеджер саг
    this.sagaManager = new SagaManager(this.postgresSql);

    // Подключаем генераторы
    await this.postgresGenerator.connect();
    await this.trinoGenerator.connect();

    // Настраиваем схему в Trino
    await this.setupTrinoSchema();
  }

  async disconnect(): Promise<void> {
    if (this.postgresSql) {
      await this.postgresSql.end();
      this.postgresSql = null;
    }
    this.trino = null;
    this.sagaManager = null;
    await this.postgresGenerator.disconnect();
    await this.trinoGenerator.disconnect();
  }

  private async setupTrinoSchema(): Promise<void> {
    const trino = this.getTrino();
    const createSchema = await trino.query(
      `CREATE SCHEMA IF NOT EXISTS ${escapeTrinoIdentifier(this.config.trinoConfig.catalog)}.${escapeTrinoIdentifier(this.config.trinoConfig.schema)}`
    );
    for await (const _ of createSchema) {
      // Consume
    }
  }

  protected getPostgresSql(): Sql {
    if (!this.postgresSql) {
      throw new Error("Not connected to PostgreSQL");
    }
    return this.postgresSql;
  }

  protected getTrino(): Trino {
    if (!this.trino) {
      throw new Error("Not connected to Trino");
    }
    return this.trino;
  }

  protected getSagaManager(): SagaManager {
    if (!this.sagaManager) {
      throw new Error("Saga manager not initialized");
    }
    return this.sagaManager;
  }

  // Доступ к config для дочерних классов
  protected getConfig(): HybridGeneratorConfig {
    return this.config;
  }

  // Доступ к генераторам для дочерних классов
  protected getPostgresGenerator(): PostgresDataGenerator {
    return this.postgresGenerator;
  }

  async createTable(table: TableConfig): Promise<void> {
    // Создаем таблицу в PostgreSQL
    const postgresTable: TableConfig = {
      ...table,
      name: this.config.postgresTableName,
      columns: this.config.postgresColumnMapping.map((mapping) => {
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

    // Добавляем колонку sagaId если её нет
    const hasSagaId = postgresTable.columns.some((c) => c.name === "sagaId");
    if (!hasSagaId) {
      postgresTable.columns.unshift({
        name: "sagaId",
        type: "string",
        generator: { kind: "constant", value: "" },
      });
    }

    await this.postgresGenerator.createTable(postgresTable);

    // Создаем таблицу в Trino
    const trinoTable: TableConfig = {
      ...table,
      name: this.config.trinoTableName,
      columns: this.config.trinoColumnMapping.map((mapping) => {
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
          generator: mapping.generator || sourceCol.generator,
        };
      }),
    };

    await this.trinoGenerator.createTable(trinoTable);
  }

  async truncateTable(tableName: string): Promise<void> {
    if (tableName === this.config.postgresTableName) {
      await this.postgresGenerator.truncateTable(
        this.config.postgresTableName
      );
    }
    if (tableName === this.config.trinoTableName) {
      await this.trinoGenerator.truncateTable(this.config.trinoTableName);
    }
  }

  async dropTable(tableName: string): Promise<void> {
    if (tableName === this.config.postgresTableName) {
      await this.postgresGenerator.dropTable(this.config.postgresTableName);
    }
    if (tableName === this.config.trinoTableName) {
      await this.trinoGenerator.dropTable(this.config.trinoTableName);
    }
  }

  async queryRows(
    tableName: string,
    limit = 100
  ): Promise<GeneratedRow[]> {
    if (tableName === this.config.postgresTableName) {
      return this.postgresGenerator.queryRows(
        this.config.postgresTableName,
        limit
      );
    }
    if (tableName === this.config.trinoTableName) {
      return this.trinoGenerator.queryRows(this.config.trinoTableName, limit);
    }
    return [];
  }

  async countRows(tableName: string): Promise<number> {
    if (tableName === this.config.postgresTableName) {
      return this.postgresGenerator.countRows(this.config.postgresTableName);
    }
    if (tableName === this.config.trinoTableName) {
      return this.trinoGenerator.countRows(this.config.trinoTableName);
    }
    return 0;
  }

  async getMaxValue(
    tableName: string,
    columnName: string
  ): Promise<number | null> {
    if (tableName === this.config.postgresTableName) {
      return this.postgresGenerator.getMaxValue(
        this.config.postgresTableName,
        columnName
      );
    }
    if (tableName === this.config.trinoTableName) {
      return this.trinoGenerator.getMaxValue(
        this.config.trinoTableName,
        columnName
      );
    }
    return null;
  }

  async getTableSize(tableName: string): Promise<number | null> {
    if (tableName === this.config.postgresTableName) {
      return this.postgresGenerator.getTableSize(this.config.postgresTableName);
    }
    if (tableName === this.config.trinoTableName) {
      return this.trinoGenerator.getTableSize(this.config.trinoTableName);
    }
    return null;
  }

  async optimize(tableName: string): Promise<void> {
    if (tableName === this.config.postgresTableName) {
      await this.postgresGenerator.optimize(this.config.postgresTableName);
    }
    if (tableName === this.config.trinoTableName) {
      await this.trinoGenerator.optimize(this.config.trinoTableName);
    }
  }

  protected async applyTransformations(
    tableName: string,
    transformations: Transformation[]
  ): Promise<void> {
    // Применяем трансформации к обеим таблицам или только к нужной
    if (tableName === this.config.postgresTableName) {
      await this.postgresGenerator.transform(this.config.postgresTableName, [
        { transformations },
      ]);
    }
    if (tableName === this.config.trinoTableName) {
      await this.trinoGenerator.transform(this.config.trinoTableName, [
        { transformations },
      ]);
    }
  }

  protected async generateNative(
    table: TableConfig,
    rowCount: number,
    startSequence: number
  ): Promise<void> {
    const sagaManager = this.getSagaManager();
    const sql = this.getPostgresSql();
    const trino = this.getTrino();

    // Начинаем сагу для батча
    const sagaId = await sagaManager.beginSaga({
      description: `Hybrid batch: ${rowCount.toLocaleString()} rows for ${table.name}`,
    });

    // Операция 1: Генерация в PostgreSQL (нативная SQL генерация)
    sagaManager.addOperation({
      id: "generate-postgres-batch",
      execute: async () => {
        // Создаем конфигурацию таблицы для PostgreSQL
        const postgresTable: TableConfig = {
          ...table,
          name: this.config.postgresTableName,
          columns: this.config.postgresColumnMapping.map((mapping) => {
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

        // Добавляем колонку sagaId
        const hasSagaId = postgresTable.columns.some(
          (c) => c.name === "sagaId"
        );
        if (!hasSagaId) {
          postgresTable.columns.unshift({
            name: "sagaId",
            type: "string",
            generator: { kind: "constant", value: sagaId },
          });
        }

        // Используем нативную генерацию PostgreSQL
        await this.postgresGenerator.generateNative(
          postgresTable,
          rowCount,
          startSequence
        );

        console.log(
          `✓ Generated ${rowCount.toLocaleString()} rows in PostgreSQL`
        );
        return { rowCount, sagaId };
      },
      compensate: async (data) => {
        if (data) {
          const { sagaId: batchSagaId } = data as {
            sagaId: string;
            rowCount: number;
          };
          await sql`
            DELETE FROM ${sql(this.config.postgresTableName)}
            WHERE "sagaId" = ${batchSagaId}
          `;
          console.log(`✓ Deleted PostgreSQL batch (compensation)`);
        }
      },
    });

    // Операция 2: Чтение данных из PostgreSQL
    let postgresData: GeneratedRow[] = [];
    sagaManager.addOperation({
      id: "read-postgres-batch",
      execute: async () => {
        // Читаем данные батчами для экономии памяти
        const batchSize = 50000;
        const allRows: GeneratedRow[] = [];

        for (let offset = 0; offset < rowCount; offset += batchSize) {
          const batch = await sql<GeneratedRow[]>`
            SELECT ${this.config.postgresColumnMapping
              .map((m) => sql(m.targetColumn))
              .join(", ")}
            FROM ${sql(this.config.postgresTableName)}
            WHERE "sagaId" = ${sagaId}
            ORDER BY id
            LIMIT ${batchSize} OFFSET ${offset}
          `;
          allRows.push(...batch);
        }

        postgresData = allRows;
        console.log(
          `✓ Read ${postgresData.length.toLocaleString()} rows from PostgreSQL`
        );
        return postgresData;
      },
      compensate: () => {
        // Чтение не требует компенсации
        console.log("✓ Read operation compensation skipped");
      },
    });

    // Операция 3: Генерация в Trino через VALUES (чтение данных из PostgreSQL)
    sagaManager.addOperation({
      id: "generate-trino-batch",
      execute: async () => {
        if (postgresData.length === 0) {
          throw new Error("No PostgreSQL data to write to Trino");
        }

        const trino = this.getTrino();
        const trinoTable = `${escapeTrinoIdentifier(this.config.trinoConfig.catalog)}.${escapeTrinoIdentifier(this.config.trinoConfig.schema)}.${escapeTrinoIdentifier(this.config.trinoTableName)}`;

        // Используем VALUES для массовой вставки
        await this.insertTrinoViaValues(
          trino,
          trinoTable,
          postgresData,
          table,
          startSequence
        );

        console.log(
          `✓ Generated ${postgresData.length.toLocaleString()} rows in Trino`
        );
        return { rowCount: postgresData.length };
      },
      compensate: async (data) => {
        // При ошибке в Trino - удаляем из PostgreSQL
        await sql`
          DELETE FROM ${sql(this.config.postgresTableName)}
          WHERE "sagaId" = ${sagaId}
        `;
        console.log(
          `✓ Deleted PostgreSQL batch after Trino failure (compensation)`
        );
      },
    });

    // Выполняем сагу
    try {
      const result = await sagaManager.commitSaga();
      console.log(
        `✓ Saga committed: ${result.sagaId} (${String(result.operationsCount)} operations)`
      );
    } catch (error) {
      console.error(
        `✗ Saga failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
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

    const trinoColumns = this.config.trinoColumnMapping.map((m) =>
      escapeTrinoIdentifier(m.targetColumn)
    );
    const valuesClauses: string[] = [];

    for (let i = 0; i < postgresData.length; i++) {
      const pgRow = postgresData[i];
      if (!pgRow) continue;

      const values: string[] = [];

      for (const mapping of this.config.trinoColumnMapping) {
        // Если колонка есть в PostgreSQL - берем оттуда
        const postgresMapping = this.config.postgresColumnMapping.find(
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
}

