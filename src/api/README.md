# Load Testing REST API

REST API для тестирования нагрузки с использованием K6. Предоставляет endpoints для различных операций с таблицей `bonus_registry` и связанными системами.

## Запуск

```bash
# Запуск сервера
pnpm run api:server

# Запуск в режиме разработки (с автоперезагрузкой)
pnpm run api:dev
```

По умолчанию сервер запускается на порту `3000`. Можно изменить через переменную окружения:

```bash
API_PORT=8080 pnpm run api:server
```

## Endpoints

### Health Check

**GET** `/api/health`

Проверка работоспособности API.

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2024-01-10T12:00:00.000Z"
  },
  "metrics": {
    "duration": 2,
    "timestamp": "2024-01-10T12:00:00.002Z"
  }
}
```

### Чтение

#### Получить запись по ID

**GET** `/api/read/:id`

```bash
curl http://localhost:3000/api/read/550e8400-e29b-41d4-a716-446655440000
```

#### Получить список записей

**GET** `/api/list?limit=100&order=desc&orderBy=date&offset=0`

Параметры:
- `limit` (по умолчанию: 100) - количество записей
- `offset` (по умолчанию: 0) - смещение для пагинации
- `order` (по умолчанию: "desc") - порядок сортировки: "asc" или "desc"
- `orderBy` (по умолчанию: "date") - поле для сортировки

```bash
# Последние 100 записей
curl http://localhost:3000/api/list?limit=100&order=desc

# Первые 50 записей
curl http://localhost:3000/api/list?limit=50&order=asc
```

### Запись

#### Записать одну запись через hybrid-writer

**POST** `/api/write`

Записывает запись через hybrid-writer с использованием Saga (проверка уникальности, баланса, очередь trino_queue).

**Примечание:** Все данные генерируются автоматически внутри метода `write()`. Тело запроса может быть пустым или содержать параметры для совместимости (в настоящее время параметры игнорируются, но оставлены для возможного будущего расширения).

Тело запроса (опционально, можно отправить пустой объект `{}`):
```json
{}
```

```bash
curl -X POST http://localhost:3000/api/write \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Полный цикл записи с проверкой

**POST** `/api/write-full-cycle`

Записывает запись через hybrid-writer и проверяет её появление в Trino (проверка согласованности и задержки доставки).

```bash
curl -X POST http://localhost:3000/api/write-full-cycle \
  -H "Content-Type: application/json" \
  -d '{}'
```

Ответ включает:
- `writeResult` - результат записи
- `readSuccess` - успешно ли найдена запись в Trino
- `readAttempts` - количество попыток чтения
- `timings` - временные метрики (writeDuration, readDuration, totalDuration)

### Удаление

#### Удалить запись по ID

**DELETE** `/api/delete/:id`

```bash
curl -X DELETE http://localhost:3000/api/delete/550e8400-e29b-41d4-a716-446655440000
```

### Прямые запросы

#### Выполнить SQL запрос к PostgreSQL

**POST** `/api/postgres/query`

Тело запроса:
```json
{
  "query": "SELECT COUNT(*) FROM bonus_registry_unique_check"
}
```

Разрешены только: SELECT, INSERT, UPDATE, DELETE

```bash
curl -X POST http://localhost:3000/api/postgres/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT COUNT(*) as count FROM bonus_registry_unique_check"}'
```

#### Выполнить SQL запрос к Trino

**POST** `/api/trino/query`

Тело запроса:
```json
{
  "query": "SELECT COUNT(*) FROM iceberg.warehouse.bonus_registry"
}
```

Разрешены только: SELECT, INSERT, UPDATE, DELETE, SHOW, DESCRIBE, EXPLAIN

```bash
curl -X POST http://localhost:3000/api/trino/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT COUNT(*) as count FROM iceberg.warehouse.bonus_registry"}'
```

### Аналитика

#### Выполнить аналитический запрос

