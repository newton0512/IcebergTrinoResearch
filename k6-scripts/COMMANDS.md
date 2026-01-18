# Команды для запуска K6 тестов - Итоговая сводка

## Быстрые команды (через npm скрипты)

```bash
# 1. Прямой запрос к PostgreSQL
pnpm run k6:postgres

# 2. Запросы к Trino напрямую
pnpm run k6:trino

# 3. Полный цикл записи
pnpm run k6:write

# 4. Проверка согласованности (write + read с задержкой)
pnpm run k6:consistency

# 5. Типовые аналитические запросы
pnpm run k6:analytics

# 6. Проверка задержек чтения
pnpm run k6:read-delay

# 7. Имитация реальной нагрузки (смешанный сценарий)
pnpm run k6:real-load

# 8. Запуск всех тестов последовательно
pnpm run k6:all
```

## Детальные команды с параметрами

### 1. Прямой запрос к PostgreSQL

```bash
# Базовый запуск
bash k6-run-pipe.sh k6-scripts/postgres-direct.js

# С параметрами нагрузки
K6_VUS=50 K6_DURATION=60s bash k6-run-pipe.sh k6-scripts/postgres-direct.js

# С сохранением результатов в JSON
bash k6-run-pipe.sh k6-scripts/postgres-direct.js \
  --out json=k6-results/postgres-direct.json \
  --duration 60s \
  --vus 50

# С сохранением в несколько форматов
bash k6-run-pipe.sh k6-scripts/postgres-direct.js \
  --out json=k6-results/postgres.json \
  --out csv=k6-results/postgres.csv
```

**Метрики (пороги):**
- Время ответа: p50<200ms, p90<1000ms, p95<2000ms, p99<3000ms
- RPS: ~50 запросов/секунду
- Ошибки: <1%

### 2. Запросы к Trino напрямую

```bash
# Базовый запуск (Trino медленнее, меньше VUs)
bash k6-run-pipe.sh k6-scripts/trino-direct.js

# С параметрами
K6_VUS=20 K6_DURATION=60s bash k6-run-pipe.sh k6-scripts/trino-direct.js

# С сохранением результатов
bash k6-run-pipe.sh k6-scripts/trino-direct.js \
  --out json=k6-results/trino-direct.json \
  --duration 60s \
  --vus 20
```

**Метрики (пороги):**
- Время ответа: p50<1000ms, p90<5000ms, p95<10000ms, p99<20000ms
- RPS: ~10 запросов/секунду
- Ошибки: <5%

### 3. Полный цикл записи

```bash
# Базовый запуск
bash k6-run-pipe.sh k6-scripts/write-cycle.js

# С параметрами батча
K6_WRITE_BATCH_SIZE=10 K6_WRITE_CONCURRENCY=5 \
  bash k6-run-pipe.sh k6-scripts/write-cycle.js

# С настройкой нагрузки и сохранением
K6_WRITE_BATCH_SIZE=10 K6_WRITE_CONCURRENCY=5 K6_VUS=20 \
  bash k6-run-pipe.sh k6-scripts/write-cycle.js \
  --out json=k6-results/write-cycle.json \
  --duration 90s \
  --vus 20
```

**Метрики (пороги):**
- Время ответа: p50<3000ms, p90<8000ms, p95<15000ms, p99<30000ms
- RPS: ~10-15 запросов/секунду
- Ошибки: <5%

### 4. Проверка согласованности (write + read с задержкой)

```bash
# Базовый запуск (медленный тест)
bash k6-run-pipe.sh k6-scripts/consistency-check.js

# С параметрами
K6_VUS=5 K6_DURATION=75s bash k6-run-pipe.sh k6-scripts/consistency-check.js

# С сохранением результатов
bash k6-run-pipe.sh k6-scripts/consistency-check.js \
  --out json=k6-results/consistency-check.json \
  --duration 75s \
  --vus 5
```

**Метрики (пороги):**
- Время записи: p50<3000ms, p90<8000ms, p95<15000ms
- Задержка чтения: p50<2000ms, p90<8000ms, p95<20000ms
- Общее время: p50<8000ms, p90<20000ms, p95<40000ms, p99<80000ms
- RPS: ~1-2 запросов/секунду (медленные)
- Ошибки: <10%

### 5. Типовые аналитические запросы

