import { RequestHandler } from 'express';
import { ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError';

/** Validates and normalises req.body against a zod schema. */
export const validate =
  (schema: ZodTypeAny): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(ApiError.unprocessable('Validation failed', result.error.flatten()));
    }
    req.body = result.data;
    next();
  };
