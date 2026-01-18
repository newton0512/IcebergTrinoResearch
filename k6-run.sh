#!/bin/bash
# Обертка для запуска K6 с правильными путями на Windows/Git Bash

# Получаем абсолютный путь к директории проекта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Преобразуем путь для Windows (если нужно)
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Преобразуем Unix-путь в Windows-путь для Docker
    PROJECT_ROOT_WIN=$(cygpath -w "$PROJECT_ROOT" 2>/dev/null || echo "$PROJECT_ROOT" | sed 's|^/\([a-z]\)|\1:|i' | sed 's|/|\\|g')
    # Используем формат /c/path для Git Bash
    PROJECT_ROOT=$(echo "$PROJECT_ROOT" | sed 's|^/\([a-z]\)|/\1|i')
fi

# Устанавливаем переменную окружения для docker-compose
export PROJECT_ROOT

# Запускаем docker-compose с явным указанием пути
cd "$PROJECT_ROOT" || exit 1

SCRIPT_FILE="${1:-test-simple.js}"
shift

docker compose -f compose/docker-compose.yml --profile k6 run --rm \
  -v "${PROJECT_ROOT}/k6-scripts:/scripts:ro" \
  -v "${PROJECT_ROOT}/k6-results:/results" \
  k6 run "/scripts/${SCRIPT_FILE}" "$@"
