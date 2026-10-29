import type { ModuleKey } from './modules';
import { MODULE_KEYS } from './modules';

// Plans, limits and prices in paise, excluding GST (Console v3 option A). These are first-install
// defaults: plans and prices are edited in Console › Settings and live in the database.

export interface PlanLimits {
  users: number;
  branches: number;
  contacts: number | null; // null = unlimited
  items: number | null;
  invoicesPerMonth: number | null;
  storageMb: number;
  aiCredits: number;
}

export interface PlanDef {
  key: 'free' | 'standard' | 'professional' | 'enterprise';
  name: string;
  tagline: string;
  limits: PlanLimits;
  /** Modules the plan switches on. The Free plan's modules come from the modules' free-tier flag. */
  fullModules: ModuleKey[];
  monthlyPaise: number | null;
  yearlyPaise: number | null;
  isPublic: boolean;
}

// Console v3 pricing (option A, approved 29 Oct 2026): Free + three plans, each a fixed set of
// modules and users. The only extra is users. Every paid plan includes the Free modules, so a
// client never sees a "basic" and a "full" version of the same module.
export const FREE_MODULES: ModuleKey[] = ['crm', 'catalog', 'billing', 'tasks'];
const STANDARD: ModuleKey[] = [...FREE_MODULES, 'sales', 'inventory', 'finance', 'bookings', 'reports'];
const PROFESSIONAL: ModuleKey[] = [...STANDARD, 'hr', 'support', 'automation'];

export const PLANS: PlanDef[] = [
  {
    key: 'free', name: 'Free', tagline: 'CRM, products, billing and tasks — free forever', isPublic: true,
    limits: { users: 2, branches: 1, contacts: 1000, items: 500, invoicesPerMonth: 100, storageMb: 1024, aiCredits: 0 },
    fullModules: [], monthlyPaise: 0, yearlyPaise: 0,
  },
  {
    key: 'standard', name: 'Standard', tagline: 'Everything a small business runs on, with stock', isPublic: true,
    limits: { users: 5, branches: 1, contacts: 10000, items: 5000, invoicesPerMonth: null, storageMb: 5120, aiCredits: 0 },
    fullModules: STANDARD, monthlyPaise: 99900, yearlyPaise: 999000,
  },
  {
    key: 'professional', name: 'Professional', tagline: 'For growing teams: HR, customer service and automation', isPublic: true,
    limits: { users: 15, branches: 3, contacts: null, items: null, invoicesPerMonth: null, storageMb: 20480, aiCredits: 0 },
    fullModules: PROFESSIONAL, monthlyPaise: 249900, yearlyPaise: 2499000,
  },
  {
    key: 'enterprise', name: 'Enterprise', tagline: 'Any users and branches, every module including AI — quoted by AHEAD', isPublic: true,
    limits: { users: 50, branches: 50, contacts: null, items: null, invoicesPerMonth: null, storageMb: 512000, aiCredits: 5000 },
    fullModules: [...MODULE_KEYS], monthlyPaise: null, yearlyPaise: null,
  },
];

/** Plans sold before Console v3: kept for the clients on them (until they renew), hidden from sale. */
export const RETIRED_PLAN_KEYS = ['starter', 'growth', 'business_pro'];

/** Trial: 14 days of Professional (TRL-02) */
export const TRIAL_LIMITS: PlanLimits = { users: 15, branches: 3, contacts: null, items: null, invoicesPerMonth: null, storageMb: 5120, aiCredits: 0 };
export const TRIAL_PLAN_KEY = 'professional';

/** Module add-on prices (monthly, paise) from the catalogue */
export const ADDON_MONTHLY_PAISE: Partial<Record<ModuleKey, number>> = {
  inventory: 49900,
  finance: 49900,
  hr: 39900,
  support: 39900,
  ai: 79900,
  automation: 59900,
  sales: 49900,
};
export const EXTRA_USER_MONTHLY_PAISE = 19900;

export const planByKey = (key: string) => PLANS.find((p) => p.key === key);
