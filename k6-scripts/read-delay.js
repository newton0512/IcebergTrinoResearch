/**
 * Проверка задержек чтения из Trino
 * GET /api/read-delay
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  stages: [
    { duration: '10s', target: 10 },   // Ramp-up
    { duration: '60s', target: 50 },   // Load
    { duration: '20s', target: 0 },    // Ramp-down
  ],
  thresholds: {
    // Пороги времени ответа (реалистичные значения для чтения)
    http_req_duration: ['p(50)<1000', 'p(90)<3000', 'p(95)<6000', 'p(99)<15000'],
    http_req_failed: ['rate<0.05'], // Менее 5% ошибок
    checks: ['rate>0.90'], // 90%+ проверок успешны
    'read_delay': ['p(50)<500', 'p(90)<2000', 'p(95)<4000', 'p(99)<10000'],
  },
};

const readDelay = new Trend('read_delay');

export default function () {
  const res = http.get(`${API_URL}/api/read-delay`, {
    tags: { name: 'read-delay' },
  });

  const success = check(res, {
    'read delay status 200': (r) => r.status === 200,
    'read delay has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && body.data !== undefined;
      } catch {
        return false;
      }
    },
  });

  // Извлекаем метрику задержки чтения
  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      if (body.data?.readDelayMs) {
        readDelay.add(body.data.readDelayMs);
      }
    } catch {
      // Игнорируем ошибки парсинга
    }
  }

  sleep(0.5); // Частые запросы для измерения задержек
}
