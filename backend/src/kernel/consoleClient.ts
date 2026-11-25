import { signedHeaders } from '../contracts/signedCall';
import { env } from '../config/env';
import { AppError } from './errors';

// This ERP's calls to the AHEAD Console (console-api, /api/v1/provision/v1): signup, plans,
// the owner's Plan & billing, closing and reopening, usage and licences. Signed with the shared
// PROVISION_KEY. An installation with no Console (self-hosted, licence file) has no CONSOLE_URL.

export class ConsoleError extends AppError {}

export const hasConsole = () => !!env.CONSOLE_URL && !!env.PROVISION_KEY;

export async function consoleApi<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  if (!hasConsole()) throw new ConsoleError('PROVIDER_UNAVAILABLE', 'This installation is not connected to the AHEAD Console.');
  const text = body === undefined ? '' : JSON.stringify(body);
  const url = new URL(`/api/v1/provision/v1${path}`, env.CONSOLE_URL);
  let res: Response;
  try {
    res = await fetch(url, { method, headers: signedHeaders(env.PROVISION_KEY!, method, url.pathname + url.search, text), body: text || undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ConsoleError('PROVIDER_UNAVAILABLE', 'AHEAD can’t be reached just now. Try again in a minute.');
  }
  const out = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
  if (!res.ok) {
    const e = out?.error;
    // The Console's own answer (a wrong coupon, a field) is passed on as it is
    if (res.status < 500 && e?.code) throw new ConsoleError(e.code as never, e.message ?? 'Not allowed.', e.details);
    throw new ConsoleError('PROVIDER_UNAVAILABLE', 'AHEAD can’t be reached just now. Try again in a minute.');
  }
  return out as T;
}
