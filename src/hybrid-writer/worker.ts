import * as amqp from "amqplib";
import type { Connection, Channel, ConsumeMessage } from "amqplib";
import { Trino, BasicAuth } from "trino-client";
import { bonus_registry_faker, insertBonusRegistryIntoTrino, type BonusRegistryFakerObject } from "./utils.js";

/**
 * Интерфейс сообщения из очереди RabbitMQ
 */
interface QueueMessage {
  registrar_type_id: string;
  registrar_id: string;
  row: number;
  amount: number;
}

/**
 * Конфигурация воркера
 */
interface WorkerConfig {
  rabbitmq: {
    host: string;
    port: number;
    username: string;
    password: string;
    queue: string;
  };
  trino: {
    host: string;
    port: number;
    catalog: string;
    schema: string;
    user: string;
    table: string;
  };
}

/**
 * Воркер для обработки сообщений из RabbitMQ и записи в Trino/Iceberg
 */
export class BonusRegistryWorker {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private trino: Trino | null = null;
  private isShuttingDown = false;

  constructor(private config: WorkerConfig) {}

  /**
   * Подключение к RabbitMQ и Trino
   */
  async connect(): Promise<void> {
    // Подключение к RabbitMQ
    const rabbitmqUrl = `amqp://${this.config.rabbitmq.username}:${this.config.rabbitmq.password}@${this.config.rabbitmq.host}:${this.config.rabbitmq.port}`;
    this.connection = await amqp.connect(rabbitmqUrl);
    this.channel = await this.connection.createChannel();

    // Объявляем очередь (если не существует)
    await this.channel.assertQueue(this.config.rabbitmq.queue, {
      durable: true, // Очередь переживет перезапуск RabbitMQ
    });

    // Настраиваем prefetch для балансировки нагрузки между воркерами
    const prefetchCount = Number.parseInt(process.env.RABBITMQ_PREFETCH || "10", 10);
    await this.channel.prefetch(prefetchCount);
    console.log(`✓ RabbitMQ prefetch set to ${prefetchCount} messages`);

    console.log(`✓ Connected to RabbitMQ queue: ${this.config.rabbitmq.queue}`);

    // Подключение к Trino
    this.trino = Trino.create({
      server: `http://${this.config.trino.host}:${String(this.config.trino.port)}`,
      catalog: this.config.trino.catalog,
      schema: this.config.trino.schema,
      auth: new BasicAuth(this.config.trino.user),
    });

    console.log(`✓ Connected to Trino: ${this.config.trino.catalog}.${this.config.trino.schema}`);
  }

  /**
   * Отключение от RabbitMQ и Trino
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }

    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    this.trino = null;
    console.log("✓ Disconnected from RabbitMQ and Trino");
  }

  /**
   * Обработка одного сообщения
   */
  private async processMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.trino) {
      return;
    }

    try {
      // Парсим сообщение
      const messageData: QueueMessage = JSON.parse(msg.content.toString());
      console.log(`[${process.pid}] Processing message:`, {
        registrar_type_id: messageData.registrar_type_id,
        registrar_id: messageData.registrar_id,
        row: messageData.row,
        amount: messageData.amount,
      });

      // Генерируем объект через faker
      const fakerData = bonus_registry_faker();

      // Дополняем объект полями из сообщения
      const finalData: BonusRegistryFakerObject & {
        registrar_type_id: string;
        registrar_id: string;
        row: number;
      } = {
        ...fakerData,
        registrar_type_id: messageData.registrar_type_id,
        registrar_id: messageData.registrar_id,
        row: messageData.row,
        amount: messageData.amount, // Перезаписываем amount из сообщения
      };

      // Записываем в Trino/Iceberg
      await insertBonusRegistryIntoTrino(
        this.trino,
        finalData,
        {
          catalog: this.config.trino.catalog,
          schema: this.config.trino.schema,
          table: this.config.trino.table,
        }
      );

      // Подтверждаем обработку сообщения
      this.channel?.ack(msg);
      console.log(`[${process.pid}] ✓ Message processed successfully`);
    } catch (error) {
      console.error(`[${process.pid}] ✗ Error processing message:`, error);
      
      // Отклоняем сообщение и возвращаем в очередь (requeue: true)
      // В production можно добавить логику для dead letter queue
      this.channel?.nack(msg, false, true);
    }
  }


  /**
   * Запуск воркера для обработки сообщений
   */
  async start(): Promise<void> {
    if (!this.channel) {
      throw new Error("Not connected. Call connect() first.");
    }

    console.log(`[${process.pid}] Starting worker...`);
    console.log(`[${process.pid}] Waiting for messages in queue: ${this.config.rabbitmq.queue}`);

    // Начинаем потреблять сообщения
    await this.channel.consume(
      this.config.rabbitmq.queue,
      async (msg) => {
        if (this.isShuttingDown) {
          return;
        }
        await this.processMessage(msg);
      },
      {
        noAck: false, // Требуем явного подтверждения (ack)
      }
    );

    // Обработка сигналов для graceful shutdown
    process.on("SIGINT", async () => {
      console.log(`[${process.pid}] Received SIGINT, shutting down gracefully...`);
      await this.disconnect();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log(`[${process.pid}] Received SIGTERM, shutting down gracefully...`);
      await this.disconnect();
      process.exit(0);
    });
  }
}

/**
 * Запуск воркера из командной строки
 */
async function main() {
  const config: WorkerConfig = {
    rabbitmq: {
      host: process.env.RABBITMQ_HOST || "localhost",
      port: Number.parseInt(process.env.RABBITMQ_PORT || "5672", 10),
      username: process.env.RABBITMQ_USERNAME || "guest",
      password: process.env.RABBITMQ_PASSWORD || "guest",
      queue: process.env.RABBITMQ_QUEUE || "bonus_registry_queue",
    },
    trino: {
      host: process.env.TRINO_HOST || "localhost",
      port: Number.parseInt(process.env.TRINO_PORT || "8080", 10),
      catalog: process.env.TRINO_CATALOG || "iceberg",
      schema: process.env.TRINO_SCHEMA || "warehouse",
      user: process.env.TRINO_USER || "trino",
      table: process.env.TRINO_TABLE || "bonus_registry",
    },
  };

  const worker = new BonusRegistryWorker(config);

  try {
    await worker.connect();
    await worker.start();
    
    // Держим процесс живым
    console.log(`[${process.pid}] Worker is running. Press Ctrl+C to stop.`);
  } catch (error) {
    console.error(`[${process.pid}] Failed to start worker:`, error);
    await worker.disconnect();
    process.exit(1);
  }
}

// Запускаем только если файл выполняется напрямую
// Проверяем, что файл запущен напрямую, а не импортирован
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("worker.ts") || 
  process.argv[1].endsWith("worker.js")
);

if (isMainModule) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}

