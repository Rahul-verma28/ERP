import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../kernel/errors';

export function notFoundRoute(req: Request, _res: Response, next: NextFunction) {
  next(new AppError('NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

const DB_DOWN = /can't reach database|timeout expired|connection terminated|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|WebSocket|Unable to start a transaction|connect ECONN/i;

/** True when the error means the database could not be reached (not a query bug). */
export function isDatabaseUnavailable(err: unknown) {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError && ['P1001', 'P1002', 'P1017', 'P2024', 'P2028'].includes(err.code)) return true;
  return err instanceof Error && DB_DOWN.test(err.message);
}

/** Uniform error body (LLD §1.2): { error: { code, message, details, requestId } } */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let appErr: AppError;
  if (err instanceof AppError) {
    appErr = err;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    appErr = new AppError('CONFLICT', 'A record with these details already exists.', { fields: err.meta?.target });
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    appErr = new AppError('NOT_FOUND', 'Record not found.');
  } else if (err instanceof SyntaxError && 'body' in err) {
    appErr = new AppError('BAD_REQUEST', 'Malformed JSON body.');
  } else if (isDatabaseUnavailable(err)) {
    console.error(`[${req.requestId}] database unavailable:`, err instanceof Error ? err.message.split('\n').pop() : err);
    appErr = new AppError('PROVIDER_UNAVAILABLE', 'The service is temporarily unavailable. Please try again in a moment.');
  } else {
    console.error(`[${req.requestId}]`, err);
    appErr = new AppError('INTERNAL', 'Something went wrong. Please try again.');
  }
  if (appErr.code === 'RATE_LIMITED' && appErr.details?.retryAfter) res.setHeader('Retry-After', String(appErr.details.retryAfter));
  if (appErr.code === 'PROVIDER_UNAVAILABLE') res.setHeader('Retry-After', '10');
  res.status(appErr.status).json({
    error: { code: appErr.code, message: appErr.message, details: appErr.details, requestId: req.requestId },
  });
}
