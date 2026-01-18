/**
 * Прямые запросы к Trino через API
 * GET /api/trino/query
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  stages: [
    { duration: '10s', target: 2 },    // Ramp-up (Trino медленнее)
    { duration: '30s', target: 5 },   // Load
    { duration: '20s', target: 0 },    // Ramp-down
  ],
  thresholds: {
    // Пороги времени ответа (реалистичные значения для Trino через API)
    http_req_duration: ['p(50)<1000', 'p(90)<5000', 'p(95)<10000', 'p(99)<20000'],
    http_req_failed: ['rate<0.05'], // Менее 5% ошибок (Trino может быть медленнее)
    checks: ['rate>0.90'], // 90%+ проверок успешны
  },
};

const errorRate = new Rate('errors');

// Оптимизированные запросы - более легкие, чтобы не перегружать Trino
// Избегаем COUNT(*) на всей таблице, используем выборки с LIMIT
const queries = [
  // Простая выборка с LIMIT (самый быстрый запрос)
  'SELECT id, amount, registrar_type_id FROM iceberg.warehouse.bonus_registry ORDER BY "date" DESC LIMIT 10',
  // COUNT с условием (может использовать метаданные/индексы)
  'SELECT COUNT(*) as count FROM iceberg.warehouse.bonus_registry WHERE amount > 0 LIMIT 1',
  // GROUP BY с LIMIT (ограниченная выборка)
  'SELECT registrar_type_id, COUNT(*) as cnt FROM iceberg.warehouse.bonus_registry WHERE registrar_type_id IS NOT NULL GROUP BY registrar_type_id LIMIT 10',
  // Простая выборка по условию
  'SELECT id, amount FROM iceberg.warehouse.bonus_registry WHERE amount BETWEEN 1000 AND 5000 LIMIT 20',
  // Выборка с фильтром по дате (если есть индекс)
  'SELECT id, amount, registrar_type_id FROM iceberg.warehouse.bonus_registry WHERE "date" >= CURRENT_DATE - INTERVAL \'7\' DAY LIMIT 50',
];

export default function () {
  const query = queries[Math.floor(Math.random() * queries.length)];

  const res = http.post(
    `${API_URL}/api/trino/query`,
    JSON.stringify({ query }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'trino-query', query_type: query.includes('COUNT') ? 'count' : 'select' },
      timeout: '60s', // Увеличиваем timeout для Trino запросов
    }
  );

  const success = check(res, {
    'trino query status 200': (r) => r.status === 200,
    'trino query has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!success);
  sleep(5); // Увеличиваем интервал между запросами, чтобы не перегружать Trino
}
