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

    // Подключение к RabbitMQ (если указан в конфиге)
    // Подключаемся заранее, чтобы избежать множественных подключений при параллельных вызовах
    if (this.config.rabbitmq) {
      // Инициализируем подключение, но не ждем его завершения
      this.rabbitmqConnectionPromise = this.ensureRabbitMQConnection();
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
      const batchSize = Number.parseInt(process.env.BATCH_SIZE || "10", 10);
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
   * Сначала выполняет все саги (PostgreSQL check tables), затем записывает батч в Trino
   */
  private async writeBatchWithBatching(
    count: number,
    options: WriteOptions = {},
    batchSize: number = 10
  ): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    const errors: Array<{ index: number; error: unknown }> = [];
    
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

      // Шаг 1: Выполняем все операции саги для батча (только PostgreSQL check tables)
      // НЕ записываем в Trino через сагу, только проверки
      const batchResults: WriteResult[] = [];
      const trinoData: Array<BonusRegistryFakerObject & {
        registrar_type_id: string;
        registrar_id: string;
        row: number;
      }> = [];
      const sagaIds: string[] = []; // Сохраняем ID саг для возможного отката
      
      if (!this.sql) {
        throw new Error("PostgreSQL connection not available");
      }
      
      for (const item of batch) {
        try {
          // Создаем отдельный экземпляр SagaManager для каждой саги
          // Это необходимо для поддержки параллельных вызовов
          const sagaManager = new SagaManager(this.sql);
          
          // Создаем сагу только для PostgreSQL проверок
          const sagaId = await sagaManager.beginSaga();
          sagaIds.push(sagaId);
          
          // Операция 1: Проверка уникальности
          const keyFieldsHash = hashObject({
            registrar_type_id: item.registrar_type_id,
            registrar_id: item.registrar_id,
            row: item.row,
          });

          sagaManager.addOperation({
            id: "insert-unique-check",
            execute: async () => {
              if (!this.sql) {
                throw new Error("PostgreSQL connection not available");
              }
              const insertSql = `
                INSERT INTO ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} 
                (id, name_of_uniqueness, key_fields_hash, "sagaId", "createdAt")
                VALUES (gen_random_uuid()::text, ${escapePostgresLiteral("registrar_unique")}, ${escapePostgresLiteral(keyFieldsHash)}, ${escapePostgresLiteral(sagaId)}, NOW())
              `;
              await this.sql.unsafe(insertSql);
              return sagaId;
            },
            compensate: async () => {
              if (!this.sql) {
                return;
              }
              const deleteSql = `DELETE FROM ${escapePostgresIdentifier(this.config.tables.uniqueCheck)} WHERE "sagaId" = ${escapePostgresLiteral(sagaId)}`;
              await this.sql.unsafe(deleteSql);
            },
          });

          // Операция 2: Проверка баланса
          sagaManager.addOperation({
            id: "insert-balance-check",
            execute: async () => {
              if (!this.sql) {
                throw new Error("PostgreSQL connection not available");
              }
              const insertSql = `
                INSERT INTO ${escapePostgresIdentifier(this.config.tables.balanceCheck)} 
                (id, amount, "sagaId")
                VALUES (gen_random_uuid()::text, ${String(item.amount)}::DECIMAL(20, 2), ${escapePostgresLiteral(sagaId)})
              `;
              await this.sql.unsafe(insertSql);
              return sagaId;
            },
            compensate: async () => {
              if (!this.sql) {
                return;
              }
              const deleteSql = `DELETE FROM ${escapePostgresIdentifier(this.config.tables.balanceCheck)} WHERE "sagaId" = ${escapePostgresLiteral(sagaId)}`;
              await this.sql.unsafe(deleteSql);
            },
          });

          // Коммитим сагу (только PostgreSQL проверки)
          await sagaManager.commitSaga();

          // Сохраняем результат и данные для Trino
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
        } catch (error) {
          errors.push({ index: results.length + batchResults.length, error });
        }
      }

      // Шаг 2: Записываем весь батч в Trino одним запросом
      if (trinoData.length > 0 && this.trino) {
        try {
          await insertBonusRegistryBatchIntoTrino(
            this.trino,
            trinoData,
            {
              catalog: this.config.trino.catalog,
              schema: this.config.trino.schema,
              table: this.config.trino.table,
            }
          );
          // Если успешно, добавляем результаты в общий массив
          results.push(...batchResults);
        } catch (error) {
          // Если запись в Trino не удалась, логируем детальную ошибку
          // Саги уже закоммичены, поэтому данные в check tables остаются для аудита
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          console.error(`Failed to write batch to Trino: ${errorMessage}`);
          if (errorStack && options.verbose) {
            console.error(`Error stack:`, errorStack);
          }
          console.warn(`⚠ ${batchResults.length} records were validated in PostgreSQL but not written to Trino`);
          if (options.verbose) {
            console.warn(`⚠ Saga IDs: ${sagaIds.join(", ")}`);
          }
          // Удаляем успешные результаты из батча, так как Trino запись не удалась
          batchResults.length = 0;
          trinoData.length = 0;
          sagaIds.length = 0; // Очищаем список ID саг
          
          // Добавляем ошибку в список, но не прерываем обработку остальных батчей
          errors.push({ index: results.length, error });
        }
      } else {
        // Если нет данных для Trino, все равно добавляем результаты
        results.push(...batchResults);
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
      if (options.verbose && (i + 1) % (batchSize * 10) === 0) {
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

