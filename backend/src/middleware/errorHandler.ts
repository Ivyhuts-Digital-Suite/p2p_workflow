import { ErrorRequestHandler, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { isDatabaseConnected } from '../config/db';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

const DATABASE_ERROR_NAMES = [
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
];

const isDatabaseUnavailable = (err: Error) =>
  DATABASE_ERROR_NAMES.includes(err.name) || /buffering timed out/.test(err.message);

function sendDatabaseUnavailable(res: Response) {
  res
    .status(503)
    .set('Retry-After', '5')
    .json({ message: 'The database is temporarily unavailable. Please try again in a moment.' });
}

/** Answers straight away during an outage rather than making each request wait for a driver timeout. */
export const requireDatabase: RequestHandler = (req, res, next) => {
  if (req.path === '/health' || isDatabaseConnected()) return next();
  sendDatabaseUnavailable(res);
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ message: err.message, details: err.details });
  }
  // The connection dropped after the request had already passed requireDatabase.
  if (isDatabaseUnavailable(err as Error)) {
    console.error('[db] request failed, database unavailable:', (err as Error).message);
    return sendDatabaseUnavailable(res);
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(Object.entries(err.errors).map(([path, e]) => [path, e.message]));
    return res.status(422).json({ message: 'Validation failed', details });
  }
  if (err instanceof mongoose.Error.VersionError) {
    return res.status(409).json({ message: 'The record was modified by someone else - reload and retry' });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ message: `Invalid value for ${err.path}` });
  }
  if ((err as { code?: number }).code === 11000) {
    const keyPattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
    if ('role' in keyPattern) {
      return res.status(409).json({ message: 'Single Master Account Policy: an account already exists for this role' });
    }
    if ('bid' in keyPattern) {
      return res.status(409).json({ message: 'A PO already exists for this bid' });
    }
    if ('invoiceNumber' in keyPattern) {
      return res.status(409).json({ message: 'Duplicate invoice blocked: this vendor has already submitted this invoice number' });
    }
    return res.status(409).json({
      message: 'Duplicate record',
      details: (err as { keyValue?: unknown }).keyValue,
    });
  }
  if (err instanceof jwt.JsonWebTokenError) {
    return res.status(401).json({ message: err instanceof jwt.TokenExpiredError ? 'Token expired' : 'Invalid token' });
  }

  console.error('[error]', err);
  return res.status(500).json({
    message: 'Internal server error',
    ...(env.isProduction ? {} : { details: (err as Error).message }),
  });
};
