import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from '@contracts/modules';
import { tiersFor } from '../modules/licences/service';
import { checkTotp, totpCode, base32Decode, base32Encode, newTotpSecret } from '../kernel/totp';
import { seal, unseal, normaliseMobile } from '../kernel/crypto';
import { scopeOf, trialEnd } from '../modules/businesses/service';
import { passwordProblem } from '../modules/auth/service';

describe('licence tiers', () => {
  const plan = ['crm', 'catalog', 'billing', 'sales', 'inventory'];
  it('opens everything in full on a trial', () => {
    expect(Object.values(tiersFor('trialing', [], false, [])).every((t) => t === 'full')).toBe(true);
  });
  it('opens nothing while waiting for the first payment, or when closed', () => {
    for (const s of ['incomplete', 'closed'] as const) expect(Object.values(tiersFor(s, plan, false, [{ moduleKey: 'hr', state: 'on' }])).every((t) => t === 'none')).toBe(true);
  });
  it('gives a paid plan its modules in full and the free tier at basic', () => {
    const t = tiersFor('active', plan, false, []);
    expect(t.inventory).toBe('full');
    expect(t.tasks).toBe('basic');
    expect(t.hr).toBe('none');
  });
  it('keeps paid modules open through a failed payment, and Free at the free tier only', () => {
    expect(tiersFor('past_due', plan, false, []).inventory).toBe('full');
    const free = tiersFor('free', plan, false, []);
    expect(free.inventory).toBe('none');
    expect(free.crm).toBe('basic');
  });
  it('applies module switches on top of the plan', () => {
    const t = tiersFor('free', [], true, [{ moduleKey: 'hr', state: 'on' }, { moduleKey: 'crm', state: 'off' }]);
    expect(t.hr).toBe('full');
    expect(t.crm).toBe('none');
    expect(Object.keys(t)).toEqual([...MODULE_KEYS]);
  });
});

describe('two-step codes', () => {
  it('matches the RFC 6238 test vector', () => {
    // RFC 6238 appendix B: SHA-1 secret "12345678901234567890", T = 59 s → 94287082 (last 6: 287082)
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpCode(secret, 59_000)).toBe('287082');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
  it('accepts the code from one step either side, not further', () => {
    const s = newTotpSecret();
    const now = Date.now();
    expect(checkTotp(s, totpCode(s, now - 30_000), now)).toBe(true);
    expect(checkTotp(s, totpCode(s, now - 120_000), now)).toBe(false);
    expect(checkTotp(s, 'abcdef', now)).toBe(false);
  });
});

describe('small rules', () => {
  it('seals and opens secrets; a changed one fails', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP');
    expect(unseal(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const [iv, tag, body] = sealed.split('.');
    expect(() => unseal([iv, tag, body.slice(0, -2) + 'AA'].join('.'))).toThrow();
  });
  it('keeps people to their own businesses', () => {
    expect(scopeOf({ id: 'u', role: 'admin', partnerId: null })).toEqual({});
    expect(scopeOf({ id: 'u', role: 'sales', partnerId: null })).toEqual({ onboardedById: 'u' });
    expect(scopeOf({ id: 'u', role: 'partner_staff', partnerId: 'p' })).toEqual({ partnerId: 'p' });
  });
  it('ends a trial at the end of its last day in India', () => {
    expect(trialEnd(new Date('2026-11-24T10:00:00Z'), 14).toISOString()).toBe('2026-12-08T18:29:59.000Z');
  });
  it('checks passwords and mobiles', () => {
    expect(passwordProblem('short1', 'a@b.c')).toMatch(/10 characters/);
    expect(passwordProblem('onlyletters!', 'a@b.c')).toMatch(/number/);
    expect(passwordProblem('rahul-2026-pass', 'rahul@x.in')).toMatch(/email/);
    expect(passwordProblem('Good-pass-2026', 'rahul@x.in')).toBeNull();
    expect(normaliseMobile('98765 43210')).toBe('+919876543210');
  });
});
