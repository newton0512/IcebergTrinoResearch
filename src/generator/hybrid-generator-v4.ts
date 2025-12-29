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
  TransformationBatch,
  TransformResult,
  Transformation,
  ScenarioOptions,
  ScenarioResult,
  ScenarioGenerateStep,
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

export interface HybridGeneratorConfigV4 extends HybridGeneratorConfig {
  // Колонки, которые будут браться из временной таблицы PostgreSQL
  tempTableColumns: string[]; // имена колонок из TableConfig: registrar_type_id, registrar_id, row, amount
  // Имена таблиц для проверок
  uniqueCheckTableName: string; // bonus_registry_unique_check
  balanceCheckTableName: string; // bonus_registry_balance_check
  // Имя PostgreSQL каталога в Trino (по умолчанию "postgres")
  postgresCatalogName?: string;
  // Размер батча для Saga (по умолчанию 100K)
  sagaBatchSize?: number;
}

export class HybridDataGeneratorV4 extends BaseDataGenerator {
  readonly name = "hybrid-postgres-trino-v4";

  private postgresGenerator: PostgresDataGenerator;
  private trinoGenerator: TrinoDataGenerator;
  private sagaManager: SagaManager | null = null;
  private sql: Sql | null = null;
  private trino: Trino | null = null;
  private config: HybridGeneratorConfigV4;
  private postgresCatalogName: string;
  private tempTableName = "";
  // Отслеживание активных запросов для корректного завершения
  private activeQueries = new Set<AsyncIterable<unknown>>();
  // Отслеживание query ID для отмены через REST API
  private activeQueryIds = new Map<AsyncIterable<unknown>, string>();
  private isShuttingDown = false;
  private shutdownHandlers: (() => void)[] = [];
  private trinoServerUrl: string | null = null;
  private currentBatchSize: number | undefined = undefined;

  constructor(config: HybridGeneratorConfigV4) {
    super();
    this.config = config;
    this.postgresGenerator = new PostgresDataGenerator(config.postgresConfig);
    this.trinoGenerator = new TrinoDataGenerator(config.trinoConfig);
    this.postgresCatalogName = config.postgresCatalogName ?? "postgres";
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
    this.trinoServerUrl = `http://${this.config.trinoConfig.host}:${String(this.config.trinoConfig.port)}`;
    this.trino = Trino.create({
      server: this.trinoServerUrl,
      catalog: this.config.trinoConfig.catalog,
      schema: this.config.trinoConfig.schema,
      auth: new BasicAuth(this.config.trinoConfig.user),
    });

    // Создаем SagaManager
    this.sagaManager = new SagaManager(this.sql);

    // Обработка сигналов для корректного завершения
    const sigIntHandler = (): void => {
      void this.handleShutdown("SIGINT");
    };
    const sigTermHandler = (): void => {
      void this.handleShutdown("SIGTERM");
    };
    
    process.on("SIGINT", sigIntHandler);
    process.on("SIGTERM", sigTermHandler);
    
    // Сохраняем обработчики для последующего удаления
    this.shutdownHandlers.push(
      (): void => {
        process.removeListener("SIGINT", sigIntHandler);
      },
      (): void => {
        process.removeListener("SIGTERM", sigTermHandler);
      }
    );
  }

  async disconnect(): Promise<void> {
    // Отменяем все активные запросы
    await this.cancelActiveQueries();

    // Удаляем обработчики сигналов
    for (const handler of this.shutdownHandlers) {
      try {
        handler();
      } catch {
        // Игнорируем ошибки
      }
    }
    this.shutdownHandlers = [];

    // Удаляем временную таблицу при отключении
    if (this.sql) {
      try {
        await this.sql.unsafe(`DROP TABLE IF EXISTS ${escapePostgresIdentifier(this.tempTableName)}`);
      } catch {
        // Игнорируем ошибки при удалении временной таблицы
      }
    }

    await this.postgresGenerator.disconnect();
    await this.trinoGenerator.disconnect();
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

  protected async applyTransformations(
    tableName: string,
    transformations: Transformation[]
  ): Promise<void> {
    // Применяем трансформации только к Trino таблице
    // Используем каст для доступа к protected методу (как в hybrid-generator-v3)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.trinoGenerator as any).applyTransformations(tableName, transformations);
  }

  /**
   * Обработка завершения работы при получении сигналов SIGINT/SIGTERM
   */
  private async handleShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log(`\n[${this.name}] Received ${signal}, shutting down gracefully...`);

    try {
      // Отменяем все активные запросы
      await this.cancelActiveQueries();

      // Закрываем соединения
      await this.disconnect();
    } catch (error) {
      console.error(`[${this.name}] Error during shutdown:`, error);
    } finally {
      process.exit(0);
    }
  }

