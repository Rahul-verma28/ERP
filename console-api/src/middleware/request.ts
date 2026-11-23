import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AppError } from '../kernel/errors';

/** Accept or generate X-Request-Id and echo it on every response. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

type Part = 'body' | 'query' | 'params';

/** Validate and replace req[part] with the parsed value; 422 VALIDATION_FAILED on error. */
export function validate<S extends ZodTypeAny>(schema: S, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
      throw new AppError('VALIDATION_FAILED', 'Some fields are invalid.', { fields });
    }
    if (part === 'query') Object.defineProperty(req, 'query', { value: result.data, writable: true });
    else (req as unknown as Record<Part, z.infer<S>>)[part] = result.data;
    next();
  };
}
