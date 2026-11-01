import { describe, expect, it } from 'vitest';
import { FONTS, INDUSTRIES, THEME_PRESETS, brandColorError, contrastRatio, industryByKey, industryKeysFor, industryName, industryTemplateKey, prefixError, previewNumber, storedIndustryKey, withDefaults } from '../contracts/workspace';
import { SETTINGS } from '../contracts/settings';
import { BusinessSignup, PREFERENCE_SCHEMAS, SetupPatch, signupToTenant } from '../modules/tenancy/workspace';

// Phase 1: signup v2 answers, workspace preferences and setup-wizard input (no database).

const VALID = {
  businessName: 'Glow Studio',
  businessType: 'partnership',
  gstRegistered: true,
  gstin: '27AAPFU0939F1ZV',
  stateCode: '27',
  teamSize: '2_5',
  branches: '1',
  industryKey: 'salon',
  goals: ['billing'],
  termsAccepted: true,
};

const fields = (r: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) => (r.success ? [] : r.error!.issues.map((i) => i.path.join('.')));

describe('signup v2 business answers', () => {
  it('accepts a complete answer set and maps it onto the tenant', () => {
    const b = BusinessSignup.parse(VALID);
    const t = signupToTenant(b);
    expect(t).toMatchObject({ businessName: 'Glow Studio', industryKey: 'beauty_wellness', gstin: '27AAPFU0939F1ZV', billingStateCode: '27' });
    expect(t.profile).toMatchObject({ businessType: 'partnership', pan: 'AAPFU0939F', goals: ['billing'], industry: 'beauty_wellness' });
  });

  it('needs a GSTIN when registered, matching the state', () => {
    expect(fields(BusinessSignup.safeParse({ ...VALID, gstin: '' }))).toContain('gstin');
    expect(fields(BusinessSignup.safeParse({ ...VALID, stateCode: '24' }))).toContain('gstin');
    // AAPFU… is a firm's PAN, so it can't be a proprietor's GSTIN
    expect(fields(BusinessSignup.safeParse({ ...VALID, businessType: 'proprietor' }))).toContain('gstin');
    expect(BusinessSignup.safeParse({ ...VALID, gstRegistered: false, gstin: '' }).success).toBe(true);
  });

  it('requires terms, at least one goal and a known industry', () => {
    expect(fields(BusinessSignup.safeParse({ ...VALID, termsAccepted: false, goals: [], industryKey: 'spaceships' }))).toEqual(expect.arrayContaining(['termsAccepted', 'goals', 'industryKey']));
  });

  it('starts an industry without its own template on the closest one and remembers the choice', () => {
    const t = signupToTenant(BusinessSignup.parse({ ...VALID, industryKey: 'clinic' }));
    expect(t.industryKey).toBe('health');
    expect(t.profile).toMatchObject({ industry: 'health', industryRequested: 'Health Care' });
    expect(fields(BusinessSignup.safeParse({ ...VALID, industryKey: 'other', industryRequested: '' }))).toContain('industryRequested');
  });
});

