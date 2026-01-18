#!/bin/bash
# Обертка для запуска K6 через stdin (обходит проблемы с путями на Windows/Git Bash)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_FILE="${1:-test-simple.js}"

# Если путь не абсолютный и не начинается с k6-scripts/, добавляем префикс
if [[ "$SCRIPT_FILE" != /* && "$SCRIPT_FILE" != k6-scripts/* ]]; then
    if [ -f "$SCRIPT_DIR/k6-scripts/$SCRIPT_FILE" ]; then
        SCRIPT_FILE="k6-scripts/$SCRIPT_FILE"
    fi
fi

# Если путь все еще не существует, пробуем как есть
if [ ! -f "$SCRIPT_DIR/$SCRIPT_FILE" ]; then
    echo "Error: Script file $SCRIPT_DIR/$SCRIPT_FILE not found"
    echo "Looking for scripts in: $SCRIPT_DIR/k6-scripts/"
    ls -la "$SCRIPT_DIR/k6-scripts/" 2>/dev/null || echo "Directory k6-scripts/ not found"
    exit 1
fi

FULL_SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_FILE"

# Передаем скрипт через stdin в K6
cat "$FULL_SCRIPT_PATH" | docker run --rm -i \
  -e K6_API_URL="${K6_API_URL:-http://host.docker.internal:3000}" \
  -e K6_VUS="${K6_VUS:-10}" \
  -e K6_DURATION="${K6_DURATION:-30s}" \
  -e K6_WRITE_BATCH_SIZE="${K6_WRITE_BATCH_SIZE:-5}" \
  -e K6_WRITE_CONCURRENCY="${K6_WRITE_CONCURRENCY:-5}" \
  grafana/k6:latest run - "${@:2}"
