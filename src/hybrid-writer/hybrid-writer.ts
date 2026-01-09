import postgres, { type Sql } from "postgres";
import { Trino, BasicAuth } from "trino-client";
import * as amqp from "amqplib";
import type { Connection, Channel } from "amqplib";
import { SagaManager } from "../saga/index.js";
import {
  generateRegistrarObject,
  bonus_registry_faker,
  insertBonusRegistryIntoTrino,
  insertBonusRegistryBatchIntoTrino,
  hashObject,
  type BonusRegistryFakerObject,
} from "./utils.js";
import { escapePostgresIdentifier, escapePostgresLiteral } from "../generator/escape.js";

/**
 * Конфигурация гибридного писателя
 */
export interface HybridWriterConfig {
  postgres: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  trino: {
    host: string;
    port: number;
    catalog: string;
    schema: string;
    user: string;
    table: string;
  };
  rabbitmq?: {
    host: string;
    port: number;
    username: string;
    password: string;
    queue: string;
  };
  tables: {
    uniqueCheck: string; // bonus_registry_unique_check
    balanceCheck: string; // bonus_registry_balance_check
  };
}

/**
 * Опции для записи данных
 */
export interface WriteOptions {
  optimistic?: boolean; // Если true - отправка в RabbitMQ, если false - запись в Trino напрямую
  amount?: number; // Если не указан, генерируется случайно от -1000 до +10000
  verbose?: boolean; // Если false - отключает детальное логирование (по умолчанию false)
  useBatching?: boolean; // Если true - использовать батчинг для Trino (только для pessimistic режима)
}

/**
 * Результат записи
 */
export interface WriteResult {
  sagaId: string;
  registrar_type_id: string;
  registrar_id: string;
  row: number;
  amount: number;
  optimistic: boolean;
}


/**
 * Гибридный писатель для записи данных bonus_registry с использованием Saga
 */
export class HybridWriter {
  private sql: Sql | null = null;
  private trino: Trino | null = null;
  private rabbitmqConnection: Connection | null = null;
  private rabbitmqChannel: Channel | null = null;
  private sagaManager: SagaManager | null = null;
  private rabbitmqConnectionPromise: Promise<void> | null = null;

  constructor(
    private config: HybridWriterConfig
  ) {}

  /**
   * Подключение к базам данных и RabbitMQ
   */
  async connect(): Promise<void> {
    // Подключение к PostgreSQL
    this.sql = postgres({
      host: this.config.postgres.host,
      port: this.config.postgres.port,
      database: this.config.postgres.database,
      username: this.config.postgres.username,
      password: this.config.postgres.password,
    });

    // Создаем SagaManager
    this.sagaManager = new SagaManager(this.sql);

    console.log("✓ Connected to PostgreSQL");

    // Подключение к Trino
    this.trino = Trino.create({
      server: `http://${this.config.trino.host}:${String(this.config.trino.port)}`,
      catalog: this.config.trino.catalog,
      schema: this.config.trino.schema,
      auth: new BasicAuth(this.config.trino.user),
    });

    console.log(`✓ Connected to Trino: ${this.config.trino.catalog}.${this.config.trino.schema}`);

    // RabbitMQ подключение будет выполнено лениво только при необходимости (optimistic режим)
    // Не создаем промис заранее, чтобы избежать попыток подключения в pessimistic режиме
    if (this.config.rabbitmq) {
      console.log(`ℹ RabbitMQ configured (will connect on demand for optimistic mode)`);
    }
  }

  /**
   * Подключение к RabbitMQ (ленивое, только при необходимости, с защитой от race condition)
   */
  private async ensureRabbitMQConnection(): Promise<void> {
    if (!this.config.rabbitmq) {
      throw new Error("RabbitMQ not configured");
    }

    // Если уже подключены, возвращаемся
    if (this.rabbitmqConnection && this.rabbitmqChannel) {
      return;
    }

    // Если подключение уже в процессе, ждем его
    if (this.rabbitmqConnectionPromise) {
      await this.rabbitmqConnectionPromise;
      return;
    }

    // Создаем новое подключение
    this.rabbitmqConnectionPromise = (async () => {
      try {
        const rabbitmqUrl = `amqp://${this.config.rabbitmq!.username}:${this.config.rabbitmq!.password}@${this.config.rabbitmq!.host}:${this.config.rabbitmq!.port}`;
        const connection = await amqp.connect(rabbitmqUrl);
        this.rabbitmqConnection = connection as unknown as Connection;
        this.rabbitmqChannel = await connection.createChannel();

        // Объявляем очередь (если не существует)
        await this.rabbitmqChannel.assertQueue(this.config.rabbitmq!.queue, {
          durable: true,
        });
        console.log(`✓ Connected to RabbitMQ queue: ${this.config.rabbitmq!.queue}`);
      } finally {
        this.rabbitmqConnectionPromise = null;
      }
    })();

    await this.rabbitmqConnectionPromise;
  }

