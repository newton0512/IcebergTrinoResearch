/**
 * Минимальный тестовый скрипт для проверки работоспособности K6
 * Запуск: docker compose -f compose/docker-compose.yml --profile k6 run --rm k6 run /scripts/test-simple.js
 */

import http from 'k6/http';
import { check } from 'k6';

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const res = http.get(`${API_URL}/api/health`);
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
