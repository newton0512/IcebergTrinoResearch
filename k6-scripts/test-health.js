/**
 * Простой тестовый скрипт для проверки подключения к API
 * Этот скрипт проверяет доступность API сервера
 */

import http from 'k6/http';
import { check } from 'k6';

// URL API сервера из переменной окружения или по умолчанию
const API_URL = __ENV.K6_API_URL || 'http://host.docker.internal:3000';

export const options = {
  vus: 1,
  duration: '5s',
};

export default function () {
  // Проверка health endpoint
  const healthRes = http.get(`${API_URL}/api/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health response has success': (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return body.success === true;
      } catch {
        return false;
      }
    },
  });

  // Простой тест чтения списка
  const listRes = http.get(`${API_URL}/api/list?limit=10&order=desc`);
  check(listRes, {
    'list status is 200': (r) => r.status === 200,
  });
}
