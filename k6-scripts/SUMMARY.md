# Сводка команд для запуска K6 тестов

## Все команды для запуска тестов

### 1. Прямой запрос к PostgreSQL

```bash
# Через npm скрипт
pnpm run k6:postgres

# Напрямую
bash k6-run-pipe.sh k6-scripts/postgres-direct.js

# С параметрами и сохранением результатов
K6_VUS=50 K6_DURATION=60s bash k6-run-pipe.sh k6-scripts/postgres-direct.js \
  --out json=k6-results/postgres-direct.json

# Метрики: p50<200ms, p90<1000ms, p95<2000ms, p99<3000ms, ошибки<1%
```

### 2. Запросы к Trino напрямую

```bash
# Через npm скрипт
pnpm run k6:trino

# Напрямую
bash k6-run-pipe.sh k6-scripts/trino-direct.js

# С параметрами (Trino медленнее)
K6_VUS=20 K6_DURATION=60s bash k6-run-pipe.sh k6-scripts/trino-direct.js \
  --out json=k6-results/trino-direct.json

# Метрики: p50<2000ms, p90<8000ms, p95<15000ms, p99<30000ms, ошибки<5%
```

### 3. Полный цикл записи

```bash
# Через npm скрипт
pnpm run k6:write

# Напрямую
bash k6-run-pipe.sh k6-scripts/write-cycle.js

# С параметрами батча
K6_WRITE_BATCH_SIZE=10 K6_WRITE_CONCURRENCY=5 K6_VUS=20 \
  bash k6-run-pipe.sh k6-scripts/write-cycle.js \
  --out json=k6-results/write-cycle.json

# Метрики: p50<3000ms, p90<8000ms, p95<15000ms, p99<30000ms, ошибки<5%
```

### 4. Проверка согласованности (write + read с задержкой)

```bash
# Через npm скрипт
pnpm run k6:consistency

# Напрямую (медленный тест)
bash k6-run-pipe.sh k6-scripts/consistency-check.js

# С параметрами
K6_VUS=5 K6_DURATION=75s bash k6-run-pipe.sh k6-scripts/consistency-check.js \
  --out json=k6-results/consistency-check.json

# Метрики:
# - Время записи: p50<3000ms, p90<8000ms, p95<15000ms
# - Задержка чтения: p50<2000ms, p90<8000ms, p95<20000ms
# - Общее время: p50<8000ms, p90<20000ms, p95<40000ms, p99<80000ms
# - Ошибки<10%
```

### 5. Типовые аналитические запросы

```bash
# Через npm скрипт
pnpm run k6:analytics

# Напрямую
bash k6-run-pipe.sh k6-scripts/analytics-queries.js

# С параметрами
K6_VUS=30 K6_DURATION=90s bash k6-run-pipe.sh k6-scripts/analytics-queries.js \
  --out json=k6-results/analytics-queries.json

# Метрики: p50<2000ms, p90<8000ms, p95<15000ms, p99<30000ms, ошибки<5%
```

### 6. Проверка задержек чтения

```bash
# Через npm скрипт
pnpm run k6:read-delay

# Напрямую
bash k6-run-pipe.sh k6-scripts/read-delay.js

# С параметрами
K6_VUS=50 K6_DURATION=90s bash k6-run-pipe.sh k6-scripts/read-delay.js \
  --out json=k6-results/read-delay.json

# Метрики:
# - Задержка чтения: p50<500ms, p90<2000ms, p95<4000ms, p99<10000ms
# - Время ответа: p50<1000ms, p90<3000ms, p95<6000ms, p99<15000ms
# - Ошибки<5%
```

### 7. Имитация реальной нагрузки (смешанный сценарий)

```bash
# Через npm скрипт
pnpm run k6:real-load

# Напрямую (длительный тест ~9 минут)
bash k6-run-pipe.sh k6-scripts/real-load.js \
  --out json=k6-results/real-load.json

# Метрики: p50<2000ms, p90<8000ms, p95<15000ms, p99<40000ms, ошибки<5%
# Продолжительность: ~9 минут с различными этапами нагрузки
```

### 8. Запуск всех тестов последовательно

```bash
# Через npm скрипт
pnpm run k6:all

# Напрямую
bash k6-scripts/run-all.sh

# Все результаты будут сохранены в k6-results/
```

## Метрики, собираемые автоматически

Все тесты настроены на сбор следующих метрик:

### Основные метрики (все тесты)
- **http_req_duration** - Время ответа (p50, p90, p95, p99)
- **http_reqs** - Количество запросов в секунду (RPS)
- **http_req_failed** - Количество ошибок (процент)

### Дополнительные метрики (специфичные тесты)
- **consistency_write_time** - Время записи (consistency-check)
- **consistency_read_delay** - Задержка доставки данных в Trino (consistency-check)
- **read_delay** - Задержка чтения из Trino (read-delay)
- **errors** - Кастомная метрика ошибок (Rate)

