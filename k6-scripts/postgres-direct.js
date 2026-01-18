/**
 * Прямые запросы к PostgreSQL через API
 * GET /api/postgres/query
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  stages: [
    { duration: '10s', target: 10 },   // Ramp-up
    { duration: '30s', target: 50 },   // Load
    { duration: '20s', target: 0 },    // Ramp-down
  ],
  thresholds: {
    // Пороги времени ответа (реалистичные значения для PostgreSQL через API)
    http_req_duration: ['p(50)<200', 'p(90)<1000', 'p(95)<2000', 'p(99)<3000'],
    http_req_failed: ['rate<0.01'], // Менее 1% ошибок
    checks: ['rate>0.95'], // 95%+ проверок успешны
  },
};

const errorRate = new Rate('errors');

export default function () {
  // Простой запрос - подсчет записей
  const countQuery = {
    query: 'SELECT COUNT(*) as count FROM bonus_registry_unique_check',
  };

  const res = http.post(
    `${API_URL}/api/postgres/query`,
    JSON.stringify(countQuery),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'postgres-count' },
    }
  );

  const success = check(res, {
    'postgres query status 200': (r) => r.status === 200,
    'postgres query has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && body.data !== undefined;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!success);
  sleep(1);
}