**GET** `/api/analytics/:type?limit=10&dateFrom=2024-01-01&dateTo=2024-12-31`

Типы аналитики:
- `count` - общее количество записей
- `sum-amount` - сумма всех amount
- `avg-amount` - среднее значение amount
- `min-amount` - минимальное amount
- `max-amount` - максимальное amount
- `group-by-registrar-type` - группировка по registrar_type_id
- `group-by-date` - группировка по дате (date)
- `top-balances` - топ записей по amount

Параметры:
- `limit` (по умолчанию: 100) - ограничение результатов
- `dateFrom` (опционально) - фильтр с даты (ISO date: "2024-01-01")
- `dateTo` (опционально) - фильтр до даты (ISO date: "2024-12-31")

```bash
# Общее количество записей
curl http://localhost:3000/api/analytics/count

# Сумма amount
curl http://localhost:3000/api/analytics/sum-amount

# Топ 10 записей по amount
curl http://localhost:3000/api/analytics/top-balances?limit=10

# Группировка по registrar_type_id за период
curl "http://localhost:3000/api/analytics/group-by-registrar-type?dateFrom=2024-01-01&dateTo=2024-12-31&limit=20"
```

### Проверка согласованности

#### Проверка согласованности данных

**POST** `/api/consistency-check?count=10`

Записывает N записей через hybrid-writer и проверяет их появление в Trino. Измеряет время доставки данных.

Параметры:
- `count` (по умолчанию: 10, максимум: 100) - количество записей для проверки

```bash
curl -X POST "http://localhost:3000/api/consistency-check?count=10"
```

Ответ включает:
- `results` - результаты для каждой записи (writeResult, foundInTrino, readDelay, error)
- `statistics` - статистика (total, found, notFound, successRate, avgReadDelay)

### Проверка задержек чтения

#### Измерение задержек чтения

**GET** `/api/read-delay?iterations=10&recordId=xxx`

Выполняет N чтений одной и той же записи для измерения задержек чтения.

Параметры:
- `iterations` (по умолчанию: 10, максимум: 100) - количество повторных чтений
- `recordId` (опционально) - ID записи для чтения (если не указано, выбирается случайная)

```bash
# Измерить задержки для случайной записи (10 итераций)
curl http://localhost:3000/api/read-delay?iterations=10

# Измерить задержки для конкретной записи (20 итераций)
curl "http://localhost:3000/api/read-delay?iterations=20&recordId=550e8400-e29b-41d4-a716-446655440000"
```

Ответ включает:
- `recordId` - ID записи
- `iterations` - количество итераций
- `readTimes` - массив времен чтения (мс)
- `statistics` - статистика (min, max, avg, median)

### Статистика

#### Получить статистику всех таблиц

**GET** `/api/stats`

Возвращает статистику:
- `bonusRegistry` - количество записей в Trino
- `trinoQueue` - статистика очереди (totalRecords, oldestRecord, newestRecord, recordsByOperationType)
- `postgresTables` - статистика PostgreSQL таблиц (uniqueCheck, balanceCheck)

```bash
curl http://localhost:3000/api/stats
```

### Статус очереди

#### Получить статус очереди trino_queue

**GET** `/api/queue/status`

Возвращает статус очереди `trino_queue` в PostgreSQL.

```bash
curl http://localhost:3000/api/queue/status
```

Ответ включает:
- `totalRecords` - общее количество записей в очереди
- `oldestRecord` - самая старая запись (id, created_at)
- `newestRecord` - самая новая запись (id, created_at)
- `recordsByOperationType` - количество записей по типам операций

## Метрики

Все endpoints возвращают метрики времени выполнения:

```json
{
  "success": true,
  "data": { ... },
  "metrics": {
    "duration": 123,  // время выполнения в миллисекундах
    "timestamp": "2024-01-10T12:00:00.123Z"  // ISO timestamp
  }
}
```

## Обработка ошибок

