// Phase 2 contract shared by the API and the web app (`@contracts/account`):
// personal preferences, workspace security policy, password policy checks and the
// notification events a business can switch on. Dependency-free.

import type { FontKey } from './workspace';

// ── My account › preferences (per person, every business) ──

export interface PersonalPreferences {
  /** "workspace" = follow the business default */
  theme: 'workspace' | 'light' | 'dark' | 'system';
  font: 'workspace' | FontKey;
  density: 'workspace' | 'comfortable' | 'compact';
  /** Page opened after sign-in: dashboard or a module key */
  startPage: string;
  dateFormat: 'd_mmm_yyyy' | 'dd_mm_yyyy' | 'yyyy_mm_dd';
  /** Team alerts this person muted, per channel */
  mutedAlerts: { email: string[]; inApp: string[] };
}

export const DEFAULT_PERSONAL: PersonalPreferences = {
  theme: 'workspace',
  font: 'workspace',
  density: 'workspace',
  startPage: 'dashboard',
  dateFormat: 'd_mmm_yyyy',
  mutedAlerts: { email: [], inApp: [] },
};

export const DATE_FORMATS: { key: PersonalPreferences['dateFormat']; label: string }[] = [
  { key: 'd_mmm_yyyy', label: '24 Oct 2026' },
  { key: 'dd_mm_yyyy', label: '24/10/2026' },
  { key: 'yyyy_mm_dd', label: '2026-10-24' },
];

export function personalWithDefaults(stored: unknown): PersonalPreferences {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<PersonalPreferences>;
  return { ...DEFAULT_PERSONAL, ...s, mutedAlerts: { ...DEFAULT_PERSONAL.mutedAlerts, ...(s.mutedAlerts ?? {}) } };
}

// ── Settings › Users & security (per business) ──

export type MfaPolicy = 'off' | 'admins' | 'everyone' | 'roles';

export interface SecurityPolicy {
  mfa: {
    policy: MfaPolicy;
    /** Role ids when policy = roles */
    roleIds: string[];
    graceDays: number;
    /** When the requirement started (grace counts from here) */
    since: string | null;
  };
  password: {
    minLength: number;
    requireNumber: boolean;
    requireSymbol: boolean;
    blockCommon: boolean;
    /** 0 = never */
    expiryDays: 0 | 90 | 180;
    /** How many previous passwords can't be reused (0 = no check) */
    reuseBlock: 0 | 3 | 5;
  };
  sessions: {
    /** Sign out after this many minutes without activity */
    idleMinutes: 30 | 120 | 480 | 1440 | 10080;
    /** Longest a sign-in lasts, in days */
    maxDays: 1 | 7 | 30;
  };
  /** CIDR list; empty = anywhere */
  ipAllowlist: string[];
}

export const DEFAULT_SECURITY: SecurityPolicy = {
  mfa: { policy: 'off', roleIds: [], graceDays: 7, since: null },
  password: { minLength: 8, requireNumber: true, requireSymbol: false, blockCommon: true, expiryDays: 0, reuseBlock: 0 },
  sessions: { idleMinutes: 10080, maxDays: 30 },
  ipAllowlist: [],
};

export function securityWithDefaults(stored: unknown): SecurityPolicy {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<SecurityPolicy>;
  return {
    mfa: { ...DEFAULT_SECURITY.mfa, ...(s.mfa ?? {}) },
    password: { ...DEFAULT_SECURITY.password, ...(s.password ?? {}) },
    sessions: { ...DEFAULT_SECURITY.sessions, ...(s.sessions ?? {}) },
    ipAllowlist: s.ipAllowlist ?? [],
  };
}