## Пороги производительности (thresholds)

Все тесты имеют настроенные пороги производительности:

### PostgreSQL
- p50 < 200ms
- p90 < 1000ms
- p95 < 2000ms
- p99 < 3000ms
- Ошибки < 1%

### Trino
- p50 < 1000ms
- p90 < 5000ms
- p95 < 10000ms
- p99 < 20000ms
- Ошибки < 5%

### Запись данных
- p50 < 3000ms
- p90 < 8000ms
- p95 < 15000ms
- p99 < 30000ms
- Ошибки < 5%

### Согласованность
- Задержка доставки: p50 < 2000ms, p90 < 8000ms, p95 < 20000ms
- Время записи: p50 < 3000ms, p90 < 8000ms, p95 < 15000ms
- Общее время: p50 < 8000ms, p90 < 20000ms, p95 < 40000ms, p99 < 80000ms
- Ошибки < 10%

### Аналитические запросы
- p50 < 2000ms
- p90 < 8000ms
- p95 < 15000ms
- p99 < 30000ms
- Ошибки < 5%

### Задержки чтения
- Задержка чтения: p50 < 500ms, p90 < 2000ms, p95 < 4000ms, p99 < 10000ms
- Время ответа: p50 < 1000ms, p90 < 3000ms, p95 < 6000ms, p99 < 15000ms
- Ошибки < 5%

## Переменные окружения

```bash
# URL API сервера
export K6_API_URL=http://host.docker.internal:3000

# Параметры нагрузки по умолчанию
export K6_VUS=10
export K6_DURATION=30s

# Специфичные параметры для тестов записи
export K6_WRITE_BATCH_SIZE=5
export K6_WRITE_CONCURRENCY=5
```

## Экспорт результатов

### JSON (для анализа)
```bash
bash k6-run-pipe.sh k6-scripts/test.js --out json=k6-results/results.json
```

### CSV (для Excel)
```bash
bash k6-run-pipe.sh k6-scripts/test.js --out csv=k6-results/results.csv
```

### InfluxDB (если настроен)
```bash
bash k6-run-pipe.sh k6-scripts/test.js --out influxdb=http://influxdb:8086/k6
```

### Несколько форматов одновременно
```bash
bash k6-run-pipe.sh k6-scripts/test.js \
  --out json=k6-results/results.json \
  --out csv=k6-results/results.csv
```

## Анализ результатов

### Просмотр основных метрик
```bash
# Установить jq (если нет)
# Windows: choco install jq
# Mac: brew install jq
# Linux: apt-get install jq

# Процентили времени ответа
jq '.metrics.http_req_duration.values | {p50, p90, p95, p99}' k6-results/results.json

# RPS (Requests Per Second)
jq '.metrics.http_reqs.values.rate' k6-results/results.json

# Процент ошибок
jq '.metrics.http_req_failed.values.rate' k6-results/results.json

# Все метрики
jq '.metrics | keys' k6-results/results.json
```

## Быстрый старт

1. Запустить API сервер:
```bash
pnpm run api:server
```

2. Проверить доступность:
```bash
curl http://localhost:3000/api/health
```

3. Запустить простой тест:
```bash
pnpm run k6:test
```

4. Запустить все тесты:
```bash
pnpm run k6:all
```

## Понимание результатов тестов

### Выходной код 99 (Thresholds crossed) - НОРМАЛЬНО

Если тест завершается с кодом 99 и сообщением "thresholds have been crossed", это **нормально**:
- ✅ Все метрики собраны и доступны в JSON/консоли
- ✅ Это означает, что некоторые пороги производительности не пройдены
- ✅ Данные все равно можно использовать для анализа

**Пример:**
```
✓ 'p(50)<200' p(50)=82.67ms  ✅ Пройдено
✓ 'p(90)<1000' p(90)=155.87ms  ✅ Пройдено
✓ 'p(95)<2000' p(95)=822.76ms  ✅ Пройдено
✗ 'p(99)<3000' p(99)=2.75s  ❌ Порог не пройден, но близко
```

**Важно:** Выходной код 99 - это **не критическая ошибка**. Это означает, что пороги не пройдены, но все метрики собраны.

**Решение:**
- Посмотрите фактические значения метрик в выводе или JSON
- Если значения приемлемы, можете скорректировать пороги или использовать `--no-thresholds`
- Всегда анализируйте фактические значения метрик, а не только выходной код

### Выходной код 0 (Success)

Все пороги пройдены, тест выполнен успешно.

### Выходной код 1 (Critical error)

Произошла критическая ошибка (высокий процент ошибок, проблемы с подключением и т.д.). Требует внимания.

## Документация

- `QUICK_START.md` - Быстрый старт
- `TEST_COMMANDS.md` - Подробные команды и примеры
- `K6_SETUP.md` - Настройка и troubleshooting
- `README.md` - Общая информация
