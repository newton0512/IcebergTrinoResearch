# K6 Load Testing Scripts

Эта папка содержит скрипты для нагрузочного тестирования с использованием K6.

## Структура

- `k6-scripts/` - скрипты для тестирования (будут добавлены позже)
- `k6-results/` - результаты тестирования (генерируются автоматически)

## Использование

### Вариант 1: Запуск через скрипт-обертку (рекомендуется для Windows/Git Bash)

```bash
# Из корня проекта samples-generation
# Запустить конкретный скрипт
bash k6-run-pipe.sh test.js

# С параметрами виртуальных пользователей и длительности через переменные
K6_VUS=50 K6_DURATION=1m bash k6-run-pipe.sh test.js

# С параметрами K6 напрямую
bash k6-run-pipe.sh test.js --vus 50 --duration 1m

# С переменными окружения
K6_API_URL=http://host.docker.internal:3000 K6_VUS=100 bash k6-run-pipe.sh test.js

# Через npm скрипты
pnpm run k6:test
pnpm run k6:test-health
```

**Примечание:** Скрипт `k6-run-pipe.sh` использует stdin для передачи скрипта в K6, что обходит проблемы с путями на Windows/Git Bash.

### Вариант 2: Запуск через Docker Compose (PowerShell/CMD)

Если используете PowerShell или CMD (не Git Bash), можно использовать docker-compose напрямую:

```bash
# Запустить конкретный скрипт
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test.js

# С параметрами виртуальных пользователей и длительности
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test.js --vus 50 --duration 1m
```

### Вариант 2: Запуск K6 локально (если установлен)

```bash
# Установка K6 (если еще не установлен)
# Windows: choco install k6
# Mac: brew install k6
# Linux: https://k6.io/docs/getting-started/installation/

# Запуск скрипта
k6 run k6-scripts/test.js

# С параметрами
k6 run --vus 50 --duration 1m k6-scripts/test.js
```

## Переменные окружения

- `K6_API_URL` - URL API сервера (по умолчанию: `http://host.docker.internal:3000`)
- `K6_VUS` - количество виртуальных пользователей (по умолчанию: 10)
- `K6_DURATION` - длительность теста (по умолчанию: 30s)

## Подключение к API серверу

API сервер должен быть запущен на хосте:

```bash
# В отдельном терминале
pnpm run api:server
```

Для подключения из контейнера K6 используется `host.docker.internal:3000` (Windows/Mac).
На Linux может потребоваться другая конфигурация.

### Варианты подключения

**Windows/Mac (рекомендуется):**
```bash
# Используется host.docker.internal (настроено автоматически)
K6_API_URL=http://host.docker.internal:3000 docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test.js
```

**Linux:**
Если `host.docker.internal` не работает, можно использовать:
1. IP адрес хоста в сети Docker:
   ```bash
   # Получить IP хоста
   ip addr show docker0
   
   # Использовать полученный IP (например, 172.17.0.1)
   K6_API_URL=http://172.17.0.1:3000 docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test.js
   ```

2. Добавить API сервер в docker-compose как сервис (альтернативный вариант)

**Проверка подключения:**
```bash
# Проверить доступность API из контейнера K6
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 bash -c "curl -v http://host.docker.internal:3000/api/health"
```

## Примеры скриптов

Скрипты будут добавлены позже. Базовая структура:

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: __ENV.K6_VUS || 10,
  duration: __ENV.K6_DURATION || '30s',
};

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export default function () {
  // Тест записи
  const writeRes = http.post(`${API_URL}/api/write`, 
    JSON.stringify({}),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(writeRes, { 'write status 200': (r) => r.status === 200 });

  // Тест чтения списка
  const listRes = http.get(`${API_URL}/api/list?limit=100&order=desc`);
  check(listRes, { 'list status 200': (r) => r.status === 200 });
}
```

## Результаты тестирования

Результаты будут сохраняться в папке `k6-results/` если настроен вывод в файл.

Для экспорта результатов в JSON:

```bash
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run --out json=/results/results.json /scripts/test.js
```
