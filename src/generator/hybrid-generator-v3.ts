import postgres, { type Sql } from "postgres";
import { BasicAuth, Trino } from "trino-client";
import { BaseDataGenerator } from "./base-generator.js";
import { PostgresDataGenerator } from "./postgres-generator.js";
import {
  TrinoDataGenerator,
  generatorToTrinoExpr,
  columnTypeToTrino,
} from "./trino-generator.js";
import { SagaManager } from "../saga/index.js";
import type {
  TableConfig,
  GeneratedRow,
  ColumnConfig,
  GeneratorConfig,
  GenerateOptions,
  GenerateResult,
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

export interface HybridGeneratorConfigV3 extends HybridGeneratorConfig {
  // Колонки, которые будут браться из внешней таблицы PostgreSQL
  postgresLookupColumns: string[]; // имена колонок из TableConfig
  // Имя PostgreSQL каталога в Trino (по умолчанию "postgres")
  postgresCatalogName?: string;
  // Размер батча для Saga (по умолчанию 100K)
  sagaBatchSize?: number;
}

export class HybridDataGeneratorV3 extends BaseDataGenerator {
  readonly name = "hybrid-postgres-trino-v3";

  private postgresGenerator: PostgresDataGenerator;
  private trinoGenerator: TrinoDataGenerator;
  private sagaManager: SagaManager | null = null;
  private sql: Sql | null = null;
  private trino: Trino | null = null;
  private config: HybridGeneratorConfigV3;
  private postgresCatalogName: string;

  constructor(config: HybridGeneratorConfigV3) {
    super();
    this.config = config;
    this.postgresGenerator = new PostgresDataGenerator(config.postgresConfig);
    this.trinoGenerator = new TrinoDataGenerator(config.trinoConfig);
    this.postgresCatalogName = config.postgresCatalogName || "postgres";
  }

  async connect(): Promise<void> {
    // Подключаемся к PostgreSQL
    await this.postgresGenerator.connect();
    this.sql = postgres({
      host: this.config.postgresConfig.host,
      port: this.config.postgresConfig.port,
      database: this.config.postgresConfig.database,
      username: this.config.postgresConfig.username,
      password: this.config.postgresConfig.password,
    });

    // Подключаемся к Trino
    await this.trinoGenerator.connect();
    this.trino = Trino.create({
      server: `http://${this.config.trinoConfig.host}:${String(this.config.trinoConfig.port)}`,
      catalog: this.config.trinoConfig.catalog,
      schema: this.config.trinoConfig.schema,
      auth: new BasicAuth(this.config.trinoConfig.user),
    });

    // Создаем SagaManager
    this.sagaManager = new SagaManager(this.sql);
  }

  async disconnect(): Promise<void> {
    if (this.postgresGenerator) {
      await this.postgresGenerator.disconnect();
    }
    if (this.trinoGenerator) {
      await this.trinoGenerator.disconnect();
    }
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
    }
    this.trino = null;
    this.sagaManager = null;
  }

  async createTable(table: TableConfig): Promise<void> {
    // Создаем таблицу в Trino (Iceberg)
    await this.trinoGenerator.createTable(table);
  }

  async truncateTable(tableName: string): Promise<void> {
    await this.trinoGenerator.truncateTable(tableName);
  }

  async dropTable(tableName: string): Promise<void> {
    // Удаляем таблицу в Trino
    await this.trinoGenerator.dropTable(tableName);
    // Удаляем lookup таблицу в PostgreSQL
    if (this.sql) {
      await this.sql`DROP TABLE IF EXISTS ${this.sql(this.config.postgresTableName)}`;
    }
  }

  async queryRows(
    tableName: string,
    limit = 100
  ): Promise<GeneratedRow[]> {
    return this.trinoGenerator.queryRows(tableName, limit);
  }

  async countRows(tableName: string): Promise<number> {
    return this.trinoGenerator.countRows(tableName);
  }

  async getMaxValue(
    tableName: string,
    columnName: string
  ): Promise<number | null> {
    return this.trinoGenerator.getMaxValue(tableName, columnName);
  }

  async getTableSize(tableName: string): Promise<number | null> {
    return this.trinoGenerator.getTableSize(tableName);
  }

  async optimize(tableName: string): Promise<void> {
    await this.trinoGenerator.optimize(tableName);
  }

  async transform(
    tableName: string,
    batches: TransformationBatch[]
  ): Promise<TransformResult> {
    return this.trinoGenerator.transform(tableName, batches);
  }

  // Переопределяем generate(), чтобы создать lookup таблицу один раз с полным rowCount
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { table, rowCount } = options;

    // Создаем lookup таблицу в PostgreSQL один раз с полным rowCount перед обработкой батчей
    // Это должно быть сделано до того, как BaseDataGenerator.generate() начнет обрабатывать батчи
    if (!this.sql) {
      throw new Error("Not connected. Call connect() first.");
    }
    await this.createPostgresLookupTable(table, rowCount);

    // Вызываем родительский метод для обработки батчей
    return super.generate(options);
  }

  protected async generateNative(
    table: TableConfig,
    rowCount: number,
    startSequence: number
  ): Promise<void> {
    if (!this.sagaManager || !this.sql || !this.trino) {
      throw new Error("Not connected. Call connect() first.");
    }

    const sagaBatchSize = this.config.sagaBatchSize || 100000;
    const batchCount = Math.ceil(rowCount / sagaBatchSize);

    console.log(
      `[${this.name}] Generating ${rowCount.toLocaleString()} rows in ${batchCount} saga batches (${sagaBatchSize.toLocaleString()} rows each)`
    );

    // Lookup таблица уже создана в generate(), не создаем ее здесь

    // Генерируем данные батчами через Saga
    for (let batchNum = 0; batchNum < batchCount; batchNum++) {
      const batchStart = batchNum * sagaBatchSize;
      const batchSize = Math.min(sagaBatchSize, rowCount - batchStart);
      const batchStartSequence = startSequence + batchStart;

      try {
        await this.generateBatch(
          table,
          batchSize,
          batchStartSequence,
          batchNum + 1,
          batchCount
        );
      } catch (error) {
        console.error(
          `✗ Saga batch ${batchNum + 1}/${batchCount} failed: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }
  }

  private async createPostgresLookupTable(
    table: TableConfig,
    rowCount: number
  ): Promise<void> {
    if (!this.sql) {
      throw new Error("PostgreSQL connection not available");
    }

    // Определяем колонки для lookup таблицы
    const lookupColumns = this.config.postgresLookupColumns.map((colName) => {
      const col = table.columns.find((c) => c.name === colName);
      if (!col) {
        throw new Error(`Column ${colName} not found in table config`);
      }
      return col;
    });

    // Проверяем, существует ли таблица и сколько в ней строк
    const tableNameEscaped = escapePostgresIdentifier(this.config.postgresTableName);
    const countSql = `SELECT COUNT(*)::bigint as count FROM ${tableNameEscaped}`;
    
    let existingCount = 0;
    try {
      const countResult = await this.sql.unsafe(countSql);
      if (countResult && countResult.length > 0 && countResult[0]) {
        existingCount = Number(countResult[0].count);
      }
    } catch {
      // Таблица не существует, existingCount остается 0
    }

    if (existingCount >= rowCount) {
      // Таблица уже существует с достаточным количеством строк
      console.log(
        `✓ PostgreSQL lookup table '${this.config.postgresTableName}' already exists with ${existingCount.toLocaleString()} rows (skipping creation)`
      );
      return;
    } else if (existingCount > 0) {
      // Удаляем таблицу, если в ней недостаточно строк
      await this.sql.unsafe(`DROP TABLE IF EXISTS ${tableNameEscaped}`);
    }

    // Создаем таблицу в PostgreSQL
    const columnsDef = lookupColumns
      .map((col) => {
        const pgType = this.columnTypeToPostgres(col);
        return `${escapePostgresIdentifier(col.name)} ${pgType}`;
      })
      .join(", ");

    // Добавляем колонку для JOIN (row number)
    const createTableSql = `
      CREATE TABLE ${escapePostgresIdentifier(this.config.postgresTableName)} (
        ${columnsDef},
        row_number BIGINT NOT NULL
      )
    `;

    await this.sql.unsafe(createTableSql);

    // Генерируем данные через PostgreSQL native generation
    const lookupTableConfig: TableConfig = {
      name: this.config.postgresTableName,
      columns: [
        ...lookupColumns,
        {
          name: "row_number",
          type: "bigint",
          generator: { kind: "sequence", start: 1 },
        },
      ],
    };

    // Используем существующий postgresGenerator (уже подключен в connect())
    // Вызываем generateNative напрямую, чтобы не использовать батчинг и не перезаписывать данные
    await this.postgresGenerator.generateNative(lookupTableConfig, rowCount, 1);

    // Проверяем, сколько строк было создано
    const verifyCountSql = `SELECT COUNT(*)::bigint as count FROM ${tableNameEscaped}`;
    const verifyResult = await this.sql.unsafe(verifyCountSql);
    const actualCount = verifyResult && verifyResult.length > 0 && verifyResult[0] ? Number(verifyResult[0].count) : 0;

    console.log(
      `✓ Created PostgreSQL lookup table '${this.config.postgresTableName}' with ${actualCount.toLocaleString()} rows (requested: ${rowCount.toLocaleString()})`
    );
  }

  private async generateBatch(
    table: TableConfig,
    rowCount: number,
    startSequence: number,
    batchNum: number,
    totalBatches: number
  ): Promise<void> {
    if (!this.sagaManager || !this.trino) {
      throw new Error("Not connected");
    }

    const sagaId = await this.sagaManager.beginSaga({
      description: `Generate batch ${batchNum}/${totalBatches} (${rowCount.toLocaleString()} rows)`,
    });

    // Операция: генерация в Trino через SQL с CROSS JOIN к PostgreSQL
    this.sagaManager.addOperation({
      id: "generate-trino-batch",
      execute: async () => {
        await this.generateTrinoBatch(table, rowCount, startSequence);
        return { rowCount, sagaId };
      },
      compensate: async () => {
        // При ошибке удаляем данные из Trino (если возможно)
        // Для Iceberg это сложно, поэтому просто логируем
        console.log(
          `  Compensation: Trino data should be cleaned manually if needed`
        );
      },
    });

    // Выполняем сагу
    try {
      const result = await this.sagaManager.commitSaga();
      console.log(
        `✓ Saga batch ${batchNum}/${totalBatches} committed: ${result.sagaId} (${String(result.operationsCount)} operations)`
      );
    } catch (error) {
      console.error(
        `✗ Saga batch ${batchNum}/${totalBatches} failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async generateTrinoBatch(
    table: TableConfig,
    rowCount: number,
    startSequence: number
  ): Promise<void> {
    if (!this.trino) {
      throw new Error("Trino connection not available");
    }

    const trinoTable = `${escapeTrinoIdentifier(this.config.trinoConfig.catalog)}.${escapeTrinoIdentifier(this.config.trinoConfig.schema)}.${escapeTrinoIdentifier(this.config.trinoTableName)}`;
    // В Trino PostgreSQL connector структура: catalog.schema.table
    // schema - это схема PostgreSQL (обычно 'public'), database указывается в connection-url
    // Trino PostgreSQL connector приводит имена таблиц к нижнему регистру, если они не экранированы
    // Используем имя таблицы в нижнем регистре для соответствия тому, как Trino видит таблицу
    const postgresTableNameLower = this.config.postgresTableName.toLowerCase();
    const postgresTable = `${escapeTrinoIdentifier(this.postgresCatalogName)}.${escapeTrinoIdentifier("public")}.${postgresTableNameLower}`;

    // Разбиваем колонки на:
    // 1. Колонки из PostgreSQL lookup таблицы
    // 2. Колонки, генерируемые синтетически в Trino
    const postgresLookupCols = this.config.postgresLookupColumns;

    // Собираем choiceByLookup генераторы для создания CTE
    // Используем Map для дедупликации CTE с одинаковыми значениями
    const lookupCtesMap = new Map<string, string>();
    for (const col of table.columns) {
      if (col.generator.kind === "choiceByLookup") {
        const gen = col.generator;
        const cteName = getLookupTableName(gen.values);
        // Если CTE с таким именем уже существует, пропускаем
        if (!lookupCtesMap.has(cteName)) {
          const valuesLiteral = gen.values
            .map((v) => escapeTrinoLiteral(v))
            .join(", ");
          lookupCtesMap.set(
            cteName,
            `${cteName} AS (SELECT ARRAY[${valuesLiteral}] AS arr)`
          );
        }
      }
    }
    const lookupCtes = Array.from(lookupCtesMap.values());

    // Trino sequence() имеет лимит 10,000
    const SEQUENCE_LIMIT = 10_000;
    const ROWS_PER_CHUNK = SEQUENCE_LIMIT * SEQUENCE_LIMIT; // 100M
    const numChunks = Math.ceil(rowCount / ROWS_PER_CHUNK);

    // Выражение для номера строки в батче (от 1 до rowCount)
    const batchRowNum = `(CAST(level1 AS BIGINT) * BIGINT '${String(ROWS_PER_CHUNK)}' + CAST(level2 AS BIGINT) * BIGINT '${String(SEQUENCE_LIMIT)}' + level3)`;
    // Выражение для номера строки с учетом startSequence (для генерации значений)
    const seqExpr = `(CAST(${String(startSequence - 1)} AS BIGINT) + ${batchRowNum})`;
    // Выражение для row_number в PostgreSQL таблице (должно соответствовать row_number в PostgreSQL)
    // PostgreSQL таблица имеет row_number от 1 до rowCount, но нам нужен диапазон для текущего батча
    // Для батча 1: row_number от 1 до 100000
    // Для батча 2: row_number от 100001 до 200000
    // И т.д.
    const postgresRowNumber = `${batchRowNum} + CAST(${String(startSequence - 1)} AS BIGINT)`;

    // Строим выражения для SELECT
    const expressions: string[] = [];

    for (const mapping of this.config.trinoColumnMapping) {
      const sourceCol = table.columns.find(
        (c) => c.name === mapping.sourceColumn
      );
      if (!sourceCol) {
        throw new Error(
          `Column ${mapping.sourceColumn} not found in table config`
        );
      }

      // Находим целевую колонку в таблице для определения типа
      const targetCol = table.columns.find(
        (c) => c.name === mapping.targetColumn
      );
      const targetType =
        targetCol != null
          ? String(columnTypeToTrino(targetCol))
          : String(columnTypeToTrino(sourceCol));

      // Если колонка в PostgreSQL lookup таблице - берем оттуда
      if (postgresLookupCols.includes(mapping.sourceColumn)) {
        const pgCol = this.config.postgresColumnMapping.find(
          (pm) => pm.sourceColumn === mapping.sourceColumn
        );
        const pgColName = pgCol
          ? pgCol.targetColumn
          : mapping.sourceColumn;
        // JOIN по row_number
        // postgresTable уже содержит полный путь с экранированием, добавляем только имя колонки
        // Приводим тип из PostgreSQL к типу таблицы Trino
        const pgExpr = `${postgresTable}.${escapeTrinoIdentifier(pgColName)}`;
        expressions.push(`CAST(${pgExpr} AS ${targetType})`);
      } else {
        // Генерируем синтетически через Trino функции
        const generator = mapping.generator ?? sourceCol.generator;
        let expr = generatorToTrinoExpr(generator, seqExpr);
        // Применяем null probability если указано
        if (
          sourceCol.nullable &&
          sourceCol.nullProbability &&
          sourceCol.nullProbability > 0
        ) {
          expr = `CASE WHEN random() < ${String(sourceCol.nullProbability)} THEN NULL ELSE ${expr} END`;
        }
        // Приводим тип выражения к типу колонки таблицы
        expressions.push(`CAST(${expr} AS ${targetType})`);
      }
    }

    // Строим SQL запрос
    const columns = this.config.trinoColumnMapping.map((m) =>
      escapeTrinoIdentifier(m.targetColumn)
    );

    // Строим WITH clause для lookup CTE, если они есть
    const ctePrefix =
      lookupCtes.length > 0 ? `WITH ${lookupCtes.join(", ")} ` : "";

    // CROSS JOIN с lookup CTE для доступа к ним
    const lookupJoins =
      lookupCtes.length > 0
        ? " CROSS JOIN " +
          [
            ...new Set(
              table.columns
                .filter((c) => c.generator.kind === "choiceByLookup")
                .map((c) =>
                  getLookupTableName(
                    (c.generator as ChoiceByLookupGenerator).values
                  )
                )
            ),
          ].join(" CROSS JOIN ")
        : "";

    // Отладочное логирование для проверки JOIN
    console.log(
      `  [DEBUG] Batch: startSequence=${startSequence}, rowCount=${rowCount}, postgresRowNumber range: ${startSequence} to ${startSequence + rowCount - 1}`
    );

    const insertSql = `
      INSERT INTO ${trinoTable} (${columns.join(", ")})
      ${ctePrefix}SELECT ${expressions.join(", ")}
      FROM UNNEST(sequence(0, ${String(numChunks - 1)})) AS t1(level1)
      CROSS JOIN UNNEST(sequence(0, ${String(SEQUENCE_LIMIT - 1)})) AS t2(level2)
      CROSS JOIN UNNEST(sequence(1, ${String(SEQUENCE_LIMIT)})) AS t3(level3)
      INNER JOIN ${postgresTable} ON ${postgresTable}.${escapeTrinoIdentifier("row_number")} = ${postgresRowNumber}${lookupJoins}
      WHERE ${batchRowNum} <= BIGINT '${String(rowCount)}'
    `;

    const query = await this.trino.query(insertSql);
    for await (const result of query) {
      const trinoResult = result as { error?: { message: string } };
      if (trinoResult.error) {
        throw new Error(
          `Trino insert failed: ${trinoResult.error.message}`
        );
      }
    }

    console.log(
      `  ✓ Generated ${rowCount.toLocaleString()} rows in Trino via SQL with PostgreSQL CROSS JOIN`
    );
  }

  private columnTypeToPostgres(column: ColumnConfig): string {
    switch (column.type) {
      case "integer":
        return "INTEGER";
      case "bigint":
        return "BIGINT";
      case "float":
        return "DOUBLE PRECISION";
      case "string":
        return "VARCHAR(255)";
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "datetime":
        return "TIMESTAMP";
      default:
        return "VARCHAR(255)";
    }
  }
}

