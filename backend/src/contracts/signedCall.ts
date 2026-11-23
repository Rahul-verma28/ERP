import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// Shared by the ERP and the Console (node only): how a call between them is signed. The sender
// signs its time, a one-use id, the method, the path and the body with the shared key; the
// receiver checks all of it. See docs/architecture/console-erp-split.md.

export const SIGNED_WINDOW_S = 300;

const bodyHash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
export const signCall = (key: string, ts: number, nonce: string, method: string, path: string, body: string | Buffer) =>
  createHmac('sha256', key).update(`${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash(body)}`).digest('hex');

/** Headers for a signed call; `path` is the path and query as the receiver sees it */
export function signedHeaders(key: string, method: string, path: string, body = ''): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  return { Authorization: `AHEAD-HMAC ts=${ts}, nonce=${nonce}, sig=${signCall(key, ts, nonce, method, path, body)}`, 'Content-Type': 'application/json' };
}

/** Check a call's signature. Returns the one-use id to record (replay guard), or a reason it fails. */
export function checkSignedCall(key: string, authorization: string | undefined, method: string, path: string, rawBody: Buffer): { nonce: string } | { error: string } {
  const m = /^AHEAD-HMAC ts=(\d+), nonce=([0-9a-f-]{36}), sig=([0-9a-f]{64})$/i.exec(authorization ?? '');
  if (!m) return { error: 'This call is not signed.' };
  const [, tsText, nonce, sig] = m;
  if (Math.abs(Date.now() / 1000 - Number(tsText)) > SIGNED_WINDOW_S) return { error: 'This call is too old, or the clocks differ by more than 5 minutes.' };
  const want = Buffer.from(signCall(key, Number(tsText), nonce, method, path, rawBody), 'hex');
  const got = Buffer.from(sig, 'hex');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { error: 'The signature does not match.' };
  return { nonce };
}