При ошибке ответ имеет формат:

```json
{
  "success": false,
  "error": "Описание ошибки",
  "metrics": {
    "duration": 5,
    "timestamp": "2024-01-10T12:00:00.005Z"
  }
}
```

HTTP коды ошибок:
- `400` - Bad Request (неверные параметры)
- `404` - Not Found (запись не найдена)
- `500` - Internal Server Error (ошибка сервера)

## Переменные окружения

API использует те же переменные окружения, что и остальные компоненты:

- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATABASE`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `TRINO_HOST`, `TRINO_PORT`, `TRINO_CATALOG`, `TRINO_SCHEMA`, `TRINO_USER`
- `API_PORT` - порт для API сервера (по умолчанию: 3000)

## Использование с K6

### Запуск через Docker

K6 настроен в `docker-compose.yml` и готов к использованию:

```bash
# 1. Запустить API сервер на хосте (в отдельном терминале)
pnpm run api:server

# 2. Запустить K6 тест (скрипты будут добавлены позже)
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test.js

# С параметрами виртуальных пользователей и длительности
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run --vus 50 --duration 1m /scripts/test.js

# С переменными окружения
K6_API_URL=http://host.docker.internal:3000 K6_VUS=100 docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test.js
```

### Запуск K6 локально (если установлен)

```bash
# Установка K6 (если еще не установлен)
# Windows: choco install k6
# Mac: brew install k6
# Linux: https://k6.io/docs/getting-started/installation/

# Запуск скрипта
k6 run k6-scripts/test.js --vus 10 --duration 30s
```

### Пример скрипта K6 (будет добавлен позже)

```javascript
import http from 'k6/http';
import { check } from 'k6';

const API_URL = __ENV.K6_API_URL || 'http://localhost:3000';

export const options = {
  vus: parseInt(__ENV.K6_VUS || '10'),
  duration: __ENV.K6_DURATION || '30s',
};

export default function () {
  // Запись
  const writeRes = http.post(`${API_URL}/api/write`, 
    JSON.stringify({}),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(writeRes, { 'write status 200': (r) => r.status === 200 });

  // Чтение списка
  const listRes = http.get(`${API_URL}/api/list?limit=100&order=desc`);
  check(listRes, { 'list status 200': (r) => r.status === 200 });

  // Аналитика
  const analyticsRes = http.get(`${API_URL}/api/analytics/count`);
  check(analyticsRes, { 'analytics status 200': (r) => r.status === 200 });
}
```

### Подключение к API серверу

- **Из Docker контейнера K6:** используйте `http://host.docker.internal:3000` (Windows/Mac)
- **Из локального K6:** используйте `http://localhost:3000`
- **Переменная окружения:** `K6_API_URL` (по умолчанию: `http://host.docker.internal:3000`)

**Примечание:** На Linux может потребоваться другой способ подключения (например, IP адрес хоста в Docker сети).

Подробнее см. `k6-scripts/README.md` и `k6-scripts/K6_SETUP.md`

## Проверка подключения

Перед запуском тестов убедитесь, что API сервер доступен из контейнера K6:

```bash
# Проверить доступность API из контейнера K6
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 bash -c "curl -v http://host.docker.internal:3000/api/health"
```

Если команда возвращает успешный ответ, подключение настроено правильно.

## Дополнительные операции

Для полноты покрытия тестовых сценариев реализованы:

1. ✅ Прямой запрос к PostgreSQL
2. ✅ Прямой запрос к Trino
3. ✅ Полный цикл записи с проверкой
4. ✅ Проверка согласованности (запись + чтение)
5. ✅ Типовые аналитические запросы (COUNT, SUM, AVG, MIN, MAX, GROUP BY, TOP)
6. ✅ Проверка задержек чтения
7. ✅ Статистика таблиц и очереди
8. ✅ Удаление записей

Все операции возвращают метрики времени выполнения для анализа производительности.
