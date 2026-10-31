import { z } from 'zod';
import { TRIAL_LIMITS, TRIAL_PLAN_KEY } from './plans';
import { DEFAULT_PREFERENCES, FONTS } from './workspace';
import { gstin as gstinRule, gstinStateMismatch, sac as sacRule, stateName, upperNoSpaces } from './validation';

// Platform settings (design v2 §9): the definition lives in code, the value in `config_values`.
// A missing or invalid stored value falls back to the default here, so a bad row can never
// break signups. Admin edits arrive with the Console (Step 3).

const PlanLimitsSchema = z.object({
  users: z.number().int().positive(),
  branches: z.number().int().positive(),
  contacts: z.number().int().positive().nullable(),
  items: z.number().int().positive().nullable(),
  invoicesPerMonth: z.number().int().positive().nullable(),
  storageMb: z.number().int().positive(),
  aiCredits: z.number().int().min(0),
});

interface SettingDef<S extends z.ZodTypeAny> {
  description: string;
  schema: S;
  default: z.infer<S>;
}

const def = <S extends z.ZodTypeAny>(d: SettingDef<S>) => d;

export const SETTINGS = {
  'trial.days': def({ description: 'Length of the free trial in days', schema: z.number().int().min(1).max(90), default: 14 }),
  'trial.plan_key': def({ description: 'Plan a new trial tenant is subscribed to', schema: z.string().min(1).max(40), default: TRIAL_PLAN_KEY }),
  'trial.limits': def({ description: 'Usage limits during the trial', schema: PlanLimitsSchema, default: TRIAL_LIMITS }),
  'grace.days_monthly': def({ description: 'Grace days after a failed monthly renewal', schema: z.number().int().min(0).max(60), default: 7 }),
  'grace.days_yearly': def({ description: 'Grace days after a failed yearly renewal', schema: z.number().int().min(0).max(90), default: 14 }),
  'sales.discount_limits': def({
    description: 'Highest discount (%) each Console role may give without Admin approval',
    schema: z.record(z.string(), z.number().min(0).max(100)),
    default: { console_staff: 15, console_sales: 10, vendor: 5 } as Record<string, number>,
  }),
  'ahead.billing': def({
    description: "AHEAD's own details printed on invoices to clients (SAC and GST rate: confirm with the CA)",
    schema: z.object({
      legalName: z.string().trim().max(120),
      gstin: z.string().transform(upperNoSpaces).refine((v) => v === '' || !gstinRule(v), (v) => ({ message: gstinRule(v) ?? '' })),
      stateCode: z.string().refine((v) => v === '' || stateName(v) !== null, 'Choose a state from the list'),
      address: z.string().trim().max(300),
      sac: z.string().trim().refine((v) => !sacRule(v), 'SAC has 6 digits and starts with 99'),
      gstRateBp: z.number().int().min(0).max(2800),
    }).superRefine((v, c) => {
      const mismatch = gstinStateMismatch(v.gstin, v.stateCode);
      if (mismatch) c.addIssue({ code: z.ZodIssueCode.custom, path: ['gstin'], message: mismatch });
    }),
    default: { legalName: 'AHEAD Software', gstin: '', stateCode: '', address: '', sac: '998314', gstRateBp: 1800 },
  }),
  'referral.welcome_discount_percent': def({
    description: "Discount (%) on the first payment of a client who signed up with a vendor's or salesperson's link or code",
    schema: z.number().min(0).max(50),
    default: 10,
  }),
  'onboarding.unpaid_cancel_days': def({ description: 'Days a sales-created client may stay unpaid before the order lapses', schema: z.number().int().min(1).max(60), default: 14 }),
  // Console › Settings › Appearance: the theme every new business starts with. Copied into the
  // business when it is created, so a change never alters existing businesses.
  'defaults.branding': def({
    description: 'Theme every new business starts with: brand colour, font, appearance and density',
    schema: z.object({
      brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2450D8'),
      font: z.enum(FONTS.map((f) => f.key) as [string, ...string[]]),
      theme: z.enum(['light', 'dark', 'system']),
      density: z.enum(['comfortable', 'compact']),
    }),
    default: { ...DEFAULT_PREFERENCES.branding } as { brandColor: string; font: string; theme: 'light' | 'dark' | 'system'; density: 'comfortable' | 'compact' },
  }),
  'announcement.banner': def({
    description: 'One line shown on top of every client workspace (empty = none)',
    schema: z.object({ text: z.string().trim().max(200), tone: z.enum(['info', 'warning']), until: z.string().datetime().nullable() }).nullable(),
    default: null as { text: string; tone: 'info' | 'warning'; until: string | null } | null,
  }),
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
