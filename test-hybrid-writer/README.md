# Test Hybrid Writer

Скрипт для тестирования гибридного писателя (`HybridWriter`) с поддержкой оптимистичного и пессимистичного режимов.

## Описание

Скрипт генерирует указанное количество записей `bonus_registry` с использованием Saga паттерна:
- **Optimistic режим** (`--optimistic`): данные отправляются в RabbitMQ для асинхронной обработки воркером
- **Pessimistic режим** (по умолчанию): данные записываются напрямую в Trino/Iceberg

## Требования

1. Запущенные сервисы:
   - PostgreSQL (для Saga и check таблиц)
   - Trino (для записи в Iceberg)
   - RabbitMQ (только для optimistic режима)

2. Для optimistic режима также требуется запущенный воркер

## Установка зависимостей

```bash
pnpm install
```

## Запуск сервисов

```bash
# Запуск всех сервисов
pnpm run compose:up

# Или отдельно:
pnpm run compose:postgres
pnpm run compose:trino-fte
pnpm run compose:rabbitmq
```

## Использование

### Базовый запуск (pessimistic режим)

```bash
# Генерация 100 записей (по умолчанию)
tsx test-hybrid-writer/index.ts

# Генерация указанного количества записей
tsx test-hybrid-writer/index.ts --count 1000

# Короткая форма
tsx test-hybrid-writer/index.ts -c 500

# С verbose логированием (детальный вывод каждой операции)
tsx test-hybrid-writer/index.ts --count 100 --verbose

# С настройкой параллельности (по умолчанию 20)
CONCURRENCY=50 tsx test-hybrid-writer/index.ts --count 1000
```

### Optimistic режим (RabbitMQ)

**Важно:** Перед запуском в optimistic режиме необходимо запустить воркер!

```bash
# Терминал 1: Запуск воркера
pnpm run worker

# Терминал 2: Генерация данных
tsx test-hybrid-writer/index.ts --count 1000 --optimistic

# Короткая форма
tsx test-hybrid-writer/index.ts -c 1000 -o
```

### С переменными окружения

```bash
POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 \
POSTGRES_DB=appdb \
POSTGRES_USER=postgres \
POSTGRES_PASSWORD=postgres \
TRINO_HOST=localhost \
TRINO_PORT=8080 \
TRINO_CATALOG=iceberg \
TRINO_SCHEMA=warehouse \
TRINO_USER=trino \
TRINO_TABLE=bonus_registry \
RABBITMQ_HOST=localhost \
RABBITMQ_PORT=5672 \
RABBITMQ_USERNAME=guest \
RABBITMQ_PASSWORD=guest \
RABBITMQ_QUEUE=bonus_registry_queue \
tsx test-hybrid-writer/index.ts --count 1000 --optimistic
```

## Параметры

- `--count, -c <number>` - Количество записей для генерации (по умолчанию: 100)
- `--optimistic, -o` - Использовать optimistic режим (отправка в RabbitMQ)
- `--verbose, -v` - Включить детальное логирование (по умолчанию отключено для лучшей производительности)
- `--help, -h` - Показать справку

### Переменные окружения

- `CONCURRENCY` - Количество параллельных записей (по умолчанию: 20)
  - Рекомендуется: 20-50 для pessimistic, 50-100 для optimistic режима
  - Пример: `CONCURRENCY=50 tsx test-hybrid-writer/index.ts --count 1000`

## Примеры

### Генерация 100 записей (pessimistic)

```bash
tsx test-hybrid-writer/index.ts --count 100
```

### Генерация 1000 записей (optimistic)

```bash
# Терминал 1
pnpm run worker

# Терминал 2
tsx test-hybrid-writer/index.ts --count 1000 --optimistic
```

### Генерация 10000 записей (pessimistic)

```bash
tsx test-hybrid-writer/index.ts -c 10000
```

### Генерация 5000 записей (optimistic) с несколькими воркерами

```bash
# Терминал 1
pnpm run worker

# Терминал 2
pnpm run worker

# Терминал 3
pnpm run worker

# Терминал 4: Генерация данных
tsx test-hybrid-writer/index.ts -c 5000 -o
```

## Вывод

Скрипт выводит:
- Режим работы (optimistic/pessimistic)
- Количество записей для генерации
- Настройки подключения
- Прогресс генерации
- Статистику:
  - Общее количество записей
  - Время выполнения
  - Среднее время на запись
  - Пропускная способность (записей/сек)
  - Использование памяти
  - Количество записей по режимам

## Производительность

### Оптимизация throughput

По умолчанию скрипт использует **20 параллельных записей** для увеличения throughput. Это можно настроить:

```bash
# Увеличить параллельность до 50
CONCURRENCY=50 tsx test-hybrid-writer/index.ts --count 1000

# Для optimistic режима можно использовать больше параллельности
CONCURRENCY=100 tsx test-hybrid-writer/index.ts --count 1000 --optimistic
```

**Рекомендации по параллельности:**
- **Pessimistic режим**: 20-50 параллельных записей
- **Optimistic режим**: 50-100 параллельных записей (основная нагрузка на воркер)
- Слишком высокие значения могут перегрузить PostgreSQL или Trino

### Отключение verbose логирования

По умолчанию детальное логирование отключено для лучшей производительности. Каждый `console.log` добавляет накладные расходы. Для отладки можно включить:

```bash
tsx test-hybrid-writer/index.ts --count 100 --verbose
```

### Факторы производительности

Производительность зависит от:
- **Параллельности** (параметр `CONCURRENCY`, по умолчанию 20)
- Режима работы (optimistic обычно быстрее, так как не ждет записи в Trino)
- Нагрузки на базы данных
- Количества воркеров (для optimistic режима)
- Verbose логирования (отключено по умолчанию)

## Troubleshooting

### Ошибка подключения к PostgreSQL

Убедитесь, что PostgreSQL запущен:
```bash
pnpm run compose:postgres
```

### Ошибка подключения к Trino

Убедитесь, что Trino запущен:
```bash
pnpm run compose:trino-fte
```

### Ошибка подключения к RabbitMQ (optimistic режим)

Убедитесь, что RabbitMQ запущен:
```bash
pnpm run compose:rabbitmq
```

### Сообщения не обрабатываются (optimistic режим)

Убедитесь, что воркер запущен:
```bash
pnpm run worker
```

### Ошибка уникальности в bonus_registry_unique_check

Это нормально - означает, что Saga корректно откатывает транзакцию при нарушении уникальности.

### Ошибка баланса в bonus_registry_balance_check

Это нормально - означает, что триггер корректно блокирует отрицательные балансы, и Saga откатывает транзакцию.

