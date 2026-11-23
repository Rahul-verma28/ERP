import { describe, expect, it } from 'vitest';
import { newLicenceKeys, privateKeyFrom, publicKeyFrom, readLicence, signLicence } from '../kernel/licence';
import { licenceLapsed, moduleFromTier } from '../modules/licensing/service';
import { MODULE_KEYS } from '../contracts/modules';
import type { LicencePayload } from '../contracts/licence';

const keys = newLicenceKeys();
const priv = privateKeyFrom(keys.privateKey);
const pub = publicKeyFrom(keys.publicKey);
const now = Math.floor(Date.now() / 1000);
const payload: LicencePayload = {
  iss: 'ahead-console', typ: 'ahead-licence', v: 1, sub: '01a19111-0000-7000-8000-000000000001', dep: 'cloud-dev', seq: now,
  plan: { key: 'standard', name: 'Standard' }, status: 'active',
  modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, k === 'hr' ? 'none' : 'full'])) as LicencePayload['modules'],
  limits: { users: 5, branches: 1, contacts: 10_000, items: null, invoicesPerMonth: null, storageMb: 5120, aiCredits: 0 },
  trialEndsAt: null, periodEnd: null, graceEndsAt: null, iat: now, exp: now + 14 * 86_400,
};

describe('licence', () => {
  it('reads back what was signed', () => {
    expect(readLicence(signLicence(payload, priv), pub)).toEqual(payload);
  });

  it('refuses a licence changed after signing', () => {
    const [h, , s] = signLicence(payload, priv).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, modules: { ...payload.modules, hr: 'full' } })).toString('base64url');
    expect(() => readLicence(`${h}.${forged}.${s}`, pub)).toThrow(/not issued by AHEAD/);
  });

  it('refuses a licence signed with another key', () => {
    const other = privateKeyFrom(newLicenceKeys().privateKey);
    expect(() => readLicence(signLicence(payload, other), pub)).toThrow(/not issued by AHEAD/);
  });

  it('refuses something that is not a licence', () => {
    expect(() => readLicence('abc', pub)).toThrow(/not a licence/);
    expect(() => readLicence(signLicence({ ...payload, typ: 'other' } as unknown as LicencePayload, priv), pub)).toThrow(/Not an AHEAD licence/);
  });

  it('opens modules from the tier; a module not given is read-only only if it was used', () => {
    expect(moduleFromTier('full', false, false)).toEqual({ status: 'active', tier: 'full' });
    expect(moduleFromTier('basic', false, false)).toEqual({ status: 'active', tier: 'basic' });
    expect(moduleFromTier('none', true, false)).toEqual({ status: 'read_only', tier: 'basic' });
    expect(moduleFromTier('none', false, false)).toEqual({ status: 'inactive', tier: 'basic' });
    // Ran out past the grace days: used modules read, nothing opens fresh
    expect(moduleFromTier('full', true, true)).toEqual({ status: 'read_only', tier: 'basic' });
  });

  it('keeps working 7 days after a licence runs out', () => {
    const ended = new Date(Date.now() - 6 * 86_400_000);
    expect(licenceLapsed(ended)).toBe(false);
    expect(licenceLapsed(new Date(Date.now() - 8 * 86_400_000))).toBe(true);
  });
});
