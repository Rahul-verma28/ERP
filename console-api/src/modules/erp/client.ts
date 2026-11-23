import { signedHeaders } from '@contracts/signedCall';
import { env } from '../../config/env';
import { AppError } from '../../kernel/errors';

// The only way the Console reaches an ERP installation: signed calls to its provisioning API
// (/api/v1/internal/v1). One cloud installation for now; Business.deployment names it.

export class ErpError extends AppError {
  constructor(message: string, readonly httpStatus: number, readonly retry: boolean) {
    super('PROVIDER_UNAVAILABLE', message);
  }
}

export async function erp<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  const text = body === undefined ? '' : JSON.stringify(body);
  const url = new URL(`/api/v1/internal/v1${path}`, env.ERP_URL);
  let res: Response;
  try {
    res = await fetch(url, { method, headers: signedHeaders(env.PROVISION_KEY, method, url.pathname + url.search, text), body: text || undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ErpError(`The ERP can't be reached (${e instanceof Error ? e.message : e}).`, 0, true);
  }
  const out = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  // 4xx (except 408/429): the request itself is wrong, trying again won't help
  if (!res.ok) throw new ErpError(out?.error?.message ?? `The ERP answered ${res.status}.`, res.status, res.status >= 500 || res.status === 408 || res.status === 429);
  return out as T;
}

export interface ErpOverview {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  owner: { name: string; email: string; mobile: string; lastLoginAt: string | null } | null;
  ownerLink: { sentAt: string; usedAt: string | null } | null;
  setupDone: boolean;
  lastActiveAt: string | null;
  team: { active: number; invited: number; branches: number };
  usage: { invoicesThisMonth: number; customers: number; storageBytes: number };
  licence: { seq: number; status: string; plan: string; expiresAt: string } | null;
}