  /**
   * Отключение от всех сервисов
   */
  async disconnect(): Promise<void> {
    // Ждем завершения подключения к RabbitMQ, если оно в процессе
    if (this.rabbitmqConnectionPromise) {
      await this.rabbitmqConnectionPromise.catch(() => {
        // Игнорируем ошибки при ожидании подключения
      });
    }

    if (this.rabbitmqChannel) {
      try {
        await this.rabbitmqChannel.close();
      } catch (error) {
        // Игнорируем ошибки при закрытии
      }
      this.rabbitmqChannel = null;
    }

    if (this.rabbitmqConnection) {
      try {
        await (this.rabbitmqConnection as unknown as { close(): Promise<void> }).close();
      } catch (error) {
        // Игнорируем ошибки при закрытии
      }
      this.rabbitmqConnection = null;
    }

    if (this.sql) {
      try {
        await this.sql.end();
      } catch (error) {
        // Игнорируем ошибки при закрытии
      }
      this.sql = null;
    }

    if (this.trino) {
      // Trino клиент не требует явного закрытия, но можно очистить ссылку
      this.trino = null;
    }

    this.sagaManager = null;
    this.rabbitmqConnectionPromise = null;

    console.log("✓ Disconnected from all services");
  }

  /**
   * Запись данных с использованием Saga
   */
  async write(options: WriteOptions = {}): Promise<WriteResult> {
    if (!this.sql) {
      throw new Error("Not connected. Call connect() first.");
    }

    const optimistic = options.optimistic ?? false;
    const verbose = options.verbose ?? false;
    const amount = options.amount ?? Math.floor(Math.random() * 11001) - 1000; // От -1000 до +10000

    // Создаем отдельный экземпляр SagaManager для каждого вызова write()
    // Это необходимо для поддержки параллельных вызовов
    const sagaManager = new SagaManager(this.sql);

    // 1. Открываем сагу
    const sagaBeginStart = Date.now();
    const sagaId = await sagaManager.beginSaga({
      description: `Write bonus registry entry (optimistic: ${optimistic})`,
    });
    const sagaBeginDuration = Date.now() - sagaBeginStart;
    if (verbose) {
      console.log(`  ⏱ Saga opened: ${sagaId} (${sagaBeginDuration}ms)`);
    }

    // 2. Генерируем registrar_type_id, registrar_id, row
    const generateRegistrarStart = Date.now();
    const registrarData = generateRegistrarObject();
    const { registrar_type_id, registrar_id, row } = registrarData;
    const generateRegistrarDuration = Date.now() - generateRegistrarStart;
    if (verbose) {
      console.log(`  ⏱ Generated registrar data: ${registrar_type_id}/${registrar_id}/row=${row} (${generateRegistrarDuration}ms)`);
    }

    try {
      // 3. Записываем в bonus_registry_unique_check
      sagaManager.addOperation({
        id: "insert-unique-check",
        execute: async () => {
          const startTime = Date.now();
          if (!this.sql) {
            throw new Error("PostgreSQL connection not available");
          }

          // Вычисляем хэш на основе registrar_type_id, registrar_id и row
          const keyFieldsHash = hashObject({
            registrar_type_id,
            registrar_id,
            row,
          });

          const insertSql = `
            INSERT INTO ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} (
              id,
              name_of_uniqueness,
              key_fields_hash,
              "createdAt",
              "sagaId"
            )
            VALUES (
              gen_random_uuid()::text,
              ${escapePostgresLiteral("registrar_unique")},
              ${escapePostgresLiteral(keyFieldsHash)},
              NOW(),
              ${escapePostgresLiteral(sagaId)}
            )
            RETURNING id
          `;

          const result = await this.sql.unsafe<Array<{ id: string }>>(insertSql);
          const insertedId = result && result.length > 0 ? result[0]?.id : null;

          if (!insertedId) {
            throw new Error("Failed to insert into bonus_registry_unique_check");
          }

          const duration = Date.now() - startTime;
          if (verbose) {
            console.log(`  ✓ Inserted into ${this.config.tables.uniqueCheck}: ${insertedId} (${duration}ms)`);
          }
          return insertedId;
        },
        compensate: async (data) => {
          if (!this.sql || !data) {
            return;
          }
          const recordId = data as string;
          await this.sql.unsafe(
            `DELETE FROM ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} WHERE id = ${escapePostgresLiteral(recordId)}`
          );
          if (verbose) {
            console.log(`  ✓ Compensated ${this.config.tables.uniqueCheck}: ${recordId}`);
          }
        },
      });

      // 4. Генерируем баланс и записываем в bonus_registry_balance_check
      sagaManager.addOperation({
        id: "insert-balance-check",
        execute: async () => {
          const startTime = Date.now();
          if (!this.sql) {
            throw new Error("PostgreSQL connection not available");
          }

          const insertSql = `
            INSERT INTO ${escapePostgresIdentifier(this.config.tables.balanceCheck)} (
              id,
              amount,
              "sagaId"
            )
            VALUES (
              gen_random_uuid()::text,
              ${String(amount)}::DECIMAL(20, 2),
              ${escapePostgresLiteral(sagaId)}
            )
            RETURNING id
          `;

          const result = await this.sql.unsafe<Array<{ id: string }>>(insertSql);
          const insertedId = result && result.length > 0 ? result[0]?.id : null;

          if (!insertedId) {
            throw new Error("Failed to insert into bonus_registry_balance_check");
          }

          const duration = Date.now() - startTime;
          if (verbose) {
            console.log(`  ✓ Inserted into ${this.config.tables.balanceCheck}: ${insertedId} (amount: ${amount}, ${duration}ms)`);
          }
          return insertedId;
        },
        compensate: async (data) => {
          if (!this.sql || !data) {
            return;
          }
          const recordId = data as string;
          await this.sql.unsafe(
            `DELETE FROM ${escapePostgresIdentifier(this.config.tables.balanceCheck)} WHERE id = ${escapePostgresLiteral(recordId)}`
          );
          if (verbose) {
            console.log(`  ✓ Compensated ${this.config.tables.balanceCheck}: ${recordId}`);
          }
        },
      });

      // 5. Если optimistic=true - отправляем в RabbitMQ
      if (optimistic) {
        // Подключаемся к RabbitMQ только при необходимости
        await this.ensureRabbitMQConnection();

        if (!this.rabbitmqChannel) {
          throw new Error("RabbitMQ connection not available. Required for optimistic mode.");
        }

        sagaManager.addOperation({
          id: "send-to-rabbitmq",
          execute: async () => {
            const startTime = Date.now();
            const message = {
              registrar_type_id,
              registrar_id,
              row,
              amount,
            };

            const sent = this.rabbitmqChannel!.sendToQueue(
              this.config.rabbitmq!.queue,
              Buffer.from(JSON.stringify(message)),
              { persistent: true }
            );

            if (!sent) {
              throw new Error("Failed to send message to RabbitMQ queue");
            }

            const duration = Date.now() - startTime;
            if (verbose) {
              console.log(`  ✓ Sent to RabbitMQ: ${JSON.stringify(message)} (${duration}ms)`);
            }
            return message;
          },
          compensate: async () => {
            // Для RabbitMQ компенсация сложна - сообщение уже отправлено
            // В production можно использовать подтверждения или dead letter queue
            console.log(`  ⚠ Cannot compensate RabbitMQ message (already sent)`);
          },
        });
      } else {
        // 6. Если optimistic=false - записываем в Trino напрямую
        if (!this.trino) {
          throw new Error("Trino connection not available. Required for pessimistic mode.");
        }

        sagaManager.addOperation({
          id: "insert-into-trino",
          execute: async () => {
            // Генерируем полный объект через faker
            const fakerStart = Date.now();
            const fakerData = bonus_registry_faker();
            const fakerDuration = Date.now() - fakerStart;
            if (verbose) {
              console.log(`  ⏱ Generated faker data (${fakerDuration}ms)`);
            }

            // Дополняем объект полями из саги
            const finalData = {
              ...fakerData,
              registrar_type_id,
              registrar_id,
              row,
              amount, // Используем amount из саги
            };

            // Записываем в Trino (с retry механизмом внутри)
            const trinoInsertStart = Date.now();
            await insertBonusRegistryIntoTrino(
              this.trino!,
              finalData,
              {
                catalog: this.config.trino.catalog,
                schema: this.config.trino.schema,
                table: this.config.trino.table,
              }
            );
            const trinoInsertDuration = Date.now() - trinoInsertStart;
            if (verbose) {
              console.log(`  ✓ Inserted into Trino: ${finalData.id} (${trinoInsertDuration}ms)`);
            }
            return finalData.id;
          },
          compensate: async () => {
            // Для Iceberg компенсация через DELETE возможна, но сложна
            // В production можно использовать версионирование или логирование
            console.log(`  ⚠ Cannot compensate Trino insert (Iceberg does not support rollback)`);
          },
        });
      }

      // Выполняем сагу
      const sagaStartTime = Date.now();
      await sagaManager.commitSaga();
      const sagaDuration = Date.now() - sagaStartTime;
      if (verbose && sagaDuration > 100) {
        console.log(`  ⏱ Saga completed in ${sagaDuration}ms`);
      }

      return {
        sagaId,
        registrar_type_id,
        registrar_id,
        row,
        amount,
        optimistic,
      };
    } catch (error) {
      // При ошибке явно откатываем сагу (если она еще не была откачена)
      // commitSaga() уже вызывает rollbackSaga() при ошибке, но для надежности
      // проверяем и здесь, на случай если ошибка возникла до commitSaga()
      const rollbackStartTime = Date.now();
      try {
        // Проверяем, что сага еще активна (не была откачена в commitSaga())
        // rollbackSaga() безопасен для повторного вызова, но лучше проверить
        await sagaManager.rollbackSaga();
        const rollbackDuration = Date.now() - rollbackStartTime;
        if (verbose) {
          console.log(`  ⏱ Saga rolled back (${rollbackDuration}ms)`);
        }
      } catch (rollbackError) {
        // Если сага уже была откачена (например, в commitSaga()), это нормально
        // Логируем только если это не ошибка "Saga not started"
        const rollbackDuration = Date.now() - rollbackStartTime;
        const isAlreadyRolledBack = rollbackError instanceof Error && 
          rollbackError.message.includes("Saga not started");
        if (!isAlreadyRolledBack) {
          console.error(`  ✗ Failed to rollback saga (${rollbackDuration}ms):`, rollbackError);
        } else if (verbose) {
          console.log(`  ⏱ Saga already rolled back (likely by commitSaga())`);
        }
      }
      // Пробрасываем исходную ошибку
      throw error;
    }
  }

