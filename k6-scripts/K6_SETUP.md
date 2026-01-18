# K6 Setup Instructions

## Конфигурация

K6 настроен в `docker-compose.yml` и использует официальный образ `grafana/k6:latest`.

## Быстрый старт

### 1. Запустить API сервер

В отдельном терминале:

```bash
# Из корня проекта samples-generation
pnpm run api:server
```

API сервер будет доступен на `http://localhost:3000`.

### 2. Запустить K6 тест

**ВАЖНО на Windows/Git Bash:** Используйте скрипт-обертку для правильной работы с путями:

```bash
# Из корня проекта samples-generation
# Простой тест подключения
pnpm run k6:test

# Или через скрипт-обертку:
bash k6-run-pipe.sh test-simple.js

# Тест health endpoint
pnpm run k6:test-health
# или
bash k6-run-pipe.sh test-health.js

# С параметрами через переменные окружения
K6_VUS=50 K6_DURATION=1m bash k6-run-pipe.sh test-health.js

# С параметрами K6 напрямую
bash k6-run-pipe.sh test-health.js --vus 50 --duration 1m
```

**Примечание:** Скрипт `k6-run-pipe.sh` использует stdin для передачи скрипта в K6, что обходит проблемы с путями на Windows/Git Bash. Если хотите использовать docker-compose напрямую, рекомендуется использовать PowerShell или CMD вместо Git Bash.

### 3. Через npm скрипты (после создания скриптов)

```bash
# Базовый запуск
pnpm run k6:run run /scripts/test.js

# С параметрами
pnpm run k6:run run --vus 50 --duration 1m /scripts/test.js
```

## Переменные окружения

K6 контейнер получает следующие переменные окружения:

- `K6_API_URL` - URL API сервера (по умолчанию: `http://host.docker.internal:3000`)
- `K6_VUS` - количество виртуальных пользователей (по умолчанию: 10)
- `K6_DURATION` - длительность теста (по умолчанию: 30s)

Их можно переопределить при запуске:

```bash
K6_API_URL=http://host.docker.internal:3000 K6_VUS=100 K6_DURATION=1m \
  docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test.js
```

## Подключение к API серверу

### Windows/Mac (рекомендуется)

Используется `host.docker.internal:3000` (настроено автоматически через `extra_hosts`).

### Linux

Если `host.docker.internal` не работает:

1. **Получить IP адрес хоста в Docker сети:**
   ```bash
   ip addr show docker0
   # Или
   docker network inspect bridge | grep Gateway
   ```

2. **Использовать полученный IP:**
   ```bash
   K6_API_URL=http://172.17.0.1:3000 docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test.js
   ```

3. **Альтернатива: использовать network_mode: host** (не рекомендуется для production, но работает на Linux):
   ```yaml
   k6:
     network_mode: host
   ```
   Тогда можно использовать `http://localhost:3000`.

### Проверка подключения

```bash
# Проверить доступность API из контейнера K6
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 bash -c "curl -v http://host.docker.internal:3000/api/health"
```

## Структура папок

```
samples-generation/
├── k6-scripts/       # Скрипты для K6 (скрипты будут добавлены позже)
│   ├── README.md
│   └── K6_SETUP.md   # Этот файл
└── k6-results/       # Результаты тестирования (генерируются автоматически)
    ├── .gitignore
    └── README.md
```

## Примеры использования

### Сохранение результатов

```bash
# JSON формат
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 \
  run --out json=/results/results.json /scripts/test.js

# CSV формат
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 \
  run --out csv=/results/results.csv /scripts/test.js

# InfluxDB (если настроен)
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 \
  run --out influxdb=http://influxdb:8086/k6 /scripts/test.js
```

### Разные профили нагрузки

```bash
# Низкая нагрузка
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 \
  run --vus 10 --duration 30s /scripts/test.js

# Средняя нагрузка
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 \
  run --vus 50 --duration 1m /scripts/test.js

# Высокая нагрузка
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 \
  run --vus 100 --duration 5m /scripts/test.js
```

### Использование сценариев K6

```bash
# Запуск сценария с этапами (ramp-up, постоянная нагрузка, ramp-down)
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 \
  run --stage 30s:20 --stage 1m:50 --stage 30s:20 /scripts/test.js
```

## Troubleshooting

### Проблема: K6 не может подключиться к API серверу

**Решение:**
1. Проверьте, что API сервер запущен: `curl http://localhost:3000/api/health`
2. На Windows/Mac используйте `host.docker.internal:3000`
3. На Linux используйте IP адрес хоста или `network_mode: host`

### Проблема: Путь к скриптам не найден

**Решение:**
Убедитесь, что скрипты находятся в `samples-generation/k6-scripts/`.
Пути в docker-compose настроены относительно `compose/` директории.

### Проблема: Ошибки при запуске K6 контейнера

**Решение:**
Проверьте, что образ загружен:
```bash
docker pull grafana/k6:latest
```
