import { randomUUID } from "node:crypto";
import type {
  SagaOperation,
  SagaConfig,
  SagaResult,
} from "./types.js";
import { SagaStatus as SagaStatusEnum } from "./types.js";

/**
 * Менеджер управления сагами
 * Обеспечивает транзакционность распределённых операций через паттерн Saga
 */
export class SagaManager {
  private sagaId: string | null = null;
  private operations: SagaOperation[] = [];
  private config: SagaConfig | null = null;
  private dbClient: any; // PostgreSQL клиент

  /**
   * @param dbClient - PostgreSQL клиент (например, из библиотеки 'postgres')
   */
  constructor(dbClient: any) {
    this.dbClient = dbClient;
  }

  /**
   * Начало новой саги
   * Создаёт запись в таблице Saga со статусом 'pending'
   */
  async beginSaga(config?: SagaConfig): Promise<string> {
    if (this.sagaId) {
      throw new Error(
        "Saga already started. Call commitSaga() or rollbackSaga() first."
      );
    }

    this.sagaId = config?.id || randomUUID();
    this.config = config || {};
    this.operations = [];

    // Создаём запись в БД
    await this.dbClient`
      INSERT INTO "Saga" (id, status, "createdAt", "updatedAt")
      VALUES (${this.sagaId}, ${SagaStatusEnum.PENDING}, NOW(), NOW())
    `;

    return this.sagaId;
  }

  /**
   * Добавление одиночной операции в сагу
   */
  addOperation<T>(operation: SagaOperation<T>): void {
    if (!this.sagaId) {
      throw new Error("Saga not started. Call beginSaga() first.");
    }

    if (!operation.id) {
      operation.id = randomUUID();
    }

    this.operations.push(operation);
  }

  /**
   * Добавление batch операций в сагу
   */
  addBatchOperations<T>(operations: SagaOperation<T>[]): void {
    if (!this.sagaId) {
      throw new Error("Saga not started. Call beginSaga() first.");
    }

    operations.forEach((op) => {
      if (!op.id) {
        op.id = randomUUID();
      }
    });

    this.operations.push(...operations);
  }

  /**
   * Выполнение всех операций саги
   * Выполняет операции последовательно и сохраняет результаты для возможной компенсации
   */
  private async executeOperations(): Promise<void> {
    for (let i = 0; i < this.operations.length; i++) {
      const operation = this.operations[i];
      try {
        const result = await operation.execute();
        // Сохраняем данные операции для возможной компенсации
        operation.operationData = result;
      } catch (error) {
        // Если операция упала, останавливаем выполнение
        throw error;
      }
    }
  }

  /**
   * Выполнение компенсирующих операций в обратном порядке
   */
  private async executeCompensations(): Promise<void> {
    // Выполняем компенсации в обратном порядке
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const operation = this.operations[i];
      if (operation.compensate && operation.operationData !== undefined) {
        try {
          await operation.compensate(operation.operationData);
        } catch (error) {
          // Логируем ошибку компенсации, но продолжаем откат остальных операций
          console.error(
            `Failed to compensate operation ${operation.id}:`,
            error
          );
        }
      }
    }
  }

  /**
   * Успешное завершение саги
   * Обновляет статус в БД на 'committed'
   */
  async commitSaga(): Promise<SagaResult> {
    if (!this.sagaId) {
      throw new Error("Saga not started. Call beginSaga() first.");
    }

    try {
      // Выполняем все операции
      await this.executeOperations();

      // Обновляем статус в БД
      await this.dbClient`
        UPDATE "Saga"
        SET status = ${SagaStatusEnum.COMMITTED}, "updatedAt" = NOW()
        WHERE id = ${this.sagaId}
      `;

      const result: SagaResult = {
        sagaId: this.sagaId,
        status: SagaStatusEnum.COMMITTED,
        operationsCount: this.operations.length,
      };

      // Очищаем состояние
      this.reset();

      return result;
    } catch (error) {
      // При ошибке выполняем откат
      await this.rollbackSaga();
      throw error;
    }
  }

  /**
   * Откат саги
   * Выполняет компенсирующие операции и обновляет статус в БД на 'rolled_back'
   */
  async rollbackSaga(): Promise<SagaResult> {
    if (!this.sagaId) {
      throw new Error("Saga not started. Call beginSaga() first.");
    }

    let error: Error | undefined;

    try {
      // Выполняем компенсирующие операции
      await this.executeCompensations();
    } catch (compensationError) {
      error =
        compensationError instanceof Error
          ? compensationError
          : new Error(String(compensationError));
    }

    // Обновляем статус в БД
    try {
      await this.dbClient`
        UPDATE "Saga"
        SET status = ${SagaStatusEnum.ROLLED_BACK}, "updatedAt" = NOW()
        WHERE id = ${this.sagaId}
      `;
    } catch (dbError) {
      console.error("Failed to update saga status in database:", dbError);
    }

    const result: SagaResult = {
      sagaId: this.sagaId,
      status: SagaStatusEnum.ROLLED_BACK,
      operationsCount: this.operations.length,
      error,
    };

    // Очищаем состояние
    this.reset();

    return result;
  }

  /**
   * Получение текущего идентификатора саги
   */
  getSagaId(): string | null {
    return this.sagaId;
  }

  /**
   * Получение количества операций в саге
   */
  getOperationsCount(): number {
    return this.operations.length;
  }

  /**
   * Сброс состояния саги
   */
  private reset(): void {
    this.sagaId = null;
    this.operations = [];
    this.config = null;
  }
}

