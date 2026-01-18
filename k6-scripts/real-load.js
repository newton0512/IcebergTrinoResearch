/**
 * Имитация реальной нагрузки - смешанный сценарий
 * Комбинация всех типов операций с реалистичными пропорциями
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Медленный ramp-up
    { duration: '5m', target: 50 },    // Устойчивая нагрузка
    { duration: '1m', target: 100 },   // Пиковая нагрузка
    { duration: '2m', target: 50 },    // Снижение до нормального уровня
    { duration: '30s', target: 0 },    // Ramp-down
  ],
  thresholds: {
    // Общие метрики (реалистичные значения для смешанной нагрузки)
    http_req_duration: ['p(50)<2000', 'p(90)<8000', 'p(95)<15000', 'p(99)<40000'],
    http_req_failed: ['rate<0.05'], // Менее 5% ошибок
    checks: ['rate>0.90'], // 90%+ проверок успешны
    
    // По типам операций (более реалистичные пороги)
    'http_req_duration{name:read}': ['p(90)<3000'],
    'http_req_duration{name:write}': ['p(90)<8000'],
    'http_req_duration{name:analytics}': ['p(90)<15000'],
  },
};

const errorRate = new Rate('errors');

// Веса операций (имитация реального распределения)
// Чтение - 60%, Запись - 20%, Аналитика - 15%, Другое - 5%
function getRandomOperation() {
  const rand = Math.random();
  if (rand < 0.60) return 'read';
  if (rand < 0.80) return 'write';
  if (rand < 0.95) return 'analytics';
  return 'other';
}

export default function () {
  const operation = getRandomOperation();
  let res;
  let success = false;

  switch (operation) {
    case 'read': {
      // Чтение списка записей
      const limit = Math.floor(Math.random() * 50) + 10;
      res = http.get(`${API_URL}/api/list?limit=${limit}&order=desc`, {
        tags: { name: 'read', operation: 'list' },
      });
      success = check(res, {
        'read status 200': (r) => r.status === 200,
        'read has data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.success === true && Array.isArray(body.data);
          } catch {
            return false;
          }
        },
      });
      sleep(0.5);
      break;
    }

    case 'write': {
      // Запись одиночной записи
      res = http.post(
        `${API_URL}/api/write`,
        JSON.stringify({ verbose: false }),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { name: 'write', operation: 'single' },
        }
      );
      success = check(res, {
        'write status 201': (r) => r.status === 201,
        'write has data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.success === true;
          } catch {
            return false;
          }
        },
      });
      sleep(1);
      break;
    }

    case 'analytics': {
      // Аналитический запрос
      const types = ['count', 'sum-amount', 'avg-amount', 'group-by-registrar-type'];
      const type = types[Math.floor(Math.random() * types.length)];
      res = http.get(`${API_URL}/api/analytics/${type}?limit=50`, {
        tags: { name: 'analytics', operation: type },
      });
      success = check(res, {
        'analytics status 200': (r) => r.status === 200,
        'analytics has data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.success === true;
          } catch {
            return false;
          }
        },
      });
      sleep(1);
      break;
    }

    default: {
      // Другие операции (stats, health check)
      res = http.get(`${API_URL}/api/stats`, {
        tags: { name: 'other', operation: 'stats' },
      });
      success = check(res, {
        'stats status 200': (r) => r.status === 200,
      });
      sleep(2);
      break;
    }
  }

  errorRate.add(!success);
}
