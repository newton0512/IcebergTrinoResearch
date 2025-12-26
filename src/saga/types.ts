/**
 * Статусы выполнения саги
 */
export enum SagaStatus {
  PENDING = "pending",
  COMMITTED = "committed",
  ROLLED_BACK = "rolled_back",
}

/**
 * Результат выполнения операции
 */
export interface OperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: Error;
}

/**
 * Компенсирующая операция для отката
 */
export type CompensateFunction<T = unknown> = (
  operationData: T
) => Promise<void> | void;

/**
 * Операция в саге
 */
export interface SagaOperation<T = unknown> {
  /**
   * Уникальный идентификатор операции (для логирования и отладки)
   */
  id?: string;

  /**
   * Функция выполнения операции
   */
  execute: () => Promise<T> | T;

  /**
   * Компенсирующая функция для отката операции
   */
  compensate?: CompensateFunction<T>;

  /**
   * Данные операции (сохраняются после выполнения для компенсации)
   */
  operationData?: T;
}

/**
 * Конфигурация саги
 */
export interface SagaConfig {
  /**
   * Идентификатор саги (если не указан, будет сгенерирован UUID)
   */
  id?: string;

  /**
   * Описание саги (для логирования)
   */
  description?: string;

  /**
   * Метаданные саги (дополнительная информация)
   */
  metadata?: Record<string, unknown>;
}

/**
 * Результат выполнения саги
 */
export interface SagaResult {
  /**
   * Идентификатор саги
   */
  sagaId: string;

  /**
   * Статус выполнения
   */
  status: SagaStatus;

  /**
   * Количество выполненных операций
   */
  operationsCount: number;

  /**
   * Ошибка (если была)
   */
  error?: Error;
}

