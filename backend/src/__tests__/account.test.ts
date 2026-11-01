import { describe, expect, it } from 'vitest';
import { base32Encode, decryptSecret, encryptSecret, hashBackupCode, newBackupCodes, newSecret, totp, verifyTotp } from '../modules/account/totp';
import {
  DEFAULT_NOTIFICATIONS, DEFAULT_SECURITY, cidrError, ipAllowed, notificationsWithDefaults, passwordPolicyError, renderTemplate, rolePermissionProblem,
  passwordRulesFor, securityWithDefaults, strictestPassword, templateProblems,
} from '../contracts/account';
import { policyCovers } from '../modules/account/policy';
import { csv, xlsx, zip } from '../kernel/zip';
import { SecurityInput } from '../modules/tenancy/security';
import { NotificationsInput } from '../modules/tenancy/messages';
import { ExportQuery } from '../modules/tenancy/data';
import { PERMISSIONS } from '../contracts/permissions';

// Phase 2: two-step verification, password and security policy, roles matrix rules,
// notification templates and export files (no database).

describe('two-step verification (RFC 6238)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC test vectors', () => {
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1_111_111_109_000)).toBe('081804');
    expect(totp(secret, 1_234_567_890_000)).toBe('005924');
  });

  it('accepts the previous and next 30 s step for clock drift, nothing further', () => {
    const at = 1_234_567_890_000;
    expect(verifyTotp(secret, totp(secret, at - 30_000), at)).toBe(true);
    expect(verifyTotp(secret, totp(secret, at + 30_000), at)).toBe(true);
    expect(verifyTotp(secret, totp(secret, at - 90_000), at)).toBe(false);
    expect(verifyTotp(secret, 'abc123', at)).toBe(false);
  });

  it('stores the secret encrypted and makes 10 one-time backup codes', () => {
    const s = newSecret();
    const enc = encryptSecret(s);
    expect(enc).not.toContain(s);
    expect(decryptSecret(enc)).toBe(s);
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/));
    // Typed without the dash or in lower case still matches
    expect(hashBackupCode(codes[0].toLowerCase().replace('-', ''))).toBe(hashBackupCode(codes[0]));
  });
});

describe('password policy', () => {
  it('applies the strictest rule across businesses', () => {
    const p = strictestPassword([
      { ...DEFAULT_SECURITY.password, minLength: 10, requireSymbol: true, expiryDays: 180, reuseBlock: 3 },
      { ...DEFAULT_SECURITY.password, minLength: 8, expiryDays: 90 },
    ]);
    expect(p).toMatchObject({ minLength: 10, requireSymbol: true, expiryDays: 90, reuseBlock: 3 });
  });

  it('rejects short, common and personal passwords', () => {
    const p = { ...DEFAULT_SECURITY.password, minLength: 10, requireSymbol: true };
    expect(passwordPolicyError('glowstud1', p)).toMatch(/at least 10/);
    expect(passwordPolicyError('glowstudio12', p)).toMatch(/symbol/);
    expect(passwordPolicyError('password123', DEFAULT_SECURITY.password)).toMatch(/too common/);
    expect(passwordPolicyError('asha2026!x', p, ['Asha'])).toMatch(/name, email or mobile/);
    expect(passwordPolicyError('Tr4vel!ing-far', p)).toBeNull();
  });
});

