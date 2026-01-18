#!/bin/bash
# Скрипт для запуска всех тестов K6 последовательно
# Собирает результаты в k6-results/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/../k6-results"
API_URL="${K6_API_URL:-http://host.docker.internal:3000}"

mkdir -p "$RESULTS_DIR"

echo "========================================="
echo "K6 Load Testing Suite"
echo "API URL: $API_URL"
echo "Results will be saved to: $RESULTS_DIR"
echo "========================================="
echo ""

# Функция для запуска теста
run_test() {
  local test_name=$1
  local script_file=$2
  local duration=${3:-60s}
  local vus=${4:-10}
  
  echo "Running: $test_name"
  echo "  Script: $script_file"
  echo "  Duration: $duration, VUs: $vus"
  echo ""
  
  K6_API_URL="$API_URL" K6_DURATION="$duration" K6_VUS="$vus" \
    bash "$SCRIPT_DIR/../k6-run-pipe.sh" "$script_file" \
    --out json="$RESULTS_DIR/${test_name}-$(date +%Y%m%d-%H%M%S).json" \
    --duration "$duration" \
    --vus "$vus" 2>&1 | tee "$RESULTS_DIR/${test_name}-$(date +%Y%m%d-%H%M%S).log"
  
  echo ""
  echo "Completed: $test_name"
  echo "========================================="
  echo ""
  
  # Пауза между тестами
  sleep 5
}

# Проверка доступности API
echo "Checking API availability..."
if ! curl -s "$API_URL/api/health" > /dev/null; then
  echo "ERROR: API server is not available at $API_URL"
  echo "Please start the API server: pnpm run api:server"
  exit 1
fi
echo "API is available"
echo ""

# Запуск тестов
run_test "postgres-direct" "postgres-direct.js" "60s" "50"
run_test "trino-direct" "trino-direct.js" "60s" "20"
run_test "write-cycle" "write-cycle.js" "90s" "20"
run_test "consistency-check" "consistency-check.js" "75s" "5"
run_test "analytics-queries" "analytics-queries.js" "90s" "30"
run_test "read-delay" "read-delay.js" "90s" "50"
run_test "real-load" "real-load.js" "9m" "50"

echo "========================================="
echo "All tests completed!"
echo "Results saved to: $RESULTS_DIR"
echo "========================================="
