import type { RequestHandler } from "express";

export const idempotencyMiddleware: RequestHandler = (req, _res, next) => {
  const key = req.header("x-idempotency-key");
  if (key) {
    (req as typeof req & { idempotencyKey?: string }).idempotencyKey = key;
  }
  next();
};
