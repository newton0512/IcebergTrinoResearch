# Saga Management Module

Библиотека для управления распределёнными транзакциями через паттерн Saga.

## Описание

Модуль предоставляет механизм управления сагами (Saga pattern) для обеспечения согласованности данных в распределённых системах. Поддерживает как одиночные операции, так и batch-операции с возможностью компенсации при ошибках.

## Основные возможности

- ✅ Начало и завершение саг
- ✅ Поддержка одиночных и batch операций
- ✅ Автоматический откат с компенсирующими операциями
- ✅ Сохранение состояния в PostgreSQL
- ✅ Гибкая настройка компенсирующих методов для каждой операции
- ✅ Асинхронная поддержка

## Установка

```bash
pnpm install
```

## Настройка базы данных

1. Создайте файл `.env` с подключением к PostgreSQL:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/appdb"
```

2. Примените миграцию Prisma:
```bash
npx prisma migrate dev
```

Или создайте таблицу вручную:
```sql
CREATE TABLE "Saga" (
  id        VARCHAR(255) PRIMARY KEY,
  status    VARCHAR(50) NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);
```

## Использование

### Базовый пример

```typescript
import postgres from "postgres";
import { SagaManager } from "./src/saga/index.js";

const sql = postgres({
  host: "localhost",
  port: 5432,
  database: "appdb",
  username: "postgres",
  password: "postgres",
});

const sagaManager = new SagaManager(sql);

// Начинаем сагу
const sagaId = await sagaManager.beginSaga({
  description: "Create user operation",
});

// Добавляем операцию
sagaManager.addOperation({
  id: "create-user",
  execute: async () => {
    // Ваша логика выполнения
    return await createUser();
  },
  compensate: async (data) => {
    // Ваша логика компенсации
    await deleteUser(data);
  },
});

// Завершаем сагу
const result = await sagaManager.commitSaga();
```

### Batch операции

```typescript
const operations = [
  {
    id: "op1",
    execute: async () => { /* ... */ },
    compensate: async (data) => { /* ... */ },
  },
  {
    id: "op2",
    execute: async () => { /* ... */ },
    compensate: async (data) => { /* ... */ },
  },
];

sagaManager.addBatchOperations(operations);
await sagaManager.commitSaga();
```

### Обработка ошибок

```typescript
try {
  await sagaManager.commitSaga();
} catch (error) {
  // Автоматически вызывается rollbackSaga()
  // Все компенсирующие операции выполняются в обратном порядке
  console.error("Saga failed:", error);
}
```

## API

### `SagaManager`

#### `constructor(dbClient: any)`
Создаёт новый экземпляр менеджера саг.

**Параметры:**
- `dbClient` - PostgreSQL клиент (например, из библиотеки `postgres`)

#### `beginSaga(config?: SagaConfig): Promise<string>`
Начинает новую сагу и создаёт запись в БД.

**Параметры:**
- `config` - Опциональная конфигурация саги

**Возвращает:** Идентификатор саги

#### `addOperation<T>(operation: SagaOperation<T>): void`
Добавляет одиночную операцию в сагу.

**Параметры:**
- `operation` - Операция для выполнения

#### `addBatchOperations<T>(operations: SagaOperation<T>[]): void`
Добавляет batch операций в сагу.

**Параметры:**
- `operations` - Массив операций для выполнения

#### `commitSaga(): Promise<SagaResult>`
Выполняет все операции и завершает сагу успешно.

**Возвращает:** Результат выполнения саги

**Выбрасывает:** Ошибку при неудаче (автоматически вызывает rollback)

#### `rollbackSaga(): Promise<SagaResult>`
Откатывает сагу, выполняя компенсирующие операции.

**Возвращает:** Результат отката саги

### Типы

#### `SagaOperation<T>`
```typescript
interface SagaOperation<T> {
  id?: string;                    // Уникальный идентификатор
  execute: () => Promise<T> | T;  // Функция выполнения
  compensate?: CompensateFunction<T>; // Компенсирующая функция
  operationData?: T;              // Данные операции (заполняется автоматически)
}
```

#### `SagaConfig`
```typescript
interface SagaConfig {
  id?: string;                     // Идентификатор саги (UUID по умолчанию)
  description?: string;            // Описание для логирования
  metadata?: Record<string, unknown>; // Дополнительные метаданные
}
```

#### `SagaResult`
```typescript
interface SagaResult {
  sagaId: string;                  // Идентификатор саги
  status: SagaStatus;              // Статус выполнения
  operationsCount: number;         // Количество операций
  error?: Error;                   // Ошибка (если была)
}
```

#### `SagaStatus`
```typescript
enum SagaStatus {
  PENDING = "pending",
  COMMITTED = "committed",
  ROLLED_BACK = "rolled_back",
}
```

## Примеры

Полные примеры использования находятся в файле `examples/saga-example.ts`:

- Одиночная операция (успешный сценарий)
- Batch операций (успешный сценарий)
- Сценарий с ошибкой и откатом
- Комплексный сценарий

Запуск примеров:
```bash
npx tsx examples/saga-example.ts
```

## Важные замечания

1. **Порядок выполнения компенсаций**: Компенсирующие операции выполняются в обратном порядке относительно добавления операций.

2. **Ошибки компенсации**: Если компенсирующая операция завершается с ошибкой, она логируется, но откат остальных операций продолжается.

3. **Состояние саги**: Каждый экземпляр `SagaManager` может управлять только одной сагой одновременно. Для параллельных саг создавайте отдельные экземпляры.

4. **База данных**: Модуль требует наличия таблицы `Saga` в PostgreSQL для отслеживания состояния.

## Лицензия

MIT

