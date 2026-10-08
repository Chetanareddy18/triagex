import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const e = err as { name?: string; code?: number; type?: string; message?: string };
  if (e.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  if (e.name === 'CastError') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed identifier' } });
  if (e.name === 'ValidationError') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: e.message } });
  if (e.code === 11000) return res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate value' } });

  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
