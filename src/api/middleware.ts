/**
 * Middleware для REST API
 */

import type { Request, Response, NextFunction } from "express";

/**
 * Middleware для измерения времени выполнения запроса
 */
export function timingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();

  // Сохраняем оригинальный метод json для добавления метрик
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown) {
    const duration = Date.now() - startTime;
    
    if (typeof body === "object" && body !== null && "success" in body) {
      (body as { metrics?: { duration: number; timestamp: string } }).metrics = {
        duration,
        timestamp: new Date().toISOString(),
      };
    }

    return originalJson(body);
  };

  next();
}

/**
 * Middleware для логирования запросов
 */
export function loggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    );
  });

  next();
}

/**
 * Middleware для обработки ошибок
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error("API Error:", err);
  
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
    metrics: {
      duration: 0,
      timestamp: new Date().toISOString(),
    },
  });
}
