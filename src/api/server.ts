/**
 * REST API сервер для тестирования нагрузки с использованием K6
 * 
 * Предоставляет endpoints для:
 * - чтения из таблицы bonus_registry
 * - записи в bonus_registry (через hybrid-writer с сагой)
 * - выборки записей (первые/последние)
 * - удаления записей
 * - прямых запросов к PostgreSQL и Trino
 * - проверки согласованности данных
 * - аналитических запросов
 * - проверки задержек чтения
 * - статистики таблиц и очереди
 */

import express from "express";
import router from "./routes/index.js";
import { timingMiddleware, loggingMiddleware, errorHandler } from "./middleware.js";

const app = express();
const PORT = Number.parseInt(process.env.API_PORT || "3000", 10);

// Middleware
app.use(express.json());
app.use(timingMiddleware);
app.use(loggingMiddleware);

// Routes
app.use("/api", router);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Load Testing API",
    version: "1.0.0",
    description: "REST API for load testing with K6",
    endpoints: {
      health: "GET /api/health",
      read: "GET /api/read/:id",
      list: "GET /api/list?limit=100&order=desc&orderBy=date",
      write: "POST /api/write",
      "write-full-cycle": "POST /api/write-full-cycle",
      delete: "DELETE /api/delete/:id",
      "postgres-query": "POST /api/postgres/query",
      "trino-query": "POST /api/trino/query",
      analytics: "GET /api/analytics/:type?limit=10&dateFrom=2024-01-01&dateTo=2024-12-31",
      "consistency-check": "POST /api/consistency-check?count=10",
      "read-delay": "GET /api/read-delay?iterations=10&recordId=xxx",
      stats: "GET /api/stats",
      "queue-status": "GET /api/queue/status",
    },
  });
});

// Error handler (должен быть последним)
app.use(errorHandler);

// Запуск сервера
app.listen(PORT, () => {
  console.log(`============================================================`);
  console.log(`Load Testing API Server`);
  console.log(`============================================================`);
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`API documentation: http://localhost:${PORT}/`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`============================================================`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down server...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down server...");
  process.exit(0);
});
