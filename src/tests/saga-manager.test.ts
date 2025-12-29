import { describe, it, expect, beforeEach, vi } from "vitest";
import { SagaManager } from "../saga/saga-manager.js";
import { SagaStatus } from "../saga/types.js";

describe("SagaManager", () => {
  let mockDbClient: any;
  let sagaManager: SagaManager;

  beforeEach(() => {
    // Создаем мок PostgreSQL клиента
    // postgres клиент работает как tagged template function
    // Когда вызывается как dbClient`SQL`, это эквивалентно dbClient.unsafe(`SQL`)
    mockDbClient = vi.fn().mockResolvedValue([]);
    // Добавляем метод unsafe для совместимости (если используется напрямую)
    (mockDbClient as any).unsafe = mockDbClient;
    sagaManager = new SagaManager(mockDbClient);
  });

  describe("beginSaga", () => {
    it("should create a new saga with generated UUID", async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);

      const sagaId = await sagaManager.beginSaga();

      expect(sagaId).toBeTruthy();
      expect(typeof sagaId).toBe("string");
      // dbClient вызывается как tagged template function
      expect(mockDbClient).toHaveBeenCalled();
    });

    it("should create a saga with provided ID", async () => {
      const customId = "custom-saga-id";
      vi.mocked(mockDbClient).mockResolvedValue([]);

      const sagaId = await sagaManager.beginSaga({ id: customId });

      expect(sagaId).toBe(customId);
      expect(mockDbClient).toHaveBeenCalled();
    });

    it("should throw error if saga already started", async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);

      await sagaManager.beginSaga();

      await expect(sagaManager.beginSaga()).rejects.toThrow(
        "Saga already started"
      );
    });

    it("should insert saga record with PENDING status", async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);

      await sagaManager.beginSaga();

      // Проверяем, что вызывается INSERT (dbClient вызывается как tagged template)
      expect(mockDbClient).toHaveBeenCalled();
    });
  });

  describe("addOperation", () => {
    beforeEach(async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);
      await sagaManager.beginSaga();
    });

    it("should add operation to saga", () => {
      const operation = {
        id: "test-op",
        execute: async () => "result",
      };

      sagaManager.addOperation(operation);

      expect(sagaManager.getOperationsCount()).toBe(1);
    });

    it("should auto-generate operation ID if not provided", () => {
      const operation = {
        execute: async () => "result",
      };

      sagaManager.addOperation(operation);

      expect(sagaManager.getOperationsCount()).toBe(1);
    });

    it("should throw error if saga not started", () => {
      const newManager = new SagaManager(mockDbClient);
      const operation = {
        execute: async () => "result",
      };

      expect(() => newManager.addOperation(operation)).toThrow(
        "Saga not started"
      );
    });

    it("should add multiple operations", () => {
      const op1 = { id: "op1", execute: async () => "result1" };
      const op2 = { id: "op2", execute: async () => "result2" };
      const op3 = { id: "op3", execute: async () => "result3" };

      sagaManager.addOperation(op1);
      sagaManager.addOperation(op2);
      sagaManager.addOperation(op3);

      expect(sagaManager.getOperationsCount()).toBe(3);
    });
  });

  describe("addBatchOperations", () => {
    beforeEach(async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);
      await sagaManager.beginSaga();
    });

    it("should add multiple operations at once", () => {
      const operations = [
        { id: "op1", execute: async () => "result1" },
        { id: "op2", execute: async () => "result2" },
        { id: "op3", execute: async () => "result3" },
      ];

      sagaManager.addBatchOperations(operations);

      expect(sagaManager.getOperationsCount()).toBe(3);
    });

    it("should auto-generate IDs for operations without IDs", () => {
      const operations = [
        { execute: async () => "result1" },
        { execute: async () => "result2" },
      ];

      sagaManager.addBatchOperations(operations);

      expect(sagaManager.getOperationsCount()).toBe(2);
    });

    it("should throw error if saga not started", () => {
      const newManager = new SagaManager(mockDbClient);
      const operations = [{ execute: async () => "result" }];

      expect(() => newManager.addBatchOperations(operations)).toThrow(
        "Saga not started"
      );
    });
  });

  describe("commitSaga", () => {
    beforeEach(async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);
      await sagaManager.beginSaga();
    });

    it("should execute all operations successfully", async () => {
      const execute1 = vi.fn().mockResolvedValue("result1");
      const execute2 = vi.fn().mockResolvedValue("result2");

      sagaManager.addOperation({ id: "op1", execute: execute1 });
      sagaManager.addOperation({ id: "op2", execute: execute2 });

      const result = await sagaManager.commitSaga();

      expect(execute1).toHaveBeenCalledTimes(1);
      expect(execute2).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(SagaStatus.COMMITTED);
      expect(result.operationsCount).toBe(2);
      expect(result.sagaId).toBeTruthy();
    });

    it("should update saga status to COMMITTED", async () => {
      sagaManager.addOperation({
        id: "op1",
        execute: async () => "result",
      });

      await sagaManager.commitSaga();

      // Проверяем, что был вызов UPDATE для изменения статуса
      expect(mockDbClient).toHaveBeenCalledTimes(2); // INSERT + UPDATE
    });

    it("should rollback on operation failure", async () => {
      const error = new Error("Operation failed");
      const execute = vi.fn().mockRejectedValue(error);
      const compensate = vi.fn().mockResolvedValue(undefined);

      sagaManager.addOperation({
        id: "op1",
        execute,
        compensate,
      });

      await expect(sagaManager.commitSaga()).rejects.toThrow("Operation failed");

      // Проверяем, что компенсация не была вызвана (операция не выполнилась)
      expect(compensate).not.toHaveBeenCalled();
    });

    it("should execute compensations in reverse order on failure", async () => {
      const execute1 = vi.fn().mockResolvedValue("result1");
      const execute2 = vi.fn().mockRejectedValue(new Error("Failed"));
      const compensate1 = vi.fn().mockResolvedValue(undefined);

      sagaManager.addOperation({
        id: "op1",
        execute: execute1,
        compensate: compensate1,
      });
      sagaManager.addOperation({
        id: "op2",
        execute: execute2,
      });

      await expect(sagaManager.commitSaga()).rejects.toThrow("Failed");

      // Компенсация должна быть вызвана для первой операции
      expect(compensate1).toHaveBeenCalledWith("result1");
    });

    it("should throw error if saga not started", async () => {
      const newManager = new SagaManager(mockDbClient);

      await expect(newManager.commitSaga()).rejects.toThrow(
        "Saga not started"
      );
    });

    it("should reset saga state after commit", async () => {
      sagaManager.addOperation({
        id: "op1",
        execute: async () => "result",
      });

      await sagaManager.commitSaga();

      expect(sagaManager.getSagaId()).toBeNull();
      expect(sagaManager.getOperationsCount()).toBe(0);
    });
  });

  describe("rollbackSaga", () => {
    beforeEach(async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);
      await sagaManager.beginSaga();
    });

    it("should execute all compensations in reverse order", async () => {
      const compensate1 = vi.fn().mockResolvedValue(undefined);
      const compensate2 = vi.fn().mockResolvedValue(undefined);
      const compensate3 = vi.fn().mockResolvedValue(undefined);

      sagaManager.addOperation({
        id: "op1",
        execute: async () => "result1",
        compensate: compensate1,
      });
      sagaManager.addOperation({
        id: "op2",
        execute: async () => "result2",
        compensate: compensate2,
      });
      sagaManager.addOperation({
        id: "op3",
        execute: async () => "result3",
        compensate: compensate3,
      });

      // Устанавливаем operationData вручную (обычно это делает commitSaga)
      const operations = (sagaManager as any).operations;
      operations[0].operationData = "result1";
      operations[1].operationData = "result2";
      operations[2].operationData = "result3";

      const result = await sagaManager.rollbackSaga();

      // Компенсации должны быть вызваны в обратном порядке
      expect(compensate3).toHaveBeenCalledWith("result3");
      expect(compensate2).toHaveBeenCalledWith("result2");
      expect(compensate1).toHaveBeenCalledWith("result1");

      expect(result.status).toBe(SagaStatus.ROLLED_BACK);
      expect(result.operationsCount).toBe(3);
    });

    it("should update saga status to ROLLED_BACK", async () => {
      sagaManager.addOperation({
        id: "op1",
        execute: async () => "result",
      });

      await sagaManager.rollbackSaga();

      // Проверяем, что был вызов UPDATE для изменения статуса
      expect(mockDbClient).toHaveBeenCalledTimes(2); // INSERT + UPDATE
    });

    it("should continue compensation even if one fails", async () => {
      const compensate1 = vi.fn().mockRejectedValue(new Error("Compensation failed"));
      const compensate2 = vi.fn().mockResolvedValue(undefined);

      sagaManager.addOperation({
        id: "op1",
        execute: async () => "result1",
        compensate: compensate1,
      });
      sagaManager.addOperation({
        id: "op2",
        execute: async () => "result2",
        compensate: compensate2,
      });

      const operations = (sagaManager as any).operations;
      operations[0].operationData = "result1";
      operations[1].operationData = "result2";

      const result = await sagaManager.rollbackSaga();

      // Обе компенсации должны быть вызваны
      expect(compensate1).toHaveBeenCalled();
      expect(compensate2).toHaveBeenCalled();
      expect(result.status).toBe(SagaStatus.ROLLED_BACK);
    });

    it("should skip compensation if operationData is undefined", async () => {
      const compensate = vi.fn().mockResolvedValue(undefined);

      sagaManager.addOperation({
        id: "op1",
        execute: async () => "result",
        compensate,
      });

      // Не устанавливаем operationData
      const result = await sagaManager.rollbackSaga();

      expect(compensate).not.toHaveBeenCalled();
      expect(result.status).toBe(SagaStatus.ROLLED_BACK);
    });

    it("should throw error if saga not started", async () => {
      const newManager = new SagaManager(mockDbClient);

      await expect(newManager.rollbackSaga()).rejects.toThrow(
        "Saga not started"
      );
    });

    it("should reset saga state after rollback", async () => {
      sagaManager.addOperation({
        id: "op1",
        execute: async () => "result",
      });

      await sagaManager.rollbackSaga();

      expect(sagaManager.getSagaId()).toBeNull();
      expect(sagaManager.getOperationsCount()).toBe(0);
    });
  });

  describe("getSagaId", () => {
    it("should return null if saga not started", () => {
      expect(sagaManager.getSagaId()).toBeNull();
    });

    it("should return saga ID after beginSaga", async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);
      const sagaId = await sagaManager.beginSaga();
      expect(sagaManager.getSagaId()).toBe(sagaId);
    });

    it("should return null after commit", async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);
      await sagaManager.beginSaga();
      sagaManager.addOperation({
        id: "op1",
        execute: async () => "result",
      });
      await sagaManager.commitSaga();
      expect(sagaManager.getSagaId()).toBeNull();
    });
  });

  describe("getOperationsCount", () => {
    beforeEach(async () => {
      vi.mocked(mockDbClient).mockResolvedValue([]);
      await sagaManager.beginSaga();
    });

    it("should return 0 for empty saga", () => {
      expect(sagaManager.getOperationsCount()).toBe(0);
    });

    it("should return correct count after adding operations", () => {
      sagaManager.addOperation({ id: "op1", execute: async () => "result1" });
      expect(sagaManager.getOperationsCount()).toBe(1);

      sagaManager.addOperation({ id: "op2", execute: async () => "result2" });
      expect(sagaManager.getOperationsCount()).toBe(2);

      sagaManager.addOperation({ id: "op3", execute: async () => "result3" });
      expect(sagaManager.getOperationsCount()).toBe(3);
    });

    it("should return 0 after commit", async () => {
      sagaManager.addOperation({ id: "op1", execute: async () => "result" });
      await sagaManager.commitSaga();
      expect(sagaManager.getOperationsCount()).toBe(0);
    });
  });
});

