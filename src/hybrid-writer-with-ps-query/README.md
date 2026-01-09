# HybridWriter with Queue

Новый вариант HybridWriter с использованием очереди `trino_queue` для пакетной отправки данных в Trino/Iceberg.

## Процесс работы

1. **Генерация данных:**
   - `generateRegistrarObject()` → запись в `bonus_registry_unique_check`
   - Генерация баланса (0-10000) → запись в `bonus_registry_balance_check`
   - `bonus_registry_faker()` → дополнение объекта
   - Запись в `trino_queue` (PostgreSQL)

2. **Обработка очереди (воркер):**
   - Каждые 2 секунды выбирает записи из `trino_queue`
   - Формирует батч-запрос к Trino/Iceberg
   - Отправляет INSERT с множественными VALUES
   - Удаляет обработанные записи

## Запуск

### 0. Создание таблиц (первый запуск)

```bash
# Через npm script
pnpm run setup:tables

# Или напрямую
pnpm tsx scripts/setup-tables.ts
```

Создает все необходимые таблицы:
- PostgreSQL: `Saga`, `bonus_registry_unique_check`, `bonus_registry_balance_check`, `trino_queue`
- Trino/Iceberg: `bonus_registry`

### 1. Воркер (обработка очереди)

```bash
# Через npm script
pnpm run queue-worker

# С настройкой интервала (5 секунд)
pnpm tsx scripts/queue-worker.ts --interval 5000

# С подробным выводом
pnpm tsx scripts/queue-worker.ts --verbose
```

### 2. Запись данных

```bash
# Через npm script (100 записей по умолчанию)
pnpm run write:queue

# Указать количество записей
pnpm tsx scripts/write-with-queue.ts 1000

# С подробным выводом
pnpm tsx scripts/write-with-queue.ts 1000 -v

# Очистить таблицы перед записью (флаг -d)
pnpm tsx scripts/write-with-queue.ts 1000 -d

# Комбинация флагов
pnpm tsx scripts/write-with-queue.ts 1000 -v -d
```

### 3. Полный процесс (два терминала)

**Терминал 1 - воркер:**
```bash
pnpm run queue-worker
```

**Терминал 2 - запись данных:**
```bash
pnpm run write:queue 1000
```

## Переменные окружения

Настройки через переменные окружения (значения по умолчанию из `utils.ts`):

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=appdb
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Trino
TRINO_HOST=localhost
TRINO_PORT=8080
TRINO_CATALOG=iceberg
TRINO_SCHEMA=warehouse
TRINO_USER=trino
TRINO_TABLE=bonus_registry
```

## Важно

- Воркер должен быть запущен до начала записи данных
- Таблицы создаются автоматически при первом подключении
- Данные накапливаются в `trino_queue` и отправляются батчами
- Целевая скорость: 200 записей/секунду
