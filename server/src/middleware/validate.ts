import type { NextFunction, Request, Response } from 'express';
import { z, type ZodType } from 'zod';
import { AppError } from '../lib/errors.js';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and coerces request parts with Zod. Parsed values are stored on
 * `res.locals` (`body`, `query`, `params`) because Express 5 makes `req.query` read-only.
 */
export const validate =
  (schemas: Schemas) =>
  (req: Request, res: Response, next: NextFunction) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        return next(
          new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', {
            part,
            issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }),
        );
      }
      res.locals[part] = result.data;
    }
    next();
  };

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'must be an ObjectId');