export const IDLE_OPTIONS: { value: SecurityPolicy['sessions']['idleMinutes']; label: string }[] = [
  { value: 30, label: '30 minutes' },
  { value: 120, label: '2 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '24 hours' },
  { value: 10080, label: '7 days' },
];

/** Strictest rules across the businesses a person belongs to. */
export function strictestPassword(policies: SecurityPolicy['password'][]): SecurityPolicy['password'] {
  return policies.reduce(
    (a, p) => ({
      minLength: Math.max(a.minLength, p.minLength),
      requireNumber: a.requireNumber || p.requireNumber,
      requireSymbol: a.requireSymbol || p.requireSymbol,
      blockCommon: a.blockCommon || p.blockCommon,
      expiryDays: (a.expiryDays === 0 ? p.expiryDays : p.expiryDays === 0 ? a.expiryDays : Math.min(a.expiryDays, p.expiryDays)) as 0 | 90 | 180,
      reuseBlock: Math.max(a.reuseBlock, p.reuseBlock) as 0 | 3 | 5,
    }),
    DEFAULT_SECURITY.password,
  );
}

/**
 * The rules for one person's password. Someone with a Console login follows the Console's rules
 * alone; everyone else follows the strictest of their businesses. `where` says where to change them.
 */
export function passwordRulesFor(consoleRules: SecurityPolicy['password'] | null, businesses: { name: string; password: SecurityPolicy['password'] }[]) {
  if (consoleRules) return { password: consoleRules, setBy: 'AHEAD Console', where: 'Console › Settings › Passwords' };
  // Name the business whose rule is the strictest, for the error message
  const strictest = businesses.reduce<{ name: string; len: number } | null>((a, x) => (x.password.minLength >= (a?.len ?? 0) ? { name: x.name, len: x.password.minLength } : a), null);
  return { password: strictestPassword(businesses.map((x) => x.password)), setBy: strictest?.name ?? null, where: strictest ? `${strictest.name}'s Settings › Users & security` : null };
}

// A short list of the passwords seen most in breaches (plus Indian favourites). The API
// also rejects anything containing the person's name, email or mobile.
const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123', 'qwerty123', 'qwertyuiop', '11111111', '00000000',
  'iloveyou', 'abc12345', 'abcd1234', 'admin123', 'welcome1', 'welcome123', 'letmein1', 'sunshine1', 'india123', 'india@123',
  'bharat123', 'krishna123', 'ganesh123', 'jaishreeram', 'sairam123', 'omsairam', 'mumbai123', 'delhi123', 'pass@123', 'test@123',
  'admin@123', 'p@ssw0rd', 'passw0rd', 'qwerty@123', 'asdf1234', 'zxcvbnm1', '987654321', '1q2w3e4r', '1qaz2wsx', 'changeme1',
])

/** Policy check for a new password; returns the first problem or null. */
export function passwordPolicyError(pw: string, p: SecurityPolicy['password'], personal: string[] = []): string | null {
  if (pw.length < p.minLength) return `Use at least ${p.minLength} characters`;
  if (pw.length > 64) return 'Use up to 64 characters';
  if (!/[A-Za-z]/.test(pw)) return 'Use at least one letter';
  if (p.requireNumber && !/\d/.test(pw)) return 'Add a number';
  if (p.requireSymbol && !/[^A-Za-z0-9]/.test(pw)) return 'Add a symbol, e.g. ! @ # $';
  const lower = pw.toLowerCase();
  if (p.blockCommon && COMMON.has(lower)) return 'This password is too common — choose another';
  for (const bit of personal.map((x) => x.toLowerCase()).filter((x) => x.length >= 4)) {
    if (lower.includes(bit)) return "Don't use your name, email or mobile in the password";
  }
  return null;
}