describe('workspace preferences', () => {
  it('keeps invoice numbers within the GST 16-character limit', () => {
    expect(previewNumber('INV/{FY}/', '26-27', 1)).toBe('INV/26-27/0001');
    expect(prefixError('INV/{FY}/')).toBeNull();
    expect(prefixError('GLOWSTUDIO/{FY}/')).toMatch(/Too long/);
    expect(prefixError('INV {FY}')).toMatch(/letters, digits/);
    expect(prefixError('INV/{YEAR}/')).toMatch(/letters, digits/);
  });

  it('refuses brand colours too light for white text', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(brandColorError('#2450D8')).toBeNull();
    expect(brandColorError('#FFD54F')).toMatch(/Too light/);
    expect(brandColorError('blue')).toMatch(/#2450D8/);
  });

  it('validates bank details as a set and UPI on its own', () => {
    const ok = { bankHolder: 'Asha Rao', bankAccount: '5010 0212 345678', ifsc: 'hdfc0001234', upiId: 'glow@okhdfc', showUpiQr: true };
    expect(PREFERENCE_SCHEMAS.payments.parse(ok)).toMatchObject({ bankAccount: '50100212345678', ifsc: 'HDFC0001234' });
    expect(fields(PREFERENCE_SCHEMAS.payments.safeParse({ ...ok, ifsc: '' }))).toContain('ifsc');
    expect(fields(PREFERENCE_SCHEMAS.payments.safeParse({ ...ok, upiId: '', showUpiQr: true }))).toContain('upiId');
    expect(PREFERENCE_SCHEMAS.payments.safeParse({ bankHolder: '', bankAccount: '', ifsc: '', upiId: '', showUpiQr: false }).success).toBe(true);
  });

  it('needs a composition rate when composition is on', () => {
    const t = { composition: true, compositionRateBp: null, pricesIncludeTax: true, defaultGstRateBp: 1800, hsnDigits: 4, reverseCharge: false };
    expect(fields(PREFERENCE_SCHEMAS.taxes.safeParse(t))).toContain('compositionRateBp');
    expect(PREFERENCE_SCHEMAS.taxes.safeParse({ ...t, compositionRateBp: 100 }).success).toBe(true);
  });

  it('fills sections saved before a setting existed', () => {
    const p = withDefaults({ documents: { invoicePrefix: 'GS/{FY}/' } });
    expect(p.documents).toMatchObject({ invoicePrefix: 'GS/{FY}/', quotationPrefix: 'QT/{FY}/' });
    expect(p.branding.brandColor).toBe('#2450D8');
  });

  it('accepts only known wizard steps and actions', () => {
    expect(SetupPatch.safeParse({ step: 'profile', state: 'done' }).success).toBe(true);
    expect(SetupPatch.safeParse({ step: 'payroll', state: 'done' }).success).toBe(false);
    expect(SetupPatch.safeParse({ action: 'defer' }).success).toBe(true);
  });
});

describe('industries', () => {
  it('lists them A to Z with Other last', () => {
    const names = INDUSTRIES.map((i) => i.name);
    expect(names.at(-1)).toBe('Other');
    expect(names.slice(0, -1)).toEqual([...names.slice(0, -1)].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps businesses and leads saved with the old keys working', () => {
    expect(industryName('salon')).toBe('Beauty & Wellness');
    expect(industryTemplateKey('salon')).toBe('salon');
    expect(industryTemplateKey('pharmacy')).toBe('pharmacy');
    expect(industryKeysFor('health')).toEqual(expect.arrayContaining(['health', 'pharmacy', 'clinic']));
    expect(industryByKey('nothing')).toBeUndefined();
  });

  it('gives every industry a starter template, and a sub-type its own when it has one', () => {
    for (const i of INDUSTRIES) expect(industryTemplateKey(i.key)).toBeTruthy();
    expect(storedIndustryKey('health', 'Pharmacy')).toBe('pharmacy');
    expect(storedIndustryKey('health', 'Clinic')).toBe('health');
    expect(industryTemplateKey(storedIndustryKey('beauty_wellness'))).toBe('salon');
  });
});

describe('colour themes', () => {
  it('has nine themes with buttons that read well in light and dark', () => {
    expect(THEME_PRESETS).toHaveLength(9);
    for (const p of THEME_PRESETS) {
      expect(brandColorError(p.primary)).toBeNull();
      expect(contrastRatio(p.primaryDark, p.scale[0])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('reads a stored look from before themes existed, and keeps a chosen theme', () => {
    const schema = SETTINGS['defaults.branding'].schema;
    expect(schema.parse({ brandColor: '#BE123C', font: 'inter', theme: 'dark', density: 'compact' }).preset).toBe('default');
    expect(schema.parse({ brandColor: '#235347', preset: 'evergreen', font: FONTS[1].key, density: 'comfortable' })).toMatchObject({ preset: 'evergreen', font: 'roboto', theme: 'system' });
  });
});
