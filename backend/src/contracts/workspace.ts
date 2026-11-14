// Workspace profile, preferences and setup-wizard contract (Phase 1). Dependency-free so
// the web app imports the same option lists and defaults (`@contracts/workspace`); the API
// validates with Zod in modules/tenancy/workspace.ts.

import type { BusinessType } from './validation';

export const TEAM_SIZES = ['just_me', '2_5', '6_20', '21_50', '51_plus'] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];
export const TEAM_SIZE_LABEL: Record<TeamSize, string> = { just_me: 'Just me', '2_5': '2–5 people', '6_20': '6–20 people', '21_50': '21–50 people', '51_plus': '51+ people' };

export const BRANCH_BANDS = ['1', '2_5', '6_20', '21_plus'] as const;
export type BranchBand = (typeof BRANCH_BANDS)[number];
export const BRANCH_BAND_LABEL: Record<BranchBand, string> = { '1': '1 location', '2_5': '2–5 locations', '6_20': '6–20 locations', '21_plus': '21+ locations' };

export const GOALS = [
  { key: 'billing', label: 'Billing & GST invoices', description: 'Invoices, receipts, dues', modules: ['billing', 'catalog'] },
  { key: 'bookings', label: 'Appointments', description: 'Calendar, no double booking', modules: ['bookings'] },
  { key: 'customers', label: 'Customers', description: 'Contacts, follow-ups', modules: ['crm'] },
  { key: 'stock', label: 'Stock & purchases', description: 'Products, suppliers', modules: ['inventory', 'catalog'] },
  { key: 'staff', label: 'Staff & payroll', description: 'Attendance, salary', modules: ['hr'] },
  { key: 'accounts', label: 'Expenses & accounts', description: 'Spends, P&L', modules: ['finance'] },
  { key: 'quotes', label: 'Quotations & orders', description: 'Quotes → invoices', modules: ['sales', 'catalog'] },
  { key: 'tasks', label: 'Tasks & team work', description: 'To-dos, checklists', modules: ['tasks'] },
  { key: 'support', label: 'Customer support', description: 'Tickets, complaints', modules: ['support'] },
] as const;
export type GoalKey = (typeof GOALS)[number]['key'];

/**
 * Industries offered everywhere (signup, Console, leads), one broad category each. `template`
 * is the starter setup a business gets; `subTemplates` picks a more specific one for a sub-type
 * (a pharmacy within Health Care). `ready: false` starts on the closest template and the choice
 * is kept in the profile for the product team. Listed A to Z, with Other last.
 */
