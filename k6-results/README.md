# K6 Test Results

Эта папка содержит результаты нагрузочного тестирования, сгенерированные K6.

Файлы результатов игнорируются в git (см. `.gitignore`).

## Использование

Для сохранения результатов тестирования используйте параметр `--out`:

```bash
# Сохранить результаты в JSON
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run --out json=/results/results.json /scripts/test.js

# Сохранить результаты в CSV
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run --out csv=/results/results.csv /scripts/test.js

# Сохранить результаты в InfluxDB (если настроен)
docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run --out influxdb=http://influxdb:8086/k6 /scripts/test.js
```
