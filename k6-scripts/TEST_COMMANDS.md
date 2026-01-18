# Команды для запуска K6 тестов

## Быстрый запуск отдельных тестов

### 1. Прямой запрос к PostgreSQL

```bash
# Базовый запуск
pnpm run k6:run postgres-direct.js

# С параметрами
K6_VUS=50 K6_DURATION=60s bash k6-run-pipe.sh postgres-direct.js

# С сохранением результатов
bash k6-run-pipe.sh postgres-direct.js --out json=k6-results/postgres-direct.json --duration 60s --vus 50
```

**Метрики (реалистичные пороги):**
- Время ответа: p50<200ms, p90<1000ms, p95<2000ms, p99<3000ms
- RPS: ~50 запросов/секунду
- Ошибки: <1%

**Примечание:** Если порог не пройден (exit code 99), это нормально - метрики все равно собраны. См. `THRESHOLDS_INFO.md` для настройки порогов.

### 2. Запросы к Trino напрямую

```bash
# Базовый запуск
bash k6-run-pipe.sh trino-direct.js

# С параметрами (Trino медленнее, меньше VUs)
K6_VUS=20 K6_DURATION=60s bash k6-run-pipe.sh trino-direct.js

# С сохранением результатов
bash k6-run-pipe.sh trino-direct.js --out json=k6-results/trino-direct.json --duration 60s --vus 20
```

**Метрики (реалистичные пороги):**
- Время ответа: p50<1000ms, p90<5000ms, p95<10000ms, p99<20000ms
- RPS: ~10 запросов/секунду
- Ошибки: <5%

### 3. Полный цикл записи

```bash
# Базовый запуск
bash k6-run-pipe.sh write-cycle.js

# С параметрами батча
K6_WRITE_BATCH_SIZE=10 K6_WRITE_CONCURRENCY=5 K6_VUS=20 bash k6-run-pipe.sh write-cycle.js

# С сохранением результатов
bash k6-run-pipe.sh write-cycle.js --out json=k6-results/write-cycle.json --duration 90s --vus 20
```

**Метрики (реалистичные пороги):**
- Время ответа: p50<3000ms, p90<8000ms, p95<15000ms, p99<30000ms
- RPS: ~10-15 запросов/секунду
- Ошибки: <5%

### 4. Проверка согласованности (write + read с задержкой)

```bash
# Базовый запуск (медленный тест)
bash k6-run-pipe.sh consistency-check.js

# С параметрами
K6_VUS=5 K6_DURATION=75s bash k6-run-pipe.sh consistency-check.js

# С сохранением результатов
bash k6-run-pipe.sh consistency-check.js --out json=k6-results/consistency-check.json --duration 75s --vus 5
```

**Метрики (реалистичные пороги):**
- Время записи: p50<3000ms, p90<8000ms, p95<15000ms
- Задержка чтения: p50<2000ms, p90<8000ms, p95<20000ms
- Время ответа: p50<8000ms, p90<20000ms, p95<40000ms, p99<80000ms
- RPS: ~1-2 запросов/секунду (медленные)
- Ошибки: <10%

### 5. Типовые аналитические запросы

```bash
# Базовый запуск
bash k6-run-pipe.sh analytics-queries.js

# С параметрами
K6_VUS=30 K6_DURATION=90s bash k6-run-pipe.sh analytics-queries.js

# С сохранением результатов
bash k6-run-pipe.sh analytics-queries.js --out json=k6-results/analytics-queries.json --duration 90s --vus 30
```

**Метрики (реалистичные пороги):**
- Время ответа: p50<2000ms, p90<8000ms, p95<15000ms, p99<30000ms
- RPS: ~20-25 запросов/секунду
- Ошибки: <5%

### 6. Проверка задержек чтения

```bash
# Базовый запуск
bash k6-run-pipe.sh read-delay.js

# С параметрами
K6_VUS=50 K6_DURATION=90s bash k6-run-pipe.sh read-delay.js

# С сохранением результатов
bash k6-run-pipe.sh read-delay.js --out json=k6-results/read-delay.json --duration 90s --vus 50
```

**Метрики (реалистичные пороги):**
- Задержка чтения: p50<500ms, p90<2000ms, p95<4000ms, p99<10000ms
- Время ответа: p50<1000ms, p90<3000ms, p95<6000ms, p99<15000ms
- RPS: ~80-100 запросов/секунду
- Ошибки: <5%

### 7. Имитация реальной нагрузки (смешанный сценарий)