export interface Industry { key: string; name: string; template: string; ready: boolean; sub: string[]; keywords?: string; subTemplates?: Record<string, string> }
export const INDUSTRIES: Industry[] = [
  { key: 'agency', name: 'Agency & Marketing', template: 'services', ready: false, sub: ['Advertising agency', 'Digital marketing', 'Sales house', 'PR & communications'], keywords: 'advertising media buying seo social' },
  { key: 'agriculture', name: 'Agriculture', template: 'retail', ready: false, sub: ['Farming', 'Seeds & fertiliser', 'Dairy', 'Food processing'], keywords: 'farm agri krishi dairy' },
  { key: 'art_design', name: 'Art & Design', template: 'services', ready: false, sub: ['Graphic design', 'Interior design', 'Photography', 'Art studio'], keywords: 'studio creative interior' },
  { key: 'automotive', name: 'Automotive', template: 'services', ready: false, sub: ['Vehicle dealer', 'Garage & service centre', 'Spare parts', 'Car wash'], keywords: 'car bike garage workshop' },
  { key: 'beauty_wellness', name: 'Beauty & Wellness', template: 'salon', ready: true, sub: ['Salon', 'Spa', "Men's barber", 'Bridal studio', 'Nail / lash studio'], keywords: 'salon spa parlour barber makeup' },
  { key: 'construction', name: 'Construction', template: 'services', ready: false, sub: ['Builder', 'Contractor', 'Architect', 'Building materials'], keywords: 'builder contractor civil' },
  { key: 'consulting', name: 'Consulting', template: 'services', ready: false, sub: ['Business consulting', 'HR & recruitment', 'Training', 'Freelancer'], keywords: 'advisor consultant freelance' },
  { key: 'consumer_goods', name: 'Consumer Goods', template: 'retail', ready: false, sub: ['FMCG', 'Personal care', 'Packaged food', 'Home products'], keywords: 'fmcg cpg packaged' },
  { key: 'education', name: 'Education', template: 'school', ready: true, sub: ['School', 'Coaching institute', 'Pre-school', 'Training centre', 'Music / art classes'], keywords: 'school coaching tuition classes institute' },
  { key: 'engineering', name: 'Engineering', template: 'services', ready: false, sub: ['Mechanical', 'Electrical', 'Civil', 'Fabrication'], keywords: 'fabrication workshop' },
  { key: 'entertainment', name: 'Entertainment & Events', template: 'services', ready: false, sub: ['Event management', 'Gaming', 'Film & music', 'Venue'], keywords: 'events wedding gaming film' },
  { key: 'financial', name: 'Financial Services', template: 'services', ready: false, sub: ['Chartered accountant', 'Tax consultant', 'Insurance', 'Loans & NBFC'], keywords: 'ca accountant tax insurance' },
  { key: 'fitness', name: 'Fitness & Sports', template: 'gym', ready: true, sub: ['Gym', 'Yoga studio', 'Dance studio', 'Sports academy'], keywords: 'gym yoga crossfit' },
  { key: 'food', name: 'Food Services', template: 'retail', ready: false, sub: ['Restaurant', 'Café', 'Cloud kitchen', 'Bakery', 'Sweet shop', 'Catering'], keywords: 'restaurant cafe hotel kitchen fast food' },
  { key: 'government', name: 'Government', template: 'services', ready: false, sub: ['Department', 'Public undertaking', 'Local body'], keywords: 'public sector psu' },
  { key: 'health', name: 'Health Care', template: 'services', ready: false, sub: ['Clinic', 'Hospital', 'Diagnostic lab', 'Pharmacy', 'Veterinary'], keywords: 'doctor dental pharmacy chemist medical lab', subTemplates: { Pharmacy: 'pharmacy' } },
  { key: 'hospitality', name: 'Hospitality & Travel', template: 'services', ready: false, sub: ['Hotel', 'Homestay / resort', 'PG / hostel', 'Travel agency'], keywords: 'hotel rooms lodge tour ticketing' },
  { key: 'legal', name: 'Legal', template: 'services', ready: false, sub: ['Law firm', 'Advocate', 'Company secretary'], keywords: 'lawyer advocate' },
  { key: 'logistics', name: 'Logistics & Transport', template: 'services', ready: false, sub: ['Transporter', 'Courier', 'Warehousing', 'Packers & movers'], keywords: 'transport courier' },
  { key: 'manufacturing', name: 'Manufacturing', template: 'retail', ready: false, sub: ['Food processing', 'Garments & textiles', 'Plastics', 'Printing', 'Machinery'], keywords: 'factory production' },
  { key: 'mining', name: 'Mining & Energy', template: 'services', ready: false, sub: ['Mining', 'Oil & gas', 'Solar & renewables', 'Power'], keywords: 'solar energy minerals' },
  { key: 'non_profit', name: 'Non-Profit', template: 'services', ready: false, sub: ['Charitable trust', 'Society', 'Section 8 company'], keywords: 'ngo charity donation trust' },
  { key: 'publishing', name: 'Publishing & Media', template: 'services', ready: false, sub: ['Publisher', 'Web media', 'Writers', 'Print media'], keywords: 'writer content news magazine' },
  { key: 'real_estate', name: 'Real Estate', template: 'services', ready: false, sub: ['Real estate agent', 'Developer', 'Property management', 'Co-working'], keywords: 'property broker rental' },
  { key: 'retail', name: 'Retail', template: 'retail', ready: true, sub: ['Kirana / grocery', 'Apparel & footwear', 'Electronics & mobiles', 'Jewellery', 'Optical', 'E-commerce', 'Hardware', 'Furniture'], keywords: 'shop store kirana ecommerce offline' },
  { key: 'services', name: 'Services', template: 'services', ready: true, sub: ['Repairs & AMC', 'Facility services', 'Cleaning & pest control', 'Security', 'Other services'], keywords: 'repair amc field service' },
  { key: 'technology', name: 'Technology', template: 'services', ready: false, sub: ['Software company', 'Web design', 'Web development', 'IT services', 'SaaS'], keywords: 'it software web developer app' },
  { key: 'telecom', name: 'Telecommunications', template: 'services', ready: false, sub: ['Internet provider', 'Telecom dealer', 'Installation'], keywords: 'isp broadband' },
  { key: 'wholesale', name: 'Wholesale & Distribution', template: 'retail', ready: false, sub: ['FMCG distributor', 'Stockist', 'Trader', 'Import / export'], keywords: 'distributor trader stockist' },
  { key: 'other', name: 'Other', template: 'services', ready: true, sub: [] },
];

