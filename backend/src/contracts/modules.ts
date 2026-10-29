// v1 module catalogue (PRD §3.1): 12 business modules + the shared catalogue master.
// `tenant` is the platform pseudo-module (settings, members, roles); it is always active.

export const MODULE_KEYS = [
  'crm',
  'catalog',
  'sales',
  'billing',
  'inventory',
  'hr',
  'tasks',
  'finance',
  'bookings',
  'support',
  'reports',
  'ai',
  'automation',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
/** 'tenant' = business settings inside the ERP; 'platform' = the AHEAD Console */
export type PermissionModule = ModuleKey | 'tenant' | 'platform';

/** basic = free-tier features only; full = all features of the module */
export type ModuleTier = 'basic' | 'full';

export interface ModuleDef {
  key: ModuleKey;
  name: string;
  category: string;
  description: string;
  /** Has a permanently free basic tier (PRD §5 "Free" rows) */
  freeTier: boolean;
  dependsOn: ModuleKey[];
  usageBased?: boolean;
}

export const MODULES: ModuleDef[] = [
  { key: 'crm', name: 'CRM', category: 'CRM, Sales & Marketing', description: 'Contacts, leads, follow-ups and pipelines', freeTier: true, dependsOn: [] },
  { key: 'catalog', name: 'Products & Services', category: 'Master data', description: 'Shared product and service catalogue', freeTier: true, dependsOn: [] },
  { key: 'sales', name: 'Sales & Orders', category: 'Sales & Billing', description: 'Quotations, sales orders, deliveries and returns', freeTier: false, dependsOn: ['crm', 'catalog'] },
  { key: 'billing', name: 'Billing & Payments', category: 'Sales & Billing', description: 'GST invoices, receipts, dues and POS', freeTier: true, dependsOn: ['catalog'] },
  { key: 'inventory', name: 'Inventory & Assets', category: 'Inventory & Supply Chain', description: 'Stock ledger, warehouses, purchasing and assets', freeTier: false, dependsOn: ['catalog'] },
  { key: 'hr', name: 'HR & Employees', category: 'Human Resources', description: 'Employees, attendance, leave and payroll', freeTier: false, dependsOn: [] },
  { key: 'tasks', name: 'Tasks & Workflow', category: 'Operations & Productivity', description: 'Tasks, checklists and approvals', freeTier: true, dependsOn: [] },
  { key: 'finance', name: 'Expenses & Finance', category: 'Finance & Accounting', description: 'Expenses, ledgers and financial statements', freeTier: false, dependsOn: [] },
  { key: 'bookings', name: 'Calendar & Bookings', category: 'Operations & Productivity', description: 'Team calendar, appointments and resources', freeTier: false, dependsOn: [] },
  { key: 'support', name: 'Customer Service', category: 'Customer Service', description: 'Tickets, SLAs and complaints', freeTier: false, dependsOn: ['crm'] },
  { key: 'reports', name: 'Reports & Analytics', category: 'Business Intelligence', description: 'Dashboards and reports', freeTier: false, dependsOn: [] },
  { key: 'ai', name: 'AI Business Assistant', category: 'AI & Automation', description: 'Ask questions about your business', freeTier: false, dependsOn: [], usageBased: true },
  { key: 'automation', name: 'Automation & Notifications', category: 'AI & Automation', description: 'Notifications, reminders and rules', freeTier: false, dependsOn: [] },
];

export const FREE_MODULES = MODULES.filter((m) => m.freeTier).map((m) => m.key);
export const isModuleKey = (k: string): k is ModuleKey => (MODULE_KEYS as readonly string[]).includes(k);