```bash
# Базовый запуск
bash k6-run-pipe.sh k6-scripts/analytics-queries.js

# С параметрами
K6_VUS=30 K6_DURATION=90s bash k6-run-pipe.sh k6-scripts/analytics-queries.js

# С сохранением результатов
bash k6-run-pipe.sh k6-scripts/analytics-queries.js \
  --out json=k6-results/analytics-queries.json \
  --duration 90s \
  --vus 30
```

**Метрики (пороги):**
- Время ответа: p50<2000ms, p90<8000ms, p95<15000ms, p99<30000ms
- RPS: ~20-25 запросов/секунду
- Ошибки: <5%

### 6. Проверка задержек чтения

```bash
# Базовый запуск
bash k6-run-pipe.sh k6-scripts/read-delay.js

# С параметрами
K6_VUS=50 K6_DURATION=90s bash k6-run-pipe.sh k6-scripts/read-delay.js

# С сохранением результатов
bash k6-run-pipe.sh k6-scripts/read-delay.js \
  --out json=k6-results/read-delay.json \
  --duration 90s \
  --vus 50
```

**Метрики (пороги):**
- Задержка чтения: p50<500ms, p90<2000ms, p95<4000ms, p99<10000ms
- Время ответа: p50<1000ms, p90<3000ms, p95<6000ms, p99<15000ms
- RPS: ~80-100 запросов/секунду
- Ошибки: <5%

### 7. Имитация реальной нагрузки (смешанный сценарий)

```bash
# Базовый запуск (длительный тест ~9 минут)
bash k6-run-pipe.sh k6-scripts/real-load.js

# С сохранением результатов
bash k6-run-pipe.sh k6-scripts/real-load.js \
  --out json=k6-results/real-load.json
```

**Метрики (пороги):**
- Время ответа: p50<2000ms, p90<8000ms, p95<15000ms, p99<40000ms
- Чтение: p90<3000ms
- Запись: p90<8000ms
- Аналитика: p90<15000ms
- RPS: ~30-40 запросов/секунду (смешанные)
- Ошибки: <5%
- Продолжительность: ~9 минут (сценарий с пиковой нагрузкой)

## Собираемые метрики

### Основные метрики (все тесты)
- **http_req_duration** - Время ответа (p50, p90, p95, p99)
- **http_reqs** - Количество запросов в секунду (RPS)
- **http_req_failed** - Количество ошибок (процент)

### Дополнительные метрики (специфичные тесты)
- **consistency_write_time** - Время записи (consistency-check)
- **consistency_read_delay** - Задержка доставки данных в Trino (consistency-check)
- **read_delay** - Задержка чтения из Trino (read-delay)
- **errors** - Кастомная метрика ошибок (Rate)

## Понимание результатов

### Выходной код 99 (Thresholds crossed) - НОРМАЛЬНО

**Важно:** Если тест завершается с кодом 99 и сообщением "thresholds have been crossed", это **нормально**:
- ✅ Все метрики собраны и доступны в JSON/консоли
- ✅ Это означает, что некоторые пороги производительности не пройдены
- ✅ Данные все равно можно использовать для анализа

**Пример:**
```
✓ 'p(50)<200' p(50)=82.67ms  ✅ Пройдено
✓ 'p(90)<1000' p(90)=155.87ms  ✅ Пройдено
✓ 'p(95)<2000' p(95)=822.76ms  ✅ Пройдено
✗ 'p(99)<3000' p(99)=2.75s  ❌ Порог не пройден (но это OK)
```

**Что делать:**
- Посмотрите фактические значения метрик в выводе или JSON
- Если значения приемлемы, можете скорректировать пороги или использовать `--no-thresholds`
- Всегда анализируйте фактические значения метрик, а не только выходной код

### Выходной код 0 (Success)
Все пороги пройдены, тест выполнен успешно.

### Выходной код 1 (Critical error)
Произошла критическая ошибка (высокий процент ошибок, проблемы с подключением и т.д.). Требует внимания.

## Запуск без проверки порогов (только сбор метрик)

Если нужно только собрать метрики без проверки порогов:

```bash
# Отключить проверку порогов
bash k6-run-pipe.sh k6-scripts/postgres-direct.js --no-thresholds \
  --out json=k6-results/postgres-baseline.json
```

## Анализ результатов

### Просмотр метрик из JSON

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

## Полная документация

- `SUMMARY.md` - Полная сводка команд и метрик
- `QUICK_START.md` - Быстрый старт с примерами
- `TEST_COMMANDS.md` - Подробные команды и примеры
- `THRESHOLDS_INFO.md` - Информация о порогах производительности
- `K6_SETUP.md` - Настройка и troubleshooting
- `README.md` - Общая информация о K6 тестах
