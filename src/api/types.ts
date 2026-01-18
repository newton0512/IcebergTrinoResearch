/**
 * Типы для REST API endpoints
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metrics?: {
    duration: number; // время выполнения в миллисекундах
    timestamp: string; // ISO timestamp
  };
}

export interface ReadRequest {
  id: string;
}

export interface ReadListRequest {
  limit?: number; // по умолчанию 100
  offset?: number; // по умолчанию 0
  order?: "asc" | "desc"; // по умолчанию desc (последние записи)
  orderBy?: string; // поле для сортировки, по умолчанию "date" или id
}

export interface WriteRequest {
  // Если не указано, будут сгенерированы автоматически
  registrar_type_id?: string;
  registrar_id?: string;
  row?: number;
  amount?: number; // если не указано, будет сгенерировано случайное значение от -1000 до 10000
}

export interface DeleteRequest {
  id: string;
}

export interface PostgresQueryRequest {
  query: string;
}

export interface TrinoQueryRequest {
  query: string;
}

export interface ConsistencyCheckRequest {
  // Количество записей для проверки согласованности
  count?: number; // по умолчанию 10
}

export interface AnalyticsRequest {
  type:
    | "count" // общее количество записей
    | "sum-amount" // сумма всех amount
    | "avg-amount" // среднее значение amount
    | "min-amount" // минимальное amount
    | "max-amount" // максимальное amount
    | "group-by-registrar-type" // группировка по registrar_type_id
    | "group-by-date" // группировка по дате (date)
    | "top-balances"; // топ записей по amount
  limit?: number; // для топ записей
  dateFrom?: string; // ISO date для фильтрации по дате
  dateTo?: string; // ISO date для фильтрации по дате
}

export interface ReadDelayRequest {
  // Количество повторных чтений для измерения задержки
  iterations?: number; // по умолчанию 10
  recordId?: string; // ID записи для чтения (если не указано, будет выбран случайный)
}

export interface QueueStatusResponse {
  totalRecords: number;
  oldestRecord?: {
    id: number;
    created_at: string;
  };
  newestRecord?: {
    id: number;
    created_at: string;
  };
  recordsByOperationType: Record<string, number>;
}

export interface StatsResponse {
  bonusRegistry: {
    totalRecords: number;
    estimatedSize?: string;
  };
  trinoQueue: QueueStatusResponse;
  postgresTables: {
    uniqueCheck: number;
    balanceCheck: number;
  };
}
