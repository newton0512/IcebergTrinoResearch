/**
 * Типовые аналитические запросы через API
 * GET /api/analytics/:type
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  stages: [
    { duration: '10s', target: 10 },   // Ramp-up
    { duration: '60s', target: 30 },   // Load
    { duration: '20s', target: 0 },    // Ramp-down
  ],
  thresholds: {
    // Пороги времени ответа (реалистичные значения для аналитических запросов)
    http_req_duration: ['p(50)<2000', 'p(90)<8000', 'p(95)<15000', 'p(99)<30000'],
    http_req_failed: ['rate<0.05'], // Менее 5% ошибок
    checks: ['rate>0.90'], // 90%+ проверок успешны
  },
};

const errorRate = new Rate('errors');

const analyticsTypes = [
  'count',
  'sum-amount',
  'avg-amount',
  'min-amount',
  'max-amount',
  'group-by-registrar-type',
  'group-by-date',
  'top-balances',
];

export default function () {
  const type = analyticsTypes[Math.floor(Math.random() * analyticsTypes.length)];
  const limit = Math.floor(Math.random() * 50) + 10; // 10-60

  const url = `${API_URL}/api/analytics/${type}?limit=${limit}`;
  
  const res = http.get(url, {
    tags: { 
      name: 'analytics-query',
      analytics_type: type,
    },
  });

  const success = check(res, {
    'analytics status 200': (r) => r.status === 200,
    'analytics has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && body.data !== undefined;
      } catch {
        return false;
      }
    },
    'analytics response time acceptable': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.durationMs < 15000; // Менее 15 секунд
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!success);
  sleep(1);
}