describe('workspace security policy', () => {
  it('covers people by role', () => {
    const mfa = { ...DEFAULT_SECURITY.mfa, policy: 'admins' as const };
    expect(policyCovers(mfa, { id: 'r1', key: 'owner' })).toBe(true);
    expect(policyCovers(mfa, { id: 'r2', key: 'staff' })).toBe(false);
    expect(policyCovers({ ...mfa, policy: 'roles', roleIds: ['r2'] }, { id: 'r2', key: 'staff' })).toBe(true);
    expect(policyCovers({ ...mfa, policy: 'off' }, { id: 'r1', key: 'owner' })).toBe(false);
  });

  it('checks IP ranges', () => {
    expect(cidrError('49.36.112.0/24')).toBeNull();
    expect(cidrError('49.36.112.0/33')).toMatch(/\/0 to \/32/);
    expect(cidrError('office wifi')).toMatch(/isn't an IPv4/);
    expect(ipAllowed('49.36.112.18', ['49.36.112.0/24'])).toBe(true);
    expect(ipAllowed('::ffff:49.36.112.18', ['49.36.112.0/24'])).toBe(true);
    expect(ipAllowed('49.36.113.18', ['49.36.112.0/24'])).toBe(false);
    expect(ipAllowed('1.2.3.4', [])).toBe(true);
  });

  it('validates the settings form', () => {
    const base = { policy: { ...securityWithDefaults({}), mfa: { policy: 'admins', roleIds: [], graceDays: 7 } }, reason: 'Owner asked for stricter sign-in rules' };
    expect(SecurityInput.safeParse(base).success).toBe(true);
    expect(SecurityInput.safeParse({ ...base, reason: 'short' }).success).toBe(false);
    expect(SecurityInput.safeParse({ ...base, policy: { ...base.policy, password: { ...base.policy.password, minLength: 6 } } }).success).toBe(false);
    expect(SecurityInput.safeParse({ ...base, policy: { ...base.policy, sessions: { idleMinutes: 45, maxDays: 30 } } }).success).toBe(false);
  });
});

describe('roles matrix rules', () => {
  const catalog = PERMISSIONS.map((p) => p.key);
  it('needs View before other actions and Edit before Delete', () => {
    expect(rolePermissionProblem(['crm.contact.view', 'crm.contact.create'], catalog)).toBeNull();
    expect(rolePermissionProblem(['crm.contact.create'], catalog)).toMatch(/View/);
    expect(rolePermissionProblem(['crm.contact.view', 'crm.contact.delete'], catalog)).toMatch(/Delete needs Edit/);
    // Resources without a View action (data export) are fine on their own
    expect(rolePermissionProblem(['tenant.data.export'], catalog)).toBeNull();
  });
});

describe('notification templates', () => {
  it('fills variables and keeps the required link', () => {
    expect(renderTemplate('Hi {customer}, pay {amount}: {link}', { customer: 'Meera', amount: '₹1,770.00', link: 'x.in/d/1' })).toBe('Hi Meera, pay ₹1,770.00: x.in/d/1');
    expect(templateProblems('invoice_issued', { subject: 'Invoice', body: 'Hi {customer}' })).toMatch(/\{link\}/);
    expect(templateProblems('invoice_issued', { subject: 'Invoice', body: 'Hi {name} {link}' })).toMatch(/Unknown variable/);
    expect(templateProblems('payment_received', { subject: 'Thanks', body: 'Hi {customer}' })).toBeNull();
  });

  it('accepts the defaults and refuses SMS without a provider', () => {
    const s = notificationsWithDefaults({});
    expect(NotificationsInput.safeParse(s).success).toBe(true);
    const sms = { ...s, customer: { ...s.customer, invoice_issued: { ...s.customer.invoice_issued, sms: true } } };
    expect(NotificationsInput.safeParse(sms).success).toBe(false);
    expect(DEFAULT_NOTIFICATIONS.quietHours).toEqual({ enabled: true, from: 21, to: 9 });
  });
});

describe('export files', () => {
  it('parses the export choice', () => {
    expect(ExportQuery.parse({ what: 'customers,invoices', period: 'fy', format: 'xlsx' })).toEqual({ what: ['customers', 'invoices'], period: 'fy', format: 'xlsx' });
    expect(ExportQuery.safeParse({ what: '' }).success).toBe(false);
    expect(ExportQuery.safeParse({ what: 'salaries' }).success).toBe(false);
  });

  it('writes CSV that spreadsheets open safely', () => {
    const out = csv([['Name', 'Mobile', 'Note'], ['Meera, K', '+919876543210', '=HYPERLINK("x")']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toContain('"Meera, K"');
    expect(out).toContain('+919876543210');
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('writes valid ZIP and XLSX containers', () => {
    const z = zip([{ name: 'a.csv', data: 'x' }, { name: 'b.csv', data: 'y' }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(z.readUInt16LE(z.length - 22 + 10)).toBe(2);
    const book = xlsx([{ name: 'Invoices', rows: [['Number', 'Total (₹)'], ['GS/26-27/0101', 1770]] }]);
    const text = book.toString('utf8');
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('<v>1770</v>');
  });
});

describe('whose password rules apply', () => {
  const business = { name: 'Renvix', password: { ...DEFAULT_SECURITY.password, minLength: 32, requireSymbol: true } };
  const consoleRules = { ...DEFAULT_SECURITY.password, minLength: 12 };

  it('uses only the Console rules for someone with a Console login', () => {
    expect(passwordRulesFor(consoleRules, [business])).toMatchObject({ password: { minLength: 12, requireSymbol: false }, setBy: 'AHEAD Console', where: 'Console › Settings › Passwords' });
  });

  it('uses the strictest business for everyone else, and names it', () => {
    const r = passwordRulesFor(null, [{ name: 'Glow', password: DEFAULT_SECURITY.password }, business]);
    expect(r).toMatchObject({ password: { minLength: 32, requireSymbol: true }, setBy: 'Renvix', where: "Renvix's Settings › Users & security" });
    expect(passwordRulesFor(null, [])).toMatchObject({ password: DEFAULT_SECURITY.password, setBy: null, where: null });
  });
});
