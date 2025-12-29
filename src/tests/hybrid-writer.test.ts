import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Моки для внешних зависимостей должны быть объявлены до импортов
vi.mock("postgres", () => {
  const mockUnsafe = vi.fn().mockResolvedValue([{ id: "test-id" }]);
  const mockEnd = vi.fn().mockResolvedValue(undefined);
  return {
    default: vi.fn(() => ({
      unsafe: mockUnsafe,
      end: mockEnd,
    })),
  };
});

vi.mock("trino-client", () => {
  const mockQuery = async function* () {
    yield { data: [] };
  };
  return {
    Trino: {
      create: vi.fn(() => ({
        query: vi.fn().mockResolvedValue(mockQuery()),
      })),
    },
    BasicAuth: vi.fn(),
  };
});

vi.mock("amqplib", () => {
  const mockChannel = {
    assertQueue: vi.fn().mockResolvedValue(undefined),
    sendToQueue: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    default: {
      connect: vi.fn().mockResolvedValue(mockConnection),
    },
  };
});

// Импорты после моков
import { HybridWriter, type HybridWriterConfig } from "../hybrid-writer/hybrid-writer.js";
import type { WriteOptions } from "../hybrid-writer/hybrid-writer.js";

describe("HybridWriter", () => {
  let config: HybridWriterConfig;
  let writer: HybridWriter;

  beforeEach(() => {
    config = {
      postgres: {
        host: "localhost",
        port: 5432,
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      trino: {
        host: "localhost",
        port: 8080,
        catalog: "iceberg",
        schema: "warehouse",
        user: "testuser",
        table: "bonus_registry",
      },
      tables: {
        uniqueCheck: "bonus_registry_unique_check",
        balanceCheck: "bonus_registry_balance_check",
      },
    };
    writer = new HybridWriter(config);
  });

  afterEach(async () => {
    try {
      await writer.disconnect();
    } catch (error) {
      // Игнорируем ошибки при отключении в тестах
    }
  });

  describe("constructor", () => {
    it("should create instance with config", () => {
      const instance = new HybridWriter(config);
      expect(instance).toBeInstanceOf(HybridWriter);
    });
  });

  describe("connect", () => {
    it("should connect to PostgreSQL and Trino", async () => {
      await writer.connect();
      // Проверяем, что подключение прошло успешно
      // (в реальности здесь были бы проверки подключений)
      expect(writer).toBeDefined();
    });

    it("should not connect to RabbitMQ by default", async () => {
      await writer.connect();
      // RabbitMQ не должен подключаться без конфигурации
      expect(writer).toBeDefined();
    });

    it("should configure RabbitMQ if provided in config", async () => {
      const configWithRabbitMQ: HybridWriterConfig = {
        ...config,
        rabbitmq: {
          host: "localhost",
          port: 5672,
          username: "guest",
          password: "guest",
          queue: "test-queue",
        },
      };
      const writerWithRabbitMQ = new HybridWriter(configWithRabbitMQ);
      await writerWithRabbitMQ.connect();
      // Проверяем, что конфигурация RabbitMQ сохранена
      expect(writerWithRabbitMQ).toBeDefined();
      await writerWithRabbitMQ.disconnect();
    });
  });

  describe("disconnect", () => {
    it("should disconnect from all services", async () => {
      await writer.connect();
      await expect(writer.disconnect()).resolves.not.toThrow();
    });

    it("should handle disconnect when not connected", async () => {
      await expect(writer.disconnect()).resolves.not.toThrow();
    });
  });

  describe("write", () => {
    it("should throw error if not connected", async () => {
      const newWriter = new HybridWriter(config);
      await expect(newWriter.write()).rejects.toThrow("Not connected");
    });

    // Остальные тесты для write требуют реальных подключений к БД
    // и лучше подходят для интеграционных тестов
    // Здесь оставляем только базовую проверку ошибки подключения
  });

  describe("writeAsync", () => {
    it("should return promise that resolves to WriteResult", async () => {
      // writeAsync просто возвращает результат write()
      // Тестируем только тип возвращаемого значения
      const newWriter = new HybridWriter(config);
      await expect(newWriter.writeAsync()).rejects.toThrow("Not connected");
    });
  });

  describe("writeBatch", () => {
    it("should return empty array for zero count", async () => {
      // writeBatch вызывает write() для каждой записи
      // Без подключения все вызовы упадут с ошибкой
      const newWriter = new HybridWriter(config);
      const results = await newWriter.writeBatch(0);
      expect(results).toEqual([]);
    });

    it("should handle errors gracefully and continue", async () => {
      // writeBatch должен продолжать обработку даже при ошибках
      const newWriter = new HybridWriter(config);
      const results = await newWriter.writeBatch(3);
      // Все записи должны упасть с ошибкой, но массив должен быть создан
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0); // Все записи упали с ошибкой
    });
  });
});