/** Keys used before the list above; businesses and leads saved with them keep working. */
const OLD_INDUSTRY_KEYS: Record<string, string> = {
  salon: 'beauty_wellness', gym: 'fitness', school: 'education', pharmacy: 'health', clinic: 'health', lab: 'health', apparel: 'retail', electronics: 'retail', jewellery: 'retail', optical: 'retail',
  restaurant: 'food', hotel: 'hospitality', travel: 'hospitality', professional: 'financial', repairs: 'services', ngo: 'non_profit',
};
export const industryByKey = (key: string | null | undefined) => (key ? INDUSTRIES.find((i) => i.key === (OLD_INDUSTRY_KEYS[key] ?? key)) : undefined);
export const industryName = (key: string | null | undefined) => industryByKey(key)?.name ?? (key ? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
/** Every stored key that means this industry, for filtering lists. */
export const industryKeysFor = (key: string) => [key, ...Object.keys(OLD_INDUSTRY_KEYS).filter((k) => OLD_INDUSTRY_KEYS[k] === key)];
/** The starter template a stored industry key sets up. Old keys that are also templates stay on theirs. */
export const industryTemplateKey = (key: string) => (['salon', 'gym', 'school', 'pharmacy', 'retail', 'services'].includes(key) ? key : industryByKey(key)?.template);
/** What to store for a choice: the industry, or the sub-type's own template when it has one. */
export function storedIndustryKey(key: string, sub?: string | null) {
  const industry = industryByKey(key);
  return (sub && industry?.subTemplates?.[sub]) || industry?.key || key;
}

export const HEARD_FROM = ['Google search', 'Instagram / Facebook', 'YouTube', 'A friend or another business', 'Our accountant / CA', 'AHEAD sales team', 'Other'] as const;

/** Answers given at signup (and later in Settings › Organization). */
export interface WorkspaceProfile {
  businessType?: BusinessType;
  gstRegistered?: boolean;
  pan?: string | null;
  teamSize?: TeamSize;
  branches?: BranchBand;
  subIndustry?: string | null;
  /** Free text when the industry is "Other" or has no template yet */
  industryRequested?: string | null;
  goals?: GoalKey[];
  /** Modules the owner wants first in the menu (order matters) */
  modules?: string[];
  heardFrom?: string | null;
  /** Phone and email printed on documents (default: the owner's) */
  phone?: string | null;
  email?: string | null;
  /** Business-wide formats (Settings › Organization); a person can pick their own date format */
  dateFormat?: 'd_mmm_yyyy' | 'dd_mm_yyyy' | 'yyyy_mm_dd';
  numberFormat?: 'indian' | 'international';
  weekStart?: 'monday' | 'sunday';
}

export const DOC_TEMPLATES = [
  { key: 'classic', label: 'Classic' },
  { key: 'modern', label: 'Modern' },
  { key: 'compact', label: 'Compact' },
] as const;
export type DocTemplate = (typeof DOC_TEMPLATES)[number]['key'];

export const BRAND_COLORS = [
  { name: 'Blue', hex: '#2450D8' },
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Teal', hex: '#0F766E' },
  { name: 'Green', hex: '#15803D' },
  { name: 'Plum', hex: '#86198F' },
  { name: 'Rose', hex: '#BE123C' },
  { name: 'Orange', hex: '#C2410C' },
  { name: 'Slate', hex: '#334155' },
] as const;

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Brand colours carry white text (buttons, active menu), so they need 4.5:1 against white. */
export function brandColorError(hex: string): string | null {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return 'Use a colour like #2450D8';
  const ratio = contrastRatio(hex, '#FFFFFF');
  return ratio < 4.5 ? `Too light for white text (${ratio.toFixed(1)}:1, needs 4.5:1) — pick a darker shade` : null;
}

/**
 * Colour themes for the whole product. `scale` runs darkest to lightest and sets the page, cards,
 * text and accents in both modes; `primary` carries white text in light mode, `primaryDark` sits
 * on the dark page in dark mode. The light and dark switch itself belongs to each person.
 */
export interface ThemePreset { key: string; name: string; scale: [string, string, string, string, string, string]; primary: string; primaryDark: string }
export const THEME_PRESETS: ThemePreset[] = [
  { key: 'default', name: 'AHEAD Blue', scale: ['#0F1115', '#171A20', '#1D3FA8', '#2450D8', '#C9D5F7', '#EEF2FD'], primary: '#2450D8', primaryDark: '#5B82F0' },
  { key: 'midnight', name: 'Midnight', scale: ['#06141B', '#11212D', '#253745', '#4A5C6A', '#9BA8AB', '#CCD0CF'], primary: '#253745', primaryDark: '#9BA8AB' },
  { key: 'evergreen', name: 'Evergreen', scale: ['#051F20', '#0B2B26', '#163832', '#235347', '#8EB69B', '#DAF1DE'], primary: '#235347', primaryDark: '#8EB69B' },
  { key: 'mauve', name: 'Mauve', scale: ['#3E3239', '#6B5560', '#9E8189', '#C7A9A3', '#E8D2C4', '#F7EFE7'], primary: '#6B5560', primaryDark: '#C7A9A3' },
  { key: 'ocean', name: 'Ocean', scale: ['#062A3A', '#0B3F57', '#0E7490', '#38A3C4', '#A5D8E6', '#E3F4F8'], primary: '#0E7490', primaryDark: '#38A3C4' },
  { key: 'sunset', name: 'Sunset', scale: ['#2B120C', '#4A2013', '#C2410C', '#E8804A', '#F7C9A9', '#FCEEE3'], primary: '#C2410C', primaryDark: '#E8804A' },
  { key: 'royal', name: 'Royal', scale: ['#1C0F33', '#2F1A55', '#6D28D9', '#9A6BE8', '#CDB8F3', '#F1EAFD'], primary: '#6D28D9', primaryDark: '#9A6BE8' },
  { key: 'ruby', name: 'Ruby', scale: ['#2B0813', '#4A1024', '#BE123C', '#E25A7B', '#F5B8C6', '#FDECEF'], primary: '#BE123C', primaryDark: '#E25A7B' },
  { key: 'graphite', name: 'Graphite', scale: ['#111318', '#1F2329', '#3F4651', '#6B7280', '#B8BDC6', '#ECEEF1'], primary: '#3F4651', primaryDark: '#B8BDC6' },
];
export const themePreset = (key: string | null | undefined) => THEME_PRESETS.find((p) => p.key === key) ?? THEME_PRESETS[0];

// Free for commercial use (SIL Open Font or Apache licence, served by Google Fonts)
export const FONTS = [
  { key: 'inter', label: 'Inter', family: 'Inter' },
  { key: 'roboto', label: 'Roboto', family: 'Roboto' },
  { key: 'open_sans', label: 'Open Sans', family: 'Open Sans' },
  { key: 'lato', label: 'Lato', family: 'Lato' },
  { key: 'poppins', label: 'Poppins', family: 'Poppins' },
  { key: 'dm_sans', label: 'DM Sans', family: 'DM Sans' },
  { key: 'manrope', label: 'Manrope', family: 'Manrope' },
  { key: 'plex', label: 'IBM Plex Sans', family: 'IBM Plex Sans' },
  { key: 'source', label: 'Source Sans 3', family: 'Source Sans 3' },
  { key: 'public_sans', label: 'Public Sans', family: 'Public Sans' },
  { key: 'work_sans', label: 'Work Sans', family: 'Work Sans' },
  { key: 'nunito_sans', label: 'Nunito Sans', family: 'Nunito Sans' },
] as const;
export type FontKey = (typeof FONTS)[number]['key'];

export interface WorkspacePreferences {
  documents: {
    /** Tokens: {FY} = 26-27. The running number (4+ digits) is added at the end. */
    invoicePrefix: string;
    quotationPrefix: string;
    receiptPrefix: string;
    creditNotePrefix: string;
    salesOrderPrefix: string;
    deliveryChallanPrefix: string;
    debitNotePrefix: string;
    purchaseOrderPrefix: string;
    goodsReceiptPrefix: string;
    purchaseBillPrefix: string;
    purchaseReturnPrefix: string;
    supplierPaymentPrefix: string;
    expensePrefix: string;
    incomePrefix: string;
    transferPrefix: string;
    journalPrefix: string;
    template: DocTemplate;
    paper: 'a4' | '80mm' | '58mm';
    /** Printed on invoices */
    terms: string;
    /** Printed on quotations */
    quotationTerms: string;
    showHsnSummary: boolean;
    showSignatory: boolean;
  };
  payments: {
    bankHolder: string;
    bankAccount: string;
    ifsc: string;
    upiId: string;
    showUpiQr: boolean;
  };
  taxes: {
    composition: boolean;
    compositionRateBp: 100 | 500 | 600 | null;
    pricesIncludeTax: boolean;
    defaultGstRateBp: number;
    hsnDigits: 4 | 6;
    reverseCharge: boolean;
    /** Round bills to the whole rupee by default */
    roundOff: boolean;
    /** Turnover above the e-invoice limit: show e-invoice JSON on B2B bills */
    eInvoicing: boolean;
  };
  inventory: {
    /** Stop a sale or issue that takes stock below zero */
    blockNegative: boolean;
    /** Adjustments and counts worth more than this need inventory.stock_adjustment.approve */
    adjustmentApprovalPaise: number;
    /** How many days back a stock entry may be dated */
    backdateDays: number;
    /** Cost method, chosen before the first stock entry: moving average or first in, first out */
    valuation: 'average' | 'fifo';
    /** Batches expiring within this many days show as near expiry */
    nearExpiryDays: number;
    /** Off: purchases start at the invoice. On: Purchase Orders and Goods Receipts appear too */
    purchaseOrders: boolean;
  };
  branding: {
    brandColor: string;
    /** THEME_PRESETS key */
    preset: string;
    /** Not used for the page any more: light, dark or system is each person's own choice */
    theme: 'light' | 'dark' | 'system';
    font: FontKey;
    density: 'comfortable' | 'compact';
  };
}

export const DEFAULT_PREFERENCES: WorkspacePreferences = {
  documents: { invoicePrefix: 'INV/{FY}/', quotationPrefix: 'QT/{FY}/', receiptPrefix: 'RCT/{FY}/', creditNotePrefix: 'CN/{FY}/', salesOrderPrefix: 'SO/{FY}/', deliveryChallanPrefix: 'DC/{FY}/', debitNotePrefix: 'DN/{FY}/', purchaseOrderPrefix: 'PO/{FY}/', goodsReceiptPrefix: 'GRN/{FY}/', purchaseBillPrefix: 'PB/{FY}/', purchaseReturnPrefix: 'PR/{FY}/', supplierPaymentPrefix: 'PAY/{FY}/', expensePrefix: 'EXP/{FY}/', incomePrefix: 'INC/{FY}/', transferPrefix: 'TRF/{FY}/', journalPrefix: 'JV/{FY}/', template: 'classic', paper: 'a4', terms: '', quotationTerms: '', showHsnSummary: true, showSignatory: true },
  payments: { bankHolder: '', bankAccount: '', ifsc: '', upiId: '', showUpiQr: false },
  taxes: { composition: false, compositionRateBp: null, pricesIncludeTax: true, roundOff: false, defaultGstRateBp: 1800, hsnDigits: 4, reverseCharge: false, eInvoicing: false },
  inventory: { blockNegative: false, adjustmentApprovalPaise: 500_000, backdateDays: 7, valuation: 'average', nearExpiryDays: 30, purchaseOrders: false },
  branding: { brandColor: '#2450D8', preset: 'default', theme: 'system', font: 'inter', density: 'comfortable' },
};

/** Fill missing keys from defaults (old rows, new settings added later). */
export function withDefaults(stored: unknown, profile?: unknown): WorkspacePreferences {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof WorkspacePreferences, object>>;
  // Until Taxes is saved once, the composition answer from signup counts
  const signup = (profile && typeof profile === 'object' ? (profile as { composition?: unknown }).composition : undefined) === true;
  if (signup && !(s.taxes && 'composition' in s.taxes)) s.taxes = { ...(s.taxes ?? {}), composition: true };
  return {
    documents: { ...DEFAULT_PREFERENCES.documents, ...(s.documents ?? {}) },
    payments: { ...DEFAULT_PREFERENCES.payments, ...(s.payments ?? {}) },
    taxes: { ...DEFAULT_PREFERENCES.taxes, ...(s.taxes ?? {}) },
    inventory: { ...DEFAULT_PREFERENCES.inventory, ...(s.inventory ?? {}) },
    branding: { ...DEFAULT_PREFERENCES.branding, ...(s.branding ?? {}) },
  } as WorkspacePreferences;
}

/** Number preview: "INV/{FY}/" + 1 → "INV/26-27/0001" */
export function previewNumber(prefix: string, fy: string, n: number) {
  return `${prefix.replace(/\{FY\}/g, fy)}${String(n).padStart(4, '0')}`;
}

/** GST rule 46: invoice numbers up to 16 characters, letters, digits, "/" and "-" only. */
export function prefixError(prefix: string, fy = '26-27'): string | null {
  const sample = previewNumber(prefix, fy, 1);
  if (!prefix.trim()) return 'Add a prefix, e.g. INV/{FY}/';
  if (!/^[A-Za-z0-9/\-{}]+$/.test(prefix) || /\{(?!FY\})/.test(prefix)) return 'Use letters, digits, / and - (and {FY} for the year)';
  if (sample.length > 16) return `Too long: ${sample} has ${sample.length} characters (GST allows 16)`;
  return null;
}

// ── Setup wizard ──

export const SETUP_STEPS = [
  { key: 'profile', label: 'Business profile', neededForInvoices: true },
  { key: 'documents', label: 'Invoices & payments', neededForInvoices: false },
  { key: 'taxes', label: 'Taxes', neededForInvoices: false },
  { key: 'data', label: 'Bring your data', neededForInvoices: false },
  { key: 'team', label: 'Invite team', neededForInvoices: false },
  { key: 'branding', label: 'Branding', neededForInvoices: false },
] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number]['key'];
export type SetupStepState = 'done' | 'skipped';

export interface SetupState {
  steps: Partial<Record<SetupStepKey, SetupStepState>>;
  /** Owner closed the wizard ("Finish later") — dashboard shows the resume card */
  deferredAt?: string | null;
  completedAt?: string | null;
  /** Owner dismissed the dashboard card */
  cardDismissedAt?: string | null;
}

// ── Workspace provisioning (the loading screen) ──

export type ProvisioningStepKey = 'business' | 'template' | 'roles' | 'catalog' | 'dashboard';
export interface ProvisioningStatus {
  state: 'running' | 'ready' | 'failed';
  steps: { key: ProvisioningStepKey; label: string; state: 'waiting' | 'running' | 'done' | 'failed' }[];
  /** Quoted to support when something failed */
  reference: string | null;
  startedAt: string;
}