  /**
   * Отменяет Trino запрос через REST API
   */
  private async cancelTrinoQuery(queryId: string): Promise<void> {
    if (!this.trinoServerUrl) return;

    try {
      const url = `${this.trinoServerUrl}/v1/query/${queryId}`;
      const auth = Buffer.from(`${this.config.trinoConfig.user}:`).toString("base64");
      
      // Используем встроенный fetch (Node.js 18+) или node-fetch-native через tsx
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "Authorization": `Basic ${auth}`,
          "X-Trino-User": this.config.trinoConfig.user,
        },
      });

      if (!response.ok && response.status !== 404) {
        // 404 означает, что запрос уже завершен или не существует - это нормально
        const text = await response.text().catch(() => "");
        console.log(`  [WARN] Failed to cancel query ${queryId}: HTTP ${response.status}${text ? ` - ${text}` : ""}`);
      } else {
        console.log(`  [INFO] Successfully cancelled Trino query ${queryId}`);
      }
    } catch (error) {
      console.log(`  [WARN] Error cancelling query ${queryId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Отменяет все активные Trino запросы
   */
  private async cancelActiveQueries(): Promise<void> {
    if (this.activeQueries.size === 0) return;

    console.log(`[${this.name}] Cancelling ${this.activeQueries.size} active query/queries...`);

    const cancelPromises: Promise<void>[] = [];
    
    // Сначала отменяем запросы через REST API
    for (const [query, queryId] of this.activeQueryIds.entries()) {
      if (this.activeQueries.has(query)) {
        cancelPromises.push(this.cancelTrinoQuery(queryId));
      }
    }

    // Затем закрываем async iterators
    for (const query of this.activeQueries) {
      cancelPromises.push(
        (async (): Promise<void> => {
          try {
            // Пытаемся закрыть async iterator
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const asyncIter = query as any;
            if (typeof asyncIter.return === "function") {
              await asyncIter.return();
            }
            // Также пытаемся вызвать throw, если доступен
            if (typeof asyncIter.throw === "function") {
              try {
                await asyncIter.throw(new Error("Query cancelled due to shutdown"));
              } catch {
                // Игнорируем ошибки при отмене
              }
            }
          } catch {
            // Игнорируем ошибки при закрытии
          }
        })()
      );
    }

    await Promise.allSettled(cancelPromises);
    this.activeQueries.clear();
    this.activeQueryIds.clear();
  }

  /**
   * Извлекает query ID из результата Trino запроса
   * Trino возвращает query ID в разных форматах, нужно проверить все возможные варианты
   */
  private extractQueryId(result: unknown): string | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trinoResult = result as any;
      
      // Вариант 1: Прямое поле id
      if (trinoResult.id) return String(trinoResult.id);
      
      // Вариант 2: queryId или query_id
      if (trinoResult.queryId) return String(trinoResult.queryId);
      if (trinoResult.query_id) return String(trinoResult.query_id);
      
      // Вариант 3: nextUri содержит query ID в пути
      if (trinoResult.nextUri) {
        const match = trinoResult.nextUri.match(/\/v1\/query\/([^/]+)/);
        if (match && match[1]) return match[1];
      }
      
      // Вариант 4: stats может содержать query ID
      if (trinoResult.stats) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stats = trinoResult.stats as any;
        if (stats.queryId) return String(stats.queryId);
        if (stats.query_id) return String(stats.query_id);
      }
      
      // Вариант 5: Проверяем все строковые поля на наличие UUID-подобного формата
      for (const key in trinoResult) {
        const value = trinoResult[key];
        if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          return value;
        }
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Безопасно выполняет Trino запрос с отслеживанием и гарантированным закрытием
   */
  private async executeTrinoQuery<T = void>(
    queryPromise: Promise<AsyncIterable<unknown>>,
    operation: string,
    processor: (result: unknown) => T | Promise<T | undefined | null> = async (): Promise<undefined> => undefined
  ): Promise<T[]> {
    let query: AsyncIterable<unknown> | null = null;
    const results: T[] = [];
    let queryId: string | null = null;

    try {
      query = await queryPromise;
      this.activeQueries.add(query);

      // Пытаемся получить query ID из первого результата
      let firstResultProcessed = false;
      for await (const result of query) {
        if (!firstResultProcessed) {
          firstResultProcessed = true;
          queryId = this.extractQueryId(result);
          if (queryId) {
            this.activeQueryIds.set(query, queryId);
            console.log(`  [DEBUG] Query ID for ${operation}: ${queryId}`);
          } else {
            // Логируем структуру результата для отладки, если query ID не найден
            console.log(`  [DEBUG] Could not extract query ID from result, structure: ${JSON.stringify(Object.keys(result || {})).slice(0, 200)}`);
          }
        }

        if (this.isShuttingDown) {
          throw new Error(`Operation ${operation} interrupted due to shutdown`);
        }

        // КРИТИЧНО: Проверяем на ошибки ПЕРЕД обработкой (как в trino-generator.ts)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const trinoResult = result as any;
        if (trinoResult.error) {
          throw new Error(
            `Trino ${operation} failed: ${trinoResult.error.message}`
          );
        }

        // Обрабатываем результат через processor
        const processed = await processor(result);
        if (processed !== undefined && processed !== null) {
          results.push(processed);
        }

        // КРИТИЧНО: Для INSERT запросов Trino может отправлять пустые результаты или результаты со статусом
        // Нужно полностью потребить ВСЕ результаты, чтобы запрос завершился и изменения зафиксировались
        // Это особенно важно для Iceberg - все результаты должны быть потреблены до фиксации транзакции
      }

      return results;
    } catch (error) {
      // При ошибке пытаемся отменить запрос через REST API
      if (query && queryId) {
        console.log(`  [WARN] Attempting to cancel query ${queryId} due to error in ${operation}...`);
        await this.cancelTrinoQuery(queryId);
      }
      throw error;
    } finally {
      if (query) {
        this.activeQueries.delete(query);
        if (queryId) {
          this.activeQueryIds.delete(query);
        }
        try {
          // Гарантированно закрываем iterator
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const asyncIter = query as any;
          if (typeof asyncIter.return === "function") {
            await asyncIter.return();
          }
        } catch {
          // Игнорируем ошибки при закрытии
        }
      }
    }
  }

  /**
   * Переопределяем runScenario для специальной обработки сценария bonus-registry-checks
   * Используем последний шаг (bonus_registry) для создания временной таблицы
   * Первые два шага (check таблицы) заполняются из временной таблицы
   */
  async runScenario(options: ScenarioOptions): Promise<ScenarioResult> {
    const { scenario, dropFirst = false, createTable = true } = options;
    
    if (!this.sql) {
      throw new Error("Not connected. Call connect() first.");
    }

    // Находим шаги для check таблиц
    const uniqueCheckStep = scenario.steps
      .filter((step): step is ScenarioGenerateStep => 'table' in step)
      .find((step) => step.table.name === this.config.uniqueCheckTableName);
    
    const balanceCheckStep = scenario.steps
      .filter((step): step is ScenarioGenerateStep => 'table' in step)
      .find((step) => step.table.name === this.config.balanceCheckTableName);

    // Находим последний шаг с таблицей bonus_registry (она содержит все нужные колонки)
    const bonusRegistryStep = scenario.steps
      .filter((step): step is ScenarioGenerateStep => 'table' in step)
      .find((step) => step.table.name === this.config.trinoTableName);
    
    if (!bonusRegistryStep) {
      throw new Error(
        `Table '${this.config.trinoTableName}' not found in scenario steps. ` +
        `Available tables: ${scenario.steps
          .filter((step): step is ScenarioGenerateStep => 'table' in step)
          .map((s) => s.table.name)
          .join(', ')}`
      );
    }

    // Создаем check таблицы в PostgreSQL перед генерацией
    if (uniqueCheckStep) {
      if (dropFirst) {
        await this.postgresGenerator.dropTable(uniqueCheckStep.table.name);
      }
      if (createTable) {
        await this.postgresGenerator.createTable(uniqueCheckStep.table);
        // Создаем уникальный индекс
        await this.postgresGenerator.executeRaw(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_bonus_registry_unique_check_key_hash_name
          ON ${escapePostgresIdentifier(this.config.uniqueCheckTableName)} (key_fields_hash, name_of_uniqueness)
        `);
      }
    }

    if (balanceCheckStep) {
      if (dropFirst) {
        await this.postgresGenerator.dropTable(balanceCheckStep.table.name);
      }
      if (createTable) {
        await this.postgresGenerator.createTable(balanceCheckStep.table);
        // Создаем триггер для проверки баланса
        await this.postgresGenerator.createBalanceTrigger(
          this.config.balanceCheckTableName,
          "amount"
        );
      }
    }

    // Используем конфигурацию из bonus_registry для временной таблицы
    // Но генерируем только в Trino, пропуская первые два шага
    const result = await super.runScenario({
      ...options,
      scenario: {
        ...scenario,
        steps: [bonusRegistryStep], // Обрабатываем только последний шаг
      },
    });

    return result;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    // Сохраняем batchSize из параметров для использования в generateNative
    // Если batchSize указан, используем его для разбиения на саги
    // Это позволяет использовать большие батчи для саг, даже если generate() разбивает на меньшие батчи
    const { batchSize: requestedBatchSize } = options;
    if (requestedBatchSize && requestedBatchSize > 0) {
      this.currentBatchSize = requestedBatchSize;
    } else {
      // Если batchSize не указан, сбрасываем currentBatchSize
      // generateNative будет использовать sagaBatchSize из конфига
      this.currentBatchSize = undefined;
    }
    
    // Вызываем родительский метод
    return await super.generate(options);
  }

  protected async generateNative(
    table: TableConfig,
    rowCount: number,
    startSequence: number
  ): Promise<void> {
    if (!this.sagaManager || !this.sql || !this.trino) {
      throw new Error("Not connected. Call connect() first.");
    }

    // Используем batchSize из параметров generate(), если он был передан
    // Иначе используем sagaBatchSize из конфига, иначе дефолтное значение
    // Если currentBatchSize установлен, используем его для разбиения на саги
    // Иначе используем sagaBatchSize из конфига или дефолтное значение
    const sagaBatchSize = this.currentBatchSize ?? this.config.sagaBatchSize ?? 100000;
    const batchCount = Math.ceil(rowCount / sagaBatchSize);

    console.log(
      `[${this.name}] Generating ${rowCount.toLocaleString()} rows in ${batchCount} saga batches (${sagaBatchSize.toLocaleString()} rows each)`
    );

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

  /**
   * Создает временную таблицу и заполняет её данными для батча
   */
  private async createTempTableBatch(
    table: TableConfig,
    batchSize: number,
    startSequence: number
  ): Promise<void> {
    if (!this.sql) {
      throw new Error("PostgreSQL connection not available");
    }

    const startTime = Date.now();

    // Генерируем уникальное имя для временной таблицы для каждого батча
    this.tempTableName = `temp_bonus_registry_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Определяем колонки для временной таблицы
    const tempColumns = this.config.tempTableColumns.map((colName) => {
      const col = table.columns.find((c) => c.name === colName);
      if (!col) {
        throw new Error(`Column ${colName} not found in table config`);
      }
      return col;
    });

    // Создаем обычную таблицу (не TEMP, т.к. Trino connector не видит временные таблицы)
    // Добавляем row_number для прямого JOIN (как в V3)
    const columnsDef = [
      "id VARCHAR(255) PRIMARY KEY",
      "row_number BIGINT NOT NULL",
      ...tempColumns.map((col) => {
        const pgType = this.columnTypeToPostgres(col);
        return `${escapePostgresIdentifier(col.name)} ${pgType}`;
      }),
    ].join(", ");

    const createTableSql = `
      CREATE TABLE ${escapePostgresIdentifier(this.tempTableName)} (
        ${columnsDef}
      )
    `;

    const createTableStart = Date.now();
    await this.sql.unsafe(createTableSql);
    const createTableTime = Date.now() - createTableStart;

    // Генерируем данные через PostgreSQL native generation
    // Включаем row_number для прямого JOIN
    // ВАЖНО: row_number должен быть от startSequence до startSequence + batchSize - 1
    // Используем простой генератор без start, чтобы избежать двойного учета startSequence
    const tempTableConfig: TableConfig = {
      name: this.tempTableName,
      columns: [
        {
          name: "id",
          type: "string",
          generator: { kind: "uuid" },
        },
        {
          name: "row_number",
          type: "bigint",
          generator: { kind: "sequence", start: 1 }, // Используем start: 1, т.к. startSequence уже учитывается в generateNative
        },
        ...tempColumns,
      ],
    };

    // Используем существующий postgresGenerator для быстрой генерации
    // Используем каст для доступа к protected методу (как в hybrid-generator-v3)
    // startSequence передается в generateNative, который добавит его к seqExpr
    // Для row_number: seqExpr = (n + startSequence - 1), generator вернет (1 - 1 + seqExpr * 1) = seqExpr = (n + startSequence - 1)
    // Это даст row_number от startSequence до startSequence + batchSize - 1
    const generateStart = Date.now();
    await (this.postgresGenerator as any).generateNative(tempTableConfig, batchSize, startSequence);
    const generateTime = Date.now() - generateStart;
    const totalTime = Date.now() - startTime;

    console.log(
      `  ✓ Created temp table '${this.tempTableName}' with ${batchSize.toLocaleString()} rows (create: ${createTableTime}ms, generate: ${generateTime}ms, total: ${totalTime}ms)`
    );
  }

  /**
   * Заполняет bonus_registry_unique_check и bonus_registry_balance_check на основе временной таблицы
   * Возвращает true если успешно, false если есть проблемы с уникальностью или балансом
   */
  private async fillCheckTables(
    sagaId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.sql) {
      throw new Error("PostgreSQL connection not available");
    }

    const startTime = Date.now();

    try {
      // 1. Заполняем bonus_registry_unique_check
      // Вычисляем хэш на основе registrar_type_id, registrar_id и row
      const insertUniqueCheckSql = `
        INSERT INTO ${escapePostgresIdentifier(this.config.uniqueCheckTableName)} (
          id,
          name_of_uniqueness,
          key_fields_hash,
          "createdAt",
          "sagaId"
        )
        SELECT
          gen_random_uuid()::text AS id,
          'registrar_unique' AS name_of_uniqueness,
          md5(
            COALESCE(${escapePostgresIdentifier("registrar_type_id")}, '') || '|' ||
            COALESCE(${escapePostgresIdentifier("registrar_id")}, '') || '|' ||
            COALESCE(${escapePostgresIdentifier("row")}::text, '')
          ) AS key_fields_hash,
          NOW() AS "createdAt",
          ${escapePostgresLiteral(sagaId)} AS "sagaId"
        FROM ${escapePostgresIdentifier(this.tempTableName)}
      `;

      const uniqueCheckStart = Date.now();
      await this.sql.unsafe(insertUniqueCheckSql);
      const uniqueCheckTime = Date.now() - uniqueCheckStart;
      console.log(`  ✓ Filled ${this.config.uniqueCheckTableName} (${uniqueCheckTime}ms)`);

      // 2. Заполняем bonus_registry_balance_check
      const insertBalanceCheckSql = `
        INSERT INTO ${escapePostgresIdentifier(this.config.balanceCheckTableName)} (
          id,
          amount,
          "sagaId"
        )
        SELECT
          id,
          ${escapePostgresIdentifier("amount")},
          ${escapePostgresLiteral(sagaId)} AS "sagaId"
        FROM ${escapePostgresIdentifier(this.tempTableName)}
      `;

      const balanceCheckStart = Date.now();
      await this.sql.unsafe(insertBalanceCheckSql);
      const balanceCheckTime = Date.now() - balanceCheckStart;
      const totalTime = Date.now() - startTime;
      console.log(`  ✓ Filled ${this.config.balanceCheckTableName} (${balanceCheckTime}ms, total: ${totalTime}ms)`);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Проверяем, является ли ошибка проблемой уникальности или баланса
      if (
        errorMessage.includes("unique") ||
        errorMessage.includes("duplicate") ||
        errorMessage.includes("23505") || // unique_violation
        errorMessage.includes("23514") || // check_violation
        errorMessage.includes("negative")
      ) {
        console.log(`  ✗ Check failed: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
      
      // Другие ошибки пробрасываем дальше
      throw error;
    }
  }

  private async generateBatch(
    table: TableConfig,
    rowCount: number,
    startSequence: number,
    batchNum: number,
    totalBatches: number
  ): Promise<void> {
    if (!this.sagaManager || !this.sql || !this.trino) {
      throw new Error("Not connected");
    }

    const batchStartTime = Date.now();
    console.log(`  [TIMING] Batch ${batchNum}/${totalBatches} started at ${new Date().toISOString()}`);

    const sagaId = await this.sagaManager.beginSaga({
      description: `Generate batch ${batchNum}/${totalBatches} (${rowCount.toLocaleString()} rows)`,
    });

    let tempTableCreated = false;
    let uniqueCheckFilled = false;
    let balanceCheckFilled = false;

    // Операция 1: Создание временной таблицы
    this.sagaManager.addOperation({
      id: "create-temp-table",
      execute: async () => {
        await this.createTempTableBatch(table, rowCount, startSequence);
        tempTableCreated = true;
        return { tempTableName: this.tempTableName };
      },
      compensate: async () => {
        if (tempTableCreated && this.sql) {
          try {
            await this.sql.unsafe(`DROP TABLE IF EXISTS ${escapePostgresIdentifier(this.tempTableName)}`);
          } catch {
            // Игнорируем ошибки при удалении
          }
        }
      },
    });

    // Операция 2: Заполнение check таблиц
    this.sagaManager.addOperation({
      id: "fill-check-tables",
      execute: async () => {
        const result = await this.fillCheckTables(sagaId);
        if (!result.success) {
          throw new Error(`Check tables validation failed: ${result.error ?? "Unknown error"}`);
        }
        uniqueCheckFilled = true;
        balanceCheckFilled = true;
        return { success: true };
      },
      compensate: async () => {
        // Удаляем записи из check таблиц по sagaId
        if (uniqueCheckFilled && this.sql) {
          try {
            await this.sql.unsafe(`
              DELETE FROM ${escapePostgresIdentifier(this.config.uniqueCheckTableName)}
              WHERE "sagaId" = ${escapePostgresLiteral(sagaId)}
            `);
          } catch {
            // Игнорируем ошибки
          }
        }
        if (balanceCheckFilled && this.sql) {
          try {
            await this.sql.unsafe(`
              DELETE FROM ${escapePostgresIdentifier(this.config.balanceCheckTableName)}
              WHERE "sagaId" = ${escapePostgresLiteral(sagaId)}
            `);
          } catch {
            // Игнорируем ошибки
          }
        }
      },
    });

    // Операция 3: Генерация в Trino через SQL с использованием временной таблицы
    this.sagaManager.addOperation({
      id: "generate-trino-batch",
      execute: async () => {
        await this.generateTrinoBatch(table, rowCount, startSequence, sagaId);
        return { rowCount, sagaId };
      },
      compensate: () => {
        // При ошибке удаляем данные из Trino (если возможно)
        // Для Iceberg это сложно, поэтому просто логируем
        console.log(
          `  Compensation: Trino data should be cleaned manually if needed`
        );
        return Promise.resolve();
      },
    });

    // Выполняем сагу
    try {
      const sagaCommitStart = Date.now();
      const result = await this.sagaManager.commitSaga();
      const sagaCommitTime = Date.now() - sagaCommitStart;
      const batchTotalTime = Date.now() - batchStartTime;
      console.log(
        `✓ Saga batch ${batchNum}/${totalBatches} committed: ${result.sagaId} (${String(result.operationsCount)} operations, commit: ${sagaCommitTime}ms, total: ${batchTotalTime}ms)`
      );
    } catch (error) {
      const batchTotalTime = Date.now() - batchStartTime;
      console.error(
        `✗ Saga batch ${batchNum}/${totalBatches} failed (total: ${batchTotalTime}ms): ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    } finally {
      // Удаляем временную таблицу после успешного или неуспешного выполнения
      if (this.sql && this.tempTableName) {
        try {
          const dropStart = Date.now();
          await this.sql.unsafe(`DROP TABLE IF EXISTS ${escapePostgresIdentifier(this.tempTableName)}`);
          const dropTime = Date.now() - dropStart;
          console.log(`  [TIMING] Dropped temp table (${dropTime}ms)`);
        } catch {
          // Игнорируем ошибки при удалении
        }
      }
    }
  }

  private async generateTrinoBatch(
    table: TableConfig,
    rowCount: number,
    startSequence: number,
    _sagaId: string
  ): Promise<void> {
    if (!this.trino) {
      throw new Error("Trino connection not available");
    }

    const trinoTable = `${escapeTrinoIdentifier(this.config.trinoConfig.catalog)}.${escapeTrinoIdentifier(this.config.trinoConfig.schema)}.${escapeTrinoIdentifier(this.config.trinoTableName)}`;
    
    // В Trino PostgreSQL connector структура: catalog.schema.table
    // Используем обычную таблицу (не TEMP, т.к. Trino connector не видит временные таблицы)
    const postgresTableName = this.tempTableName.toLowerCase(); // Trino приводит имена к нижнему регистру
    const postgresTable = `${escapeTrinoIdentifier(this.postgresCatalogName)}.${escapeTrinoIdentifier("public")}.${escapeTrinoIdentifier(postgresTableName)}`;

    // Разбиваем колонки на:
    // 1. Колонки из временной таблицы PostgreSQL
    // 2. Колонки, генерируемые синтетически в Trino
    const tempTableCols = this.config.tempTableColumns;

    // Собираем choiceByLookup генераторы для создания CTE
    const lookupCtesMap = new Map<string, string>();
    for (const col of table.columns) {
      if (col.generator.kind === "choiceByLookup") {
        const gen = col.generator;
        const cteName = getLookupTableName(gen.values);
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
    // ВАЖНО: startSequence должен быть уникальным для каждого батча, чтобы генерировать разные данные
    // Для батча 1: startSequence = 1, seqExpr будет от 1 до rowCount
    // Для батча 2: startSequence = 100001, seqExpr будет от 100001 до 100000 + rowCount
    const seqExpr = `(CAST(${String(startSequence - 1)} AS BIGINT) + ${batchRowNum})`;

    // Строим выражения для SELECT
    // Если trinoColumnMapping пустой, используем все колонки из table.columns
    const useDirectMapping = this.config.trinoColumnMapping.length === 0;
    const expressions: string[] = [];
    const columns: string[] = [];

    if (useDirectMapping) {
      // Используем все колонки напрямую из table.columns
      for (const col of table.columns) {
        const targetType = columnTypeToTrino(col);
        columns.push(escapeTrinoIdentifier(col.name));

        // Если колонка во временной таблице - берем оттуда
        if (tempTableCols.includes(col.name)) {
          const pgExpr = `${postgresTable}.${escapeTrinoIdentifier(col.name)}`;
          expressions.push(`CAST(${pgExpr} AS ${targetType})`);
        } else {
          // Генерируем синтетически через Trino функции
          let expr = generatorToTrinoExpr(col.generator, seqExpr);
          // Применяем null probability если указано
          if (
            col.nullable &&
            col.nullProbability &&
            col.nullProbability > 0
          ) {
            expr = `CASE WHEN random() < ${String(col.nullProbability)} THEN NULL ELSE ${expr} END`;
          }
          // Приводим тип выражения к типу колонки таблицы
          expressions.push(`CAST(${expr} AS ${targetType})`);
        }
      }
    } else {
      // Используем маппинг (как в V3)
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
            ? columnTypeToTrino(targetCol)
            : columnTypeToTrino(sourceCol);

        columns.push(escapeTrinoIdentifier(mapping.targetColumn));

        // Если колонка во временной таблице - берем оттуда
        if (tempTableCols.includes(mapping.sourceColumn)) {
          const pgColName = mapping.sourceColumn;
          // Прямой JOIN с временной таблицей (без алиаса temp)
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
    }

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

    // Прямой JOIN с временной таблицей по row_number (как в V3)
    // row_number уже есть в таблице, поэтому используем прямой JOIN без подзапросов
    // ВАЖНО: postgresRowNumber должен соответствовать row_number во временной таблице
    // Временная таблица имеет row_number от startSequence до startSequence + rowCount - 1
    // batchRowNum идет от 1 до rowCount, поэтому postgresRowNumber = batchRowNum + (startSequence - 1)
    // Это даст диапазон от startSequence до startSequence + rowCount - 1, что правильно
    const postgresRowNumber = `${batchRowNum} + CAST(${String(startSequence - 1)} AS BIGINT)`;

    // Отладочное логирование для проверки диапазонов
    console.log(`  [DEBUG] Batch: startSequence=${startSequence}, rowCount=${rowCount}, postgresRowNumber range: ${startSequence} to ${startSequence + rowCount - 1}`);

    const insertSql = `
      INSERT INTO ${trinoTable} (${columns.join(", ")})
      ${ctePrefix}SELECT ${expressions.join(", ")}
      FROM UNNEST(sequence(0, ${String(numChunks - 1)})) AS t1(level1)
      CROSS JOIN UNNEST(sequence(0, ${String(SEQUENCE_LIMIT - 1)})) AS t2(level2)
      CROSS JOIN UNNEST(sequence(1, ${String(SEQUENCE_LIMIT)})) AS t3(level3)
      INNER JOIN ${postgresTable} ON ${postgresTable}.${escapeTrinoIdentifier("row_number")} = ${postgresRowNumber}${lookupJoins}
      WHERE ${batchRowNum} <= BIGINT '${String(rowCount)}'
    `;

    console.log(`  [DEBUG] Executing Trino INSERT with temp table: ${postgresTable}`);

    // Упрощенное выполнение запроса (как в V3 и trino-generator.ts)
    // Просто потребляем все результаты без сложного управления
    const query = await this.trino.query(insertSql);
    
    // Отслеживаем query для возможной отмены при shutdown
    this.activeQueries.add(query);
    let queryId: string | null = null;
    let firstResult = true;
    
    try {
      for await (const result of query) {
        // Извлекаем query ID из первого результата для возможной отмены
        if (firstResult) {
          firstResult = false;
          queryId = this.extractQueryId(result);
          if (queryId) {
            this.activeQueryIds.set(query, queryId);
          }
        }

        // Проверяем на ошибки (как в trino-generator.ts executeQuery)
        const trinoResult = result as { error?: { message: string } };
        if (trinoResult.error) {
          throw new Error(
            `Trino insert failed: ${trinoResult.error.message}`
          );
        }
        
        // КРИТИЧНО: Продолжаем потреблять все результаты, даже пустые
        // Это необходимо для завершения запроса и фиксации изменений в Iceberg
      }
    } finally {
      // Очищаем отслеживание запроса
      this.activeQueries.delete(query);
      if (queryId) {
        this.activeQueryIds.delete(query);
      }
    }

    console.log(
      `  ✓ Generated ${rowCount.toLocaleString()} rows in Trino via SQL with temp table JOIN`
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

