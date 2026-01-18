/**
 * Полный цикл записи через API
 * POST /api/write-batch
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  stages: [
    { duration: '10s', target: 5 },    // Ramp-up
    { duration: '60s', target: 20 },   // Load
    { duration: '20s', target: 0 },    // Ramp-down
  ],
  thresholds: {
    // Пороги времени ответа (реалистичные значения для записи с Saga)
    http_req_duration: ['p(50)<3000', 'p(90)<8000', 'p(95)<15000', 'p(99)<30000'],
    http_req_failed: ['rate<0.05'], // Менее 5% ошибок
    checks: ['rate>0.90'], // 90%+ проверок успешны
  },
};

const errorRate = new Rate('errors');

export default function () {
  // Записываем батч из нескольких записей
  const count = parseInt(__ENV.K6_WRITE_BATCH_SIZE || '5', 10);
  const concurrency = parseInt(__ENV.K6_WRITE_CONCURRENCY || '5', 10);

  const payload = {
    count: count,
    verbose: false,
    concurrency: concurrency,
  };

  const res = http.post(
    `${API_URL}/api/write-batch`,
    JSON.stringify(payload),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'write-batch', batch_size: String(count) },
    }
  );

  const success = check(res, {
    'write status 201': (r) => r.status === 201,
    'write has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && Array.isArray(body.data);
      } catch {
        return false;
      }
    },
    'write duration acceptable': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.durationMs < 30000; // Менее 30 секунд
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!success);

  // Извлекаем время выполнения из ответа
  if (res.status === 201) {
    try {
      const body = JSON.parse(res.body);
      if (body.durationMs) {
        // Можно логировать для анализа
      }
    } catch {
      // Игнорируем ошибки парсинга
    }
  }

  sleep(1);
}