export function describePasswordPolicy(p: SecurityPolicy['password']) {
  const parts = [`${p.minLength}+ characters`, 'a letter'];
  if (p.requireNumber) parts.push('a number');
  if (p.requireSymbol) parts.push('a symbol');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ── IP allowlist ──

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** "49.36.112.0/24" or a single IPv4 address. Returns an error message or null. */
export function cidrError(entry: string): string | null {
  const [ip, bits] = entry.trim().split('/');
  if (ipv4ToInt(ip) === null) return `${entry} isn't an IPv4 address or range`;
  if (bits !== undefined && !(/^\d{1,2}$/.test(bits) && Number(bits) <= 32)) return `${entry}: the range must be /0 to /32`;
  return null;
}

/** True when the IP (IPv4, or IPv4-mapped IPv6) is inside one of the ranges. */
export function ipAllowed(ip: string | undefined, list: string[]): boolean {
  if (!list.length) return true;
  const v4 = ip?.startsWith('::ffff:') ? ip.slice(7) : ip;
  const addr = v4 ? ipv4ToInt(v4) : null;
  if (addr === null) return false;
  return list.some((entry) => {
    const [base, bitsStr] = entry.trim().split('/');
    const b = ipv4ToInt(base);
    if (b === null) return false;
    const bits = bitsStr === undefined ? 32 : Number(bitsStr);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((addr & mask) >>> 0) === ((b & mask) >>> 0);
  });
}

// ── Settings › Notifications ──

export type Channel = 'email' | 'sms' | 'whatsapp' | 'inApp';

export const CUSTOMER_EVENTS = [
  { key: 'invoice_issued', label: 'Invoice issued', hint: 'With the share link', vars: ['customer', 'business', 'number', 'amount', 'due_date', 'link'], required: ['link'] },
  { key: 'payment_received', label: 'Payment received', hint: 'Receipt details', vars: ['customer', 'business', 'number', 'amount', 'link'], required: [] },
  { key: 'invoice_overdue', label: 'Invoice overdue', hint: '1, 7 and 15 days after due', vars: ['customer', 'business', 'number', 'amount', 'due_date', 'link'], required: ['link'] },
  { key: 'appointment_booked', label: 'Appointment booked', hint: 'Right after booking', vars: ['customer', 'business', 'date', 'time', 'service'], required: [] },
  { key: 'appointment_reminder', label: 'Appointment reminder', hint: '24 h and 2 h before', vars: ['customer', 'business', 'date', 'time', 'service'], required: [] },
] as const;
export type CustomerEvent = (typeof CUSTOMER_EVENTS)[number]['key'];

export const TEAM_EVENTS = [
  { key: 'lead_assigned', label: 'Lead or customer assigned to me' },
  { key: 'task_assigned', label: 'Task assigned to me' },
  { key: 'task_due', label: 'My task is due' },
  { key: 'appointment_booked', label: 'Appointment booked with me' },
  { key: 'invoice_paid', label: 'Invoice paid' },
  { key: 'invite_accepted', label: 'Invite accepted' },
  { key: 'billing_notice', label: 'Trial and billing notices (owners)' },
] as const;
export type TeamEvent = (typeof TEAM_EVENTS)[number]['key'];

export interface MessageTemplate {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  subject: string;
  body: string;
}

export interface NotificationSettings {
  customer: Record<CustomerEvent, MessageTemplate>;
  team: Record<TeamEvent, { inApp: boolean; email: boolean }>;
  /** No SMS/WhatsApp between these hours (24 h clock, India time) */
  quietHours: { enabled: boolean; from: number; to: number };
  /** Most messages one customer gets per day */
  dailyCap: number;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  customer: {
    invoice_issued: { email: true, sms: false, whatsapp: false, subject: 'Invoice {number} from {business}', body: 'Hi {customer}, your invoice for {amount} is ready. View and pay: {link}\nThank you!' },
    payment_received: { email: true, sms: false, whatsapp: false, subject: 'Payment received — {business}', body: 'Hi {customer}, we received {amount} for invoice {number}. Thank you!' },
    invoice_overdue: { email: false, sms: false, whatsapp: false, subject: 'Reminder: invoice {number} is due', body: 'Hi {customer}, invoice {number} for {amount} was due on {due_date}. Pay here: {link}' },
    appointment_booked: { email: true, sms: false, whatsapp: false, subject: 'Your appointment at {business}', body: 'Hi {customer}, your {service} is booked for {date} at {time}. See you soon!' },
    appointment_reminder: { email: true, sms: false, whatsapp: false, subject: 'Reminder: {service} on {date}', body: 'Hi {customer}, a reminder of your {service} on {date} at {time}.' },
  },
  team: {
    lead_assigned: { inApp: true, email: false },
    task_assigned: { inApp: true, email: false },
    task_due: { inApp: true, email: false },
    appointment_booked: { inApp: true, email: false },
    invoice_paid: { inApp: true, email: false },
    invite_accepted: { inApp: true, email: true },
    billing_notice: { inApp: true, email: true },
  },
  quietHours: { enabled: true, from: 21, to: 9 },
  dailyCap: 3,
};

export function notificationsWithDefaults(stored: unknown): NotificationSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<NotificationSettings>;
  const customer = { ...DEFAULT_NOTIFICATIONS.customer };
  for (const k of Object.keys(customer) as CustomerEvent[]) customer[k] = { ...customer[k], ...(s.customer?.[k] ?? {}) };
  const team = { ...DEFAULT_NOTIFICATIONS.team };
  for (const k of Object.keys(team) as TeamEvent[]) team[k] = { ...team[k], ...(s.team?.[k] ?? {}) };
  return { customer, team, quietHours: { ...DEFAULT_NOTIFICATIONS.quietHours, ...(s.quietHours ?? {}) }, dailyCap: s.dailyCap ?? DEFAULT_NOTIFICATIONS.dailyCap };
}

