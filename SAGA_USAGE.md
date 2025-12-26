# Руководство по использованию модуля Saga

## Быстрый старт

### 1. Создание таблицы Saga

Перед использованием модуля необходимо создать таблицу `Saga` в PostgreSQL:

```bash
# Вариант 1: Использовать скрипт
npx tsx scripts/setup-saga-table.ts

# Вариант 2: Выполнить SQL вручную
psql -h localhost -U postgres -d appdb -f prisma/migrations/001_create_saga_table.sql
```

### 2. Базовое использование

```typescript
import postgres from "postgres";
import { SagaManager } from "./src/saga/index.js";

// Подключение к БД
const sql = postgres({
  host: "localhost",
  port: 5432,
  database: "appdb",
  username: "postgres",
  password: "postgres",
});

// Создание менеджера саг
const sagaManager = new SagaManager(sql);

// Начало саги
const sagaId = await sagaManager.beginSaga({
  description: "My saga operation",
});

// Добавление операции
sagaManager.addOperation({
  id: "my-operation",
  execute: async () => {
    // Ваша логика
    return result;
  },
  compensate: async (data) => {
    // Компенсирующая логика
  },
});

// Завершение саги
try {
  const result = await sagaManager.commitSaga();
  console.log("Saga completed:", result);
} catch (error) {
  // Автоматически вызывается rollbackSaga()
  console.error("Saga failed:", error);
}
```

### 3. Запуск примеров

```bash
# Убедитесь, что PostgreSQL запущен
pnpm compose:postgres

# Создайте таблицу Saga
npx tsx scripts/setup-saga-table.ts

# Запустите примеры
npx tsx examples/saga-example.ts
```

## Структура модуля

```
src/saga/
├── types.ts          # Типы и интерфейсы
├── saga-manager.ts   # Основной класс SagaManager
├── index.ts          # Экспорты модуля
└── README.md         # Подробная документация

examples/
└── saga-example.ts   # Примеры использования

prisma/
├── schema.prisma     # Prisma схема (опционально)
└── migrations/
    └── 001_create_saga_table.sql  # SQL миграция
```

## Основные методы

### `beginSaga(config?)`
Начинает новую сагу и создаёт запись в БД со статусом `pending`.

### `addOperation(operation)`
Добавляет одиночную операцию в сагу.

### `addBatchOperations(operations[])`
Добавляет несколько операций одновременно.

### `commitSaga()`
Выполняет все операции последовательно. При ошибке автоматически вызывает `rollbackSaga()`.

### `rollbackSaga()`
Откатывает сагу, выполняя компенсирующие операции в обратном порядке.

## Примеры сценариев

См. файл `examples/saga-example.ts` для полных примеров:
- Одиночная операция (успешный сценарий)
- Batch операций (успешный сценарий)
- Сценарий с ошибкой и откатом
- Комплексный сценарий

## Важные замечания

1. Каждый экземпляр `SagaManager` управляет одной сагой
2. Компенсирующие операции выполняются в обратном порядке
3. Ошибки компенсации логируются, но не прерывают откат остальных операций
4. Таблица `Saga` обязательна для работы модуля