```bash
# Базовый запуск (длительный тест)
bash k6-run-pipe.sh real-load.js

# С сохранением результатов
bash k6-run-pipe.sh real-load.js --out json=k6-results/real-load.json
```

**Метрики (реалистичные пороги):**
- Время ответа: p50<2000ms, p90<8000ms, p95<15000ms, p99<40000ms
- Чтение: p90<3000ms
- Запись: p90<8000ms
- Аналитика: p90<15000ms
- RPS: ~30-40 запросов/секунду (смешанные)
- Ошибки: <5%
- Продолжительность: ~9 минут (сценарий с пиковой нагрузкой)

## Запуск всех тестов последовательно

```bash
# Запустить все тесты автоматически
bash k6-scripts/run-all.sh

# Или через npm скрипт (после добавления в package.json)
pnpm run k6:all
```

## Настройка переменных окружения

```bash
# URL API сервера
export K6_API_URL=http://host.docker.internal:3000

# Для Windows (если host.docker.internal не работает)
export K6_API_URL=http://localhost:3000

# Параметры нагрузки по умолчанию
export K6_VUS=10
export K6_DURATION=30s

# Специфичные параметры для тестов записи
export K6_WRITE_BATCH_SIZE=5
export K6_WRITE_CONCURRENCY=5
```

## Экспорт результатов

### JSON формат (для анализа)

```bash
bash k6-run-pipe.sh test-name.js --out json=k6-results/results.json
```

### CSV формат (для Excel/таблиц)

```bash
bash k6-run-pipe.sh test-name.js --out csv=k6-results/results.csv
```

### InfluxDB (если настроен)

```bash
bash k6-run-pipe.sh test-name.js --out influxdb=http://influxdb:8086/k6
```

### Параллельный запуск с разными параметрами

```bash
# В разных терминалах или через параллельные процессы
K6_VUS=10 bash k6-run-pipe.sh test.js --out json=results-vus10.json &
K6_VUS=50 bash k6-run-pipe.sh test.js --out json=results-vus50.json &
K6_VUS=100 bash k6-run-pipe.sh test.js --out json=results-vus100.json &
wait
```

## Анализ результатов

### Просмотр JSON результатов

```bash
# Установить jq (если нет)
# Windows: choco install jq
# Mac: brew install jq
# Linux: apt-get install jq

# Извлечь метрики
jq '.metrics.http_req_duration.values' k6-results/results.json

# Извлечь процентили
jq '.metrics.http_req_duration.values | {p50: .p50, p90: .p90, p95: .p95, p99: .p99}' k6-results/results.json

# Извлечь RPS
jq '.metrics.http_reqs.values.rate' k6-results/results.json

# Извлечь количество ошибок
jq '.metrics.http_req_failed.values.rate' k6-results/results.json
```

## Понимание результатов тестов

### Выходной код 99 (Thresholds crossed)

Если тест завершается с кодом 99 и сообщением "thresholds have been crossed", это **нормально**:
- Все метрики собраны и доступны в JSON/консоли
- Это означает, что некоторые пороги производительности не пройдены
- Данные все равно можно использовать для анализа

**Пример:**
```
✓ 'p(50)<200' p(50)=82.67ms
✓ 'p(90)<1000' p(90)=155.87ms
✗ 'p(99)<3000' p(99)=2.75s  # Порог не пройден, но это OK
```

**Решение:**
- Посмотрите фактические значения метрик в выводе или JSON
- Если значения приемлемы, можете скорректировать пороги или использовать `--no-thresholds`
- См. `THRESHOLDS_INFO.md` для подробной информации о настройке порогов

### Выходной код 0 (Success)

Все пороги пройдены, тест выполнен успешно.

### Выходной код 1 (Critical error)

Произошла критическая ошибка (высокий процент ошибок, проблемы с подключением и т.д.). Требует внимания.

## Типичные проблемы и решения

### Проблема: API недоступен

```bash
# Проверить доступность
curl http://host.docker.internal:3000/api/health

# Если не работает, запустить API сервер
pnpm run api:server
```

### Проблема: Высокий процент ошибок

- Уменьшить количество VUs
- Увеличить timeout в скрипте
- Проверить производительность API сервера
- Проверить доступность PostgreSQL и Trino

### Проблема: Медленные ответы

- Проверить настройки Trino (память, параллелизм)
- Проверить производительность PostgreSQL
- Оптимизировать запросы
- Уменьшить размер батчей

### Проблема: Исчерпание ресурсов

- Уменьшить количество VUs
- Увеличить интервалы между запросами (sleep)
- Оптимизировать сами тесты
- Проверить ресурсы Docker контейнеров
