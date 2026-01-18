# Быстрый старт K6 тестов

## Предварительные требования

1. API сервер должен быть запущен:
```bash
pnpm run api:server
```

2. Проверить доступность API:
```bash
curl http://localhost:3000/api/health
```

## Быстрые команды для запуска тестов

### Через npm скрипты (рекомендуется)

```bash
# 1. Прямой запрос к PostgreSQL
pnpm run k6:postgres

# 2. Запросы к Trino напрямую
pnpm run k6:trino

# 3. Полный цикл записи
pnpm run k6:write

# 4. Проверка согласованности
pnpm run k6:consistency

# 5. Аналитические запросы
pnpm run k6:analytics

# 6. Проверка задержек чтения
pnpm run k6:read-delay

# 7. Имитация реальной нагрузки
pnpm run k6:real-load

# 8. Запуск всех тестов последовательно
pnpm run k6:all
```

### Через скрипт-обертку напрямую

```bash
# Базовая команда
bash k6-run-pipe.sh k6-scripts/<test-name>.js

# С параметрами
K6_VUS=50 K6_DURATION=60s bash k6-run-pipe.sh k6-scripts/postgres-direct.js

# С сохранением результатов
bash k6-run-pipe.sh k6-scripts/postgres-direct.js --out json=k6-results/postgres.json
```

## Метрики, которые собираются автоматически

Все тесты настроены на сбор следующих метрик:

### Основные метрики (все тесты)
- **Время ответа:** p50, p90, p95, p99
- **RPS (Requests Per Second):** количество запросов в секунду
- **Ошибки:** процент неуспешных запросов

### Дополнительные метрики (специфичные тесты)
- **consistency-check:** время записи, задержка доставки данных в Trino
- **read-delay:** задержка чтения из Trino
- **write-cycle:** время выполнения цикла записи

## Примеры запуска с настройкой параметров

```bash
# PostgreSQL тест с высокой нагрузкой
K6_VUS=100 K6_DURATION=2m bash k6-run-pipe.sh k6-scripts/postgres-direct.js \
  --out json=k6-results/postgres-high-load.json

# Trino тест с сохранением результатов
K6_VUS=30 K6_DURATION=90s bash k6-run-pipe.sh k6-scripts/trino-direct.js \
  --out json=k6-results/trino.json \
  --out csv=k6-results/trino.csv

# Тест записи с настройкой батчей
K6_WRITE_BATCH_SIZE=10 K6_WRITE_CONCURRENCY=5 \
  bash k6-run-pipe.sh k6-scripts/write-cycle.js \
  --out json=k6-results/write-cycle.json

# Consistency тест (медленный)
K6_VUS=5 K6_DURATION=3m bash k6-run-pipe.sh k6-scripts/consistency-check.js \
  --out json=k6-results/consistency.json

# Аналитические запросы
K6_VUS=40 K6_DURATION=2m bash k6-run-pipe.sh k6-scripts/analytics-queries.js \
  --out json=k6-results/analytics.json

# Проверка задержек чтения
K6_VUS=100 K6_DURATION=2m bash k6-run-pipe.sh k6-scripts/read-delay.js \
  --out json=k6-results/read-delay.json

# Реальная нагрузка (длительный тест ~9 минут)
bash k6-run-pipe.sh k6-scripts/real-load.js \
  --out json=k6-results/real-load.json
```

## Просмотр результатов

### В консоли во время выполнения
K6 автоматически выводит статистику в консоль во время выполнения теста.

### Из JSON файла (после завершения)

```bash
# Установить jq (если нет)
# Windows: choco install jq
# Mac: brew install jq

# Просмотр основных метрик
jq '.metrics.http_req_duration.values | {p50, p90, p95, p99}' k6-results/results.json

# Просмотр RPS
jq '.metrics.http_reqs.values.rate' k6-results/results.json

# Просмотр процента ошибок
jq '.metrics.http_req_failed.values.rate' k6-results/results.json

# Просмотр всех метрик
jq '.metrics | keys' k6-results/results.json
```

## Типичные пороги производительности

### PostgreSQL запросы
- p50 < 200ms
- p90 < 1000ms
- p95 < 2000ms
- p99 < 3000ms
- Ошибки < 1%

### Trino запросы
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

### Проверка согласованности
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

## Советы по оптимизации

1. **Начните с малой нагрузки:** запустите тесты с небольшим количеством VUs и постепенно увеличивайте
2. **Мониторьте ресурсы:** следите за использованием CPU, памяти, диска во время тестов
3. **Проверяйте логи:** при высоком проценте ошибок проверьте логи API сервера и базы данных
4. **Оптимизируйте постепенно:** начните с простых тестов, затем переходите к сложным
5. **Сохраняйте результаты:** всегда сохраняйте результаты в JSON для последующего анализа

## Полная документация

Для подробной документации см.:
- `TEST_COMMANDS.md` - подробные команды и примеры
- `K6_SETUP.md` - настройка и troubleshooting
- `README.md` - общая информация о K6 тестах
