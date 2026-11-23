import type { NextFunction, Request, Response } from 'express';
import { checkSignedCall, signedHeaders } from '../contracts/signedCall';
import { AppError } from './errors';
import { prisma } from './db';

// Calls between the Console and this ERP. The signing itself is shared (contracts/signedCall.ts);
// here: the sending helper and the middleware that only lets correctly signed calls through.

export { signedHeaders, SIGNED_WINDOW_S } from '../contracts/signedCall';

/** A signed call to the other side. Throws with the other side's message when it answers with an error. */
export async function signedFetch<T>(baseUrl: string, key: string, method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const text = body === undefined ? '' : JSON.stringify(body);
  const url = new URL(path, baseUrl);
  const res = await fetch(url, { method, headers: signedHeaders(key, method, url.pathname + url.search, text), body: text || undefined, signal: AbortSignal.timeout(timeoutMs) });
  const out = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new AppError('PROVIDER_UNAVAILABLE', out?.error?.message ?? `The other side answered ${res.status}.`);
  return out as T;
}

/** Express middleware: only correctly signed calls with this key pass, each once */
export function requireSigned(getKey: () => string | undefined) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const key = getKey();
      if (!key) throw new AppError('UNAUTHENTICATED', 'Signed calls are not set up here (PROVISION_KEY).');
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      const out = checkSignedCall(key, req.header('authorization'), req.method, req.originalUrl, raw);
      if ('error' in out) throw new AppError('UNAUTHENTICATED', out.error);
      const fresh = await prisma.processedEvent.createMany({ data: [{ consumer: 'signed_call', eventId: out.nonce }], skipDuplicates: true });
      if (!fresh.count) throw new AppError('UNAUTHENTICATED', 'This call was already received.');
      next();
    } catch (e) {
      next(e);
    }
  };
}