  /**
   * Асинхронная запись (не ждет завершения)
   */
  async writeAsync(options: WriteOptions = {}): Promise<Promise<WriteResult>> {
    return this.write(options);
  }

  /**
   * Пакетная запись нескольких записей с поддержкой параллельности
   */
  async writeBatch(
    count: number,
    options: WriteOptions = {},
    concurrency: number = 20 // Количество параллельных записей
  ): Promise<WriteResult[]> {
    // Если pessimistic режим и включен батчинг, используем батчинг для Trino
    if (!options.optimistic && options.useBatching && this.trino) {
      const batchSize = Number.parseInt(process.env.BATCH_SIZE || "100", 10);
      return this.writeBatchWithBatching(count, options, batchSize);
    }

    // Обычная параллельная обработка (для optimistic и pessimistic без батчинга)
    const results: WriteResult[] = [];
    const errors: Array<{ index: number; error: unknown }> = [];
    
    // Создаем массив задач
    const tasks = Array.from({ length: count }, (_, i) => i);
    
    // Обрабатываем задачи с ограничением параллельности
    const processBatch = async (batch: number[]): Promise<void> => {
      const batchResults = await Promise.allSettled(
        batch.map(async (index) => {
          try {
            return await this.write(options);
          } catch (error) {
            errors.push({ index, error });
            throw error;
          }
        })
      );
      
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        }
      }
    };
    
    // Разбиваем задачи на батчи
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      await processBatch(batch);
      
      // Выводим прогресс только если verbose включен
      if (options.verbose && i % (concurrency * 10) === 0) {
        console.log(`Progress: ${Math.min(i + concurrency, count)}/${count} records processed`);
      }
    }
    
    // Выводим ошибки, если они были
    if (errors.length > 0 && options.verbose) {
      console.error(`\n✗ Failed to write ${errors.length} entries out of ${count}`);
      for (const { index, error } of errors.slice(0, 10)) {
        console.error(`  Entry ${index + 1}:`, error instanceof Error ? error.message : String(error));
      }
      if (errors.length > 10) {
        console.error(`  ... and ${errors.length - 10} more errors`);
      }
    }
    
    return results;
  }

  /**
   * Пакетная запись с батчингом для pessimistic режима
   * Двухфазный подход с компенсацией:
   * 1. Фаза 1: Выполняем все саги для PostgreSQL проверок
   * 2. Фаза 2: Batch запись в Trino
   * 3. При ошибке в Фазе 2 - откатываем все саги
   */
  private async writeBatchWithBatching(
    count: number,
    options: WriteOptions = {},
    batchSize: number = 10
  ): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    const errors: Array<{ index: number; error: unknown }> = [];
    
    if (!this.sql) {
      throw new Error("PostgreSQL connection not available");
    }

    if (!this.trino) {
      throw new Error("Trino connection not available");
    }

    const verbose = options.verbose ?? false;
    
    // Собираем данные для батча
    const batch: Array<{
      registrar_type_id: string;
      registrar_id: string;
      row: number;
      amount: number;
      fakerData: ReturnType<typeof bonus_registry_faker>;
    }> = [];

    const flushBatch = async (): Promise<void> => {
      if (batch.length === 0) {
        return;
      }

      if (verbose) {
        console.log(`  📦 Processing batch of ${batch.length} items...`);
      }

      // Фаза 1: Параллельно создаем все саги
      const sagaPromises = batch.map(async (item) => {
        try {
          const sagaManager = new SagaManager(this.sql!);
          const sagaId = await sagaManager.beginSaga({
            description: `Batch write: ${item.registrar_type_id}/${item.registrar_id}/row=${item.row}`,
          });
          return {
            success: true as const,
            sagaManager,
            sagaId,
            item,
          };
        } catch (error) {
          return {
            success: false as const,
            error,
            item,
          };
        }
      });

      const sagaResults = await Promise.allSettled(sagaPromises);
      
      const successfulSagas: Array<{
        sagaManager: SagaManager;
        sagaId: string;
        item: typeof batch[0];
      }> = [];
      const failedItems: Array<{ item: typeof batch[0]; error: unknown }> = [];

      for (const result of sagaResults) {
        if (result.status === "fulfilled") {
          if (result.value.success) {
            successfulSagas.push({
              sagaManager: result.value.sagaManager,
              sagaId: result.value.sagaId,
              item: result.value.item,
            });
          } else {
            failedItems.push({
              item: result.value.item,
              error: result.value.error,
            });
          }
        } else {
          // Promise.allSettled не должен возвращать rejected, но на всякий случай
          const index = sagaResults.indexOf(result);
          if (index >= 0 && index < batch.length) {
            const item = batch[index];
            if (item) {
              failedItems.push({ item, error: result.reason });
            }
          }
        }
      }

      if (failedItems.length > 0) {
        for (const { error } of failedItems) {
          errors.push({ index: results.length, error });
          if (verbose) {
            console.error(`  ✗ Failed to create saga for item:`, error instanceof Error ? error.message : String(error));
          }
        }
      }

      if (successfulSagas.length === 0) {
        if (verbose) {
          console.warn(`  ⚠ No successful sagas in batch`);
        }
        batch.length = 0;
        return;
      }

      if (verbose) {
        console.log(`  ✓ Created ${successfulSagas.length} sagas (${failedItems.length} failed)`);
      }

      // Подготавливаем данные для batch INSERT
      const uniqueCheckValues: Array<{
        sagaId: string;
        keyFieldsHash: string;
        item: typeof batch[0];
      }> = [];
      const balanceCheckValues: Array<{
        sagaId: string;
        amount: number;
        item: typeof batch[0];
      }> = [];

      for (const { sagaId, item } of successfulSagas) {
        const keyFieldsHash = hashObject({
          registrar_type_id: item.registrar_type_id,
          registrar_id: item.registrar_id,
          row: item.row,
        });
        uniqueCheckValues.push({ sagaId, keyFieldsHash, item });
        balanceCheckValues.push({ sagaId, amount: item.amount, item });
      }

      // Выполняем batch INSERT для unique_check
      let uniqueCheckIds: string[] = [];
      try {
        if (uniqueCheckValues.length > 0) {
          const valuesList = uniqueCheckValues
            .map(
              (v) =>
                `(gen_random_uuid()::text, ${escapePostgresLiteral("registrar_unique")}, ${escapePostgresLiteral(v.keyFieldsHash)}, ${escapePostgresLiteral(v.sagaId)}, NOW())`
            )
            .join(", ");

          const batchInsertSql = `
            INSERT INTO ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} 
            (id, name_of_uniqueness, key_fields_hash, "sagaId", "createdAt")
            VALUES ${valuesList}
            RETURNING id, "sagaId"
          `;

          const uniqueCheckResult = await this.sql!.unsafe<Array<{ id: string; sagaId: string }>>(batchInsertSql);
          uniqueCheckIds = uniqueCheckResult.map((r) => r.id);

          if (verbose) {
            console.log(`  ✓ Batch inserted ${uniqueCheckIds.length} records into ${this.config.tables.uniqueCheck}`);
          }
        }
      } catch (error) {
        // Если batch INSERT не удался, откатываем все саги
        console.error(`  ✗ Failed to batch insert into ${this.config.tables.uniqueCheck}:`, error);
        const rollbackPromises = successfulSagas.map(({ sagaManager }) => sagaManager.rollbackSaga());
        await Promise.allSettled(rollbackPromises);
        errors.push({ index: results.length, error });
        batch.length = 0;
        return;
      }

      // Выполняем batch INSERT для balance_check
      // Разделяем на валидные (amount >= 0) и невалидные (amount < 0) для корректной обработки триггера
      const balanceCheckIdMap = new Map<string, string>(); // sagaId -> balanceCheckId
      
      // Разделяем на валидные и невалидные
      const validBalanceChecks: Array<{ sagaId: string; amount: number; originalIndex: number }> = [];
      const invalidBalanceChecks: Array<{ sagaId: string; amount: number; originalIndex: number }> = [];
      
      for (let i = 0; i < balanceCheckValues.length; i++) {
        const v = balanceCheckValues[i];
        if (v && v.amount >= 0) {
          validBalanceChecks.push({ sagaId: v.sagaId, amount: v.amount, originalIndex: i });
        } else if (v) {
          invalidBalanceChecks.push({ sagaId: v.sagaId, amount: v.amount, originalIndex: i });
        }
      }

      // Batch INSERT для валидных записей
      if (validBalanceChecks.length > 0) {
        try {
          const valuesList = validBalanceChecks
            .map(
              (v) =>
                `(gen_random_uuid()::text, ${String(v.amount)}::DECIMAL(20, 2), ${escapePostgresLiteral(v.sagaId)})`
            )
            .join(", ");

          const batchInsertSql = `
            INSERT INTO ${escapePostgresIdentifier(this.config.tables.balanceCheck)} 
            (id, amount, "sagaId")
            VALUES ${valuesList}
            RETURNING id, "sagaId"
          `;

          const balanceCheckResult = await this.sql!.unsafe<Array<{ id: string; sagaId: string }>>(batchInsertSql);
          
          for (const result of balanceCheckResult) {
            balanceCheckIdMap.set(result.sagaId, result.id);
          }

          if (verbose) {
            console.log(`  ✓ Batch inserted ${validBalanceChecks.length} valid records into ${this.config.tables.balanceCheck}`);
          }
        } catch (error) {
          // Если batch INSERT не удался, откатываем все саги и компенсируем unique_check
          console.error(`  ✗ Failed to batch insert valid records into ${this.config.tables.balanceCheck}:`, error);
          
          // Компенсируем unique_check записи
          if (uniqueCheckIds.length > 0) {
            const deleteIds = uniqueCheckIds.map((id) => escapePostgresLiteral(id)).join(", ");
            await this.sql!.unsafe(
              `DELETE FROM ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} WHERE id IN (${deleteIds})`
            );
          }

          // Откатываем все саги
          const rollbackPromises = successfulSagas.map(({ sagaManager }) => sagaManager.rollbackSaga());
          await Promise.allSettled(rollbackPromises);
          errors.push({ index: results.length, error });
          batch.length = 0;
          return;
        }
      }

      // Обрабатываем невалидные записи по одной (чтобы триггер мог корректно откатить только проблемные)
      const failedSagaIds: string[] = [];
      for (const invalid of invalidBalanceChecks) {
        try {
          const insertSql = `
            INSERT INTO ${escapePostgresIdentifier(this.config.tables.balanceCheck)} 
            (id, amount, "sagaId")
            VALUES (gen_random_uuid()::text, ${String(invalid.amount)}::DECIMAL(20, 2), ${escapePostgresLiteral(invalid.sagaId)})
            RETURNING id
          `;
          
          const result = await this.sql!.unsafe<Array<{ id: string }>>(insertSql);
          const insertedId = result && result.length > 0 ? result[0]?.id : null;
          
          if (insertedId) {
            balanceCheckIdMap.set(invalid.sagaId, insertedId);
          }
        } catch (error) {
          // Триггер отклонил запись - это ожидаемо для отрицательных балансов
          // Откатываем только эту сагу
          const sagaData = successfulSagas.find((s) => s.sagaId === invalid.sagaId);
          if (sagaData) {
            try {
              await sagaData.sagaManager.rollbackSaga();
              failedSagaIds.push(invalid.sagaId);
              
              // Компенсируем unique_check для этой саги
              // Находим uniqueId по sagaId из маппинга uniqueCheckValues
              const uniqueCheckValue = uniqueCheckValues.find((v) => v.sagaId === invalid.sagaId);
              if (uniqueCheckValue) {
                const uniqueCheckResult = await this.sql!.unsafe<Array<{ id: string }>>(
                  `SELECT id FROM ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} WHERE "sagaId" = ${escapePostgresLiteral(invalid.sagaId)} LIMIT 1`
                );
                const uniqueId = uniqueCheckResult && uniqueCheckResult.length > 0 ? uniqueCheckResult[0]?.id : null;
                if (uniqueId) {
                  await this.sql!.unsafe(
                    `DELETE FROM ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} WHERE id = ${escapePostgresLiteral(uniqueId)}`
                  );
                }
              }
              
              if (verbose) {
                console.log(`  ⚠ Saga ${invalid.sagaId} rolled back due to negative balance: ${invalid.amount}`);
              }
            } catch (rollbackError) {
              console.error(`  ✗ Failed to rollback saga ${invalid.sagaId}:`, rollbackError);
            }
          }
          
          errors.push({ 
            index: results.length + validBalanceChecks.length + invalidBalanceChecks.findIndex((i) => i.sagaId === invalid.sagaId), 
            error 
          });
        }
      }

      // Удаляем провалившиеся саги из списка успешных
      const remainingSagas = successfulSagas.filter((s) => !failedSagaIds.includes(s.sagaId));
      
      if (failedSagaIds.length > 0) {
        if (verbose) {
          console.log(`  ⚠ ${failedSagaIds.length} sagas failed due to negative balance, ${remainingSagas.length} remaining`);
        }
      }

      // Обновляем список успешных саг
      successfulSagas.length = 0;
      successfulSagas.push(...remainingSagas);

      // Сохраняем маппинг для компенсации
      // Используем balanceCheckIdMap для правильного маппинга (так как некоторые записи могли быть пропущены)
      const sagaToIds = new Map<string, { uniqueId: string; balanceId: string }>();
      
      // Создаем маппинг sagaId -> uniqueId
      const sagaToUniqueId = new Map<string, string>();
      for (let i = 0; i < uniqueCheckValues.length; i++) {
        const v = uniqueCheckValues[i];
        if (v && i < uniqueCheckIds.length) {
          sagaToUniqueId.set(v.sagaId, uniqueCheckIds[i]!);
        }
      }
      
      // Объединяем маппинги
      for (const [sagaId, balanceId] of balanceCheckIdMap.entries()) {
        const uniqueId = sagaToUniqueId.get(sagaId);
        if (uniqueId && balanceId) {
          sagaToIds.set(sagaId, {
            uniqueId,
            balanceId,
          });
        }
      }

      // Добавляем операции компенсации в саги
      for (const { sagaManager, sagaId } of successfulSagas) {
        const ids = sagaToIds.get(sagaId);
        if (!ids) {
          continue;
        }

        sagaManager.addOperation({
          id: "insert-unique-check",
          execute: async () => ids.uniqueId,
          compensate: async () => {
            if (!this.sql) {
              return;
            }
            await this.sql.unsafe(
              `DELETE FROM ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} WHERE id = ${escapePostgresLiteral(ids.uniqueId)}`
            );
          },
        });

        sagaManager.addOperation({
          id: "insert-balance-check",
          execute: async () => ids.balanceId,
          compensate: async () => {
            if (!this.sql) {
              return;
            }
            await this.sql.unsafe(
              `DELETE FROM ${escapePostgresIdentifier(this.config.tables.balanceCheck)} WHERE id = ${escapePostgresLiteral(ids.balanceId)}`
            );
          },
        });
      }

      // Параллельно коммитим все саги
      const commitPromises = successfulSagas.map(async ({ sagaManager, sagaId, item }) => {
        try {
          await sagaManager.commitSaga();
          return {
            success: true as const,
            sagaId,
            item,
          };
        } catch (error) {
          return {
            success: false as const,
            sagaId,
            item,
            error,
          };
        }
      });

      const commitResults = await Promise.allSettled(commitPromises);
      
      const batchResults: WriteResult[] = [];
      const trinoData: Array<BonusRegistryFakerObject & {
        registrar_type_id: string;
        registrar_id: string;
        row: number;
      }> = [];
      const sagaManagers: SagaManager[] = [];
      const sagaIds: string[] = [];

      for (const result of commitResults) {
        if (result.status === "fulfilled") {
          if (result.value.success) {
            const { sagaId, item } = result.value;
            batchResults.push({
              sagaId,
              registrar_type_id: item.registrar_type_id,
              registrar_id: item.registrar_id,
              row: item.row,
              amount: item.amount,
              optimistic: false,
            });

            trinoData.push({
              ...item.fakerData,
              registrar_type_id: item.registrar_type_id,
              registrar_id: item.registrar_id,
              row: item.row,
              amount: item.amount,
            });

            // Сохраняем для возможного отката
            const sagaData = successfulSagas.find((s) => s.sagaId === sagaId);
            if (sagaData) {
              sagaManagers.push(sagaData.sagaManager);
              sagaIds.push(sagaId);
            }
          } else {
            errors.push({ index: results.length + batchResults.length, error: result.value.error });
            if (verbose) {
              console.error(`  ✗ Failed to commit saga ${result.value.sagaId}:`, result.value.error);
            }
          }
        } else {
          errors.push({ index: results.length + batchResults.length, error: result.reason });
        }
      }

      if (verbose) {
        console.log(`  ✓ Committed ${batchResults.length} sagas (${commitResults.length - batchResults.length} failed)`);
      }

      // Фаза 2: Batch запись в Trino
      if (trinoData.length > 0) {
        try {
          if (verbose) {
            console.log(`  📦 Writing batch of ${trinoData.length} records to Trino...`);
          }
          
          // this.trino уже проверен в начале функции
          const trino = this.trino;
          if (!trino) {
            throw new Error("Trino connection not available");
          }
          
          await insertBonusRegistryBatchIntoTrino(
            trino,
            trinoData,
            {
              catalog: this.config.trino.catalog,
              schema: this.config.trino.schema,
              table: this.config.trino.table,
            }
          );
          
          if (verbose) {
            console.log(`  ✓ Batch written to Trino successfully`);
          }
          
          // Если успешно - добавляем результаты в общий массив
          results.push(...batchResults);
        } catch (error) {
          // Если запись в Trino не удалась - откатываем все успешно закоммиченные саги
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          
          console.error(`  ✗ Failed to write batch to Trino: ${errorMessage}`);
          if (errorStack && verbose) {
            console.error(`  Error stack:`, errorStack);
          }
          
          if (verbose) {
            console.log(`  🔄 Rolling back ${sagaManagers.length} committed sagas...`);
          }
          
          // Компенсируем все успешно закоммиченные саги параллельно
          const rollbackPromises = sagaManagers.map(async (sagaManager, index) => {
            const sagaId = sagaIds[index];
            if (!sagaId) {
              return;
            }
            try {
              await sagaManager.rollbackSaga();
              if (verbose) {
                console.log(`  ✓ Rolled back saga: ${sagaId}`);
              }
            } catch (rollbackError) {
              console.error(`  ✗ Failed to rollback saga ${sagaId}:`, rollbackError);
            }
          });
          
          await Promise.allSettled(rollbackPromises);
          
          // Добавляем ошибку в список, но не прерываем обработку остальных батчей
          errors.push({ index: results.length, error });
        }
      } else {
        // Если нет данных для Trino (все саги упали), все равно логируем
        if (verbose) {
          console.warn(`  ⚠ No data to write to Trino (all sagas failed)`);
        }
      }

      batch.length = 0; // Очищаем батч
    };

    // Генерируем данные и собираем в батчи
    for (let i = 0; i < count; i++) {
      const registrarObj = generateRegistrarObject();
      const amount = options.amount ?? Math.floor(Math.random() * 11001) - 1000; // -1000 до +10000
      const fakerData = bonus_registry_faker();

      batch.push({
        ...registrarObj,
        amount,
        fakerData,
      });

      // Когда батч заполнен, записываем его
      if (batch.length >= batchSize) {
        await flushBatch();
      }

      // Выводим прогресс
      if (verbose && (i + 1) % (batchSize * 10) === 0) {
        console.log(`Progress: ${i + 1}/${count} records prepared`);
      }
    }

    // Записываем оставшиеся данные
    await flushBatch();

    // Выводим ошибки, если они были
    if (errors.length > 0) {
      console.error(`\n✗ Failed to write ${errors.length} entries out of ${count}`);
      for (const { index, error } of errors.slice(0, 10)) {
        console.error(`  Entry ${index + 1}:`, error instanceof Error ? error.message : String(error));
      }
      if (errors.length > 10) {
        console.error(`  ... and ${errors.length - 10} more errors`);
      }
    }

    return results;
  }
}

