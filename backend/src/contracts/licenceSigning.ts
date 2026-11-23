import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { licenceShapeError, type LicencePayload } from './licence';

// Shared by the ERP and the Console (node only; the web app never imports it).
// Signed licences: a compact JWT with alg EdDSA (Ed25519). The Console signs with its private key;
// the ERP checks with the public key only, so a self-hosted ERP checks a licence with no network.
// Keys travel as base64 of their DER form (PKCS#8 private, SPKI public): one line in a .env file.

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const HEADER = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'ahead-licence-1' }));

export class LicenceError extends Error {}

export function privateKeyFrom(base64Der: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'pkcs8' });
}
export function publicKeyFrom(base64Der: string): KeyObject {
  return createPublicKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'spki' });
}

/** A fresh key pair, as the two one-line values for .env */
export function newLicenceKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

export function signLicence(payload: LicencePayload, privateKey: KeyObject): string {
  const body = `${HEADER}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${b64url(sign(null, Buffer.from(body), privateKey))}`;
}

/**
 * Check a licence's signature and shape. Does not judge whether it has run out (the caller
 * decides, with the grace days). Throws LicenceError with a plain reason.
 */
export function readLicence(token: string, publicKey: KeyObject): LicencePayload {
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new LicenceError('This is not a licence key.');
  const [head, body, sig] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
  } catch {
    throw new LicenceError('This is not a licence key.');
  }
  if (header.alg !== 'EdDSA') throw new LicenceError('This licence is not signed the AHEAD way.');
  if (!verify(null, Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, 'base64url'))) throw new LicenceError('This licence was not issued by AHEAD, or it was changed.');
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new LicenceError('This licence cannot be read.');
  }
  const bad = licenceShapeError(payload);
  if (bad) throw new LicenceError(bad);
  return payload as LicencePayload;
}
