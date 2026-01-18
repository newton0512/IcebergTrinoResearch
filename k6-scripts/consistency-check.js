/**
 * Проверка согласованности: запись + чтение с измерением задержки доставки
 * POST /api/consistency-check
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  stages: [
    { duration: '5s', target: 2 },     // Медленный ramp-up (consistency проверки медленные)
    { duration: '60s', target: 5 },    // Load
    { duration: '10s', target: 0 },    // Ramp-down
  ],
  thresholds: {
    // Пороги времени ответа (реалистичные значения для consistency проверок)
    http_req_duration: ['p(50)<8000', 'p(90)<20000', 'p(95)<40000', 'p(99)<80000'],
    http_req_failed: ['rate<0.10'], // Менее 10% ошибок (consistency может быть нестабильной)
    checks: ['rate>0.85'], // 85%+ проверок успешны
    'consistency_write_time': ['p(50)<3000', 'p(90)<8000', 'p(95)<15000'],
    'consistency_read_delay': ['p(50)<2000', 'p(90)<8000', 'p(95)<20000'],
  },
};

const errorRate = new Rate('errors');
const writeTime = new Trend('consistency_write_time');
const readDelay = new Trend('consistency_read_delay');

export default function () {
  const res = http.post(
    `${API_URL}/api/consistency-check`,
    JSON.stringify({}),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'consistency-check' },
      timeout: '60s', // Увеличиваем timeout для consistency проверок
    }
  );

  const success = check(res, {
    'consistency check status 200': (r) => r.status === 200,
    'consistency check has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && body.data !== undefined;
      } catch {
        return false;
      }
    },
    'consistency is consistent': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data?.isConsistent === true;
      } catch {
        return false;
      }
    },
  });

  // Извлекаем метрики времени
  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      if (body.data) {
        if (body.data.writeTimeMs) {
          writeTime.add(body.data.writeTimeMs);
        }
        if (body.data.readDelayMs && body.data.readDelayMs >= 0) {
          readDelay.add(body.data.readDelayMs);
        }
      }
    } catch {
      // Игнорируем ошибки парсинга
    }
  }

  errorRate.add(!success);
  sleep(3); // Consistency проверки медленные, увеличиваем интервал
}
