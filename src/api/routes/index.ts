/**
 * Роуты для REST API
 */

import { Router } from "express";
import * as readController from "../controllers/read.controller.js";
import * as writeController from "../controllers/write.controller.js";
import * as deleteController from "../controllers/delete.controller.js";
import * as postgresController from "../controllers/postgres.controller.js";
import * as trinoController from "../controllers/trino.controller.js";
import * as analyticsController from "../controllers/analytics.controller.js";
import * as consistencyController from "../controllers/consistency.controller.js";
import * as delayController from "../controllers/delay.controller.js";
import * as statsController from "../controllers/stats.controller.js";
import * as queueController from "../controllers/queue.controller.js";

const router = Router();

// Health check
router.get("/health", (req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
  });
});

// Чтение
router.get("/read/:id", readController.readById);
router.get("/list", readController.readList);

// Запись
router.post("/write", writeController.write);
router.post("/write-full-cycle", writeController.writeFullCycle);

// Удаление
router.delete("/delete/:id", deleteController.deleteById);

// Прямые запросы
router.post("/postgres/query", postgresController.postgresQuery);
router.post("/trino/query", trinoController.trinoQuery);

// Аналитика
router.get("/analytics/:type", analyticsController.analytics);

// Проверка согласованности
router.post("/consistency-check", consistencyController.consistencyCheck);

// Проверка задержек чтения
router.get("/read-delay", delayController.readDelay);

// Статистика
router.get("/stats", statsController.stats);

// Статус очереди
router.get("/queue/status", queueController.queueStatus);

export default router;