/** Fill {variables}; unknown ones stay as typed. */
export function renderTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{([a-z_]+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Variables used in a template that the event doesn't provide, and required ones missing. */
export function templateProblems(event: CustomerEvent, t: Pick<MessageTemplate, 'subject' | 'body'>): string | null {
  const def = CUSTOMER_EVENTS.find((e) => e.key === event)!;
  const used = [...`${t.subject} ${t.body}`.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
  const unknown = used.filter((u) => !(def.vars as readonly string[]).includes(u));
  if (unknown.length) return `Unknown variable: {${unknown[0]}}`;
  const missing = (def.required as readonly string[]).filter((r) => !used.includes(r));
  if (missing.length) return `Keep {${missing[0]}} in the message`;
  if (!t.body.trim()) return 'The message is empty';
  return null;
}

// ── Settings › Roles › Field access ──

export const SENSITIVE_FIELDS = [
  { entity: 'item', field: 'cost_price', label: 'Cost price', hint: 'Products & services', module: 'catalog' },
  { entity: 'contact', field: 'phone_export', label: 'Phone numbers in exports', hint: 'Customers', module: 'crm' },
  { entity: 'employee', field: 'salary', label: 'Salary', hint: 'Employees', module: 'hr' },
  { entity: 'employee', field: 'bank_account', label: 'Bank account', hint: 'Employees', module: 'hr' },
] as const;

/**
 * Matrix rules for a custom role, by resource (module.resource): View is needed before any
 * other action, and Delete needs Edit. Returns the first problem or null.
 */
export function rolePermissionProblem(keys: string[], catalog: string[]): string | null {
  const all = new Set(catalog);
  const byResource = new Map<string, Set<string>>();
  for (const k of keys) {
    const [m, r, a] = k.split('.');
    const id = `${m}.${r}`;
    if (!byResource.has(id)) byResource.set(id, new Set());
    byResource.get(id)!.add(a);
  }
  for (const [id, actions] of byResource) {
    if (all.has(`${id}.view`) && !actions.has('view') && actions.size) return `${id}: turn on View before other actions`;
    if (all.has(`${id}.edit`) && actions.has('delete') && !actions.has('edit')) return `${id}: Delete needs Edit`;
  }
  return null;
}
