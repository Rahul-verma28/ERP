import type { PermissionAction } from '@prisma/client';
import type { ModuleTier, PermissionModule } from './modules';

// Permission = module.resource.action (LLD §4). Synced to the `permissions` table by the seed.
// `tier: 'full'` marks paid features inside a module that has a free basic tier.

interface ResourceDef {
  resource: string;
  label: string;
  actions: PermissionAction[];
  tier?: ModuleTier;
}

const CRUD: PermissionAction[] = ['view', 'create', 'edit', 'delete'];
const CRUDX: PermissionAction[] = ['view', 'create', 'edit', 'delete', 'export'];

export const PERMISSION_CATALOG: Record<PermissionModule, ResourceDef[]> = {
  // Console (AHEAD team). Scope on these keys: all = every client, team = clients brought in by
  // me and the people reporting to me, own = clients I brought in (design v2 §2).
  platform: [
    { resource: 'dashboard', label: 'Console dashboard', actions: ['view'] },
    { resource: 'tenant', label: 'Clients', actions: ['view', 'create', 'edit'] },
    { resource: 'plan', label: 'Plans, prices & coupons', actions: ['view', 'edit'] },
    { resource: 'setting', label: 'Platform settings', actions: ['view', 'edit'] },
    { resource: 'grace', label: 'Grace periods', actions: ['create'] },
    { resource: 'payment', label: 'Payments & AHEAD invoices', actions: ['view', 'create', 'approve'] },
    { resource: 'discount', label: "Discounts above a role's limit", actions: ['approve'] },
    { resource: 'commission', label: 'Commission reports', actions: ['view'] },
    { resource: 'member', label: 'Console users', actions: ['view', 'create', 'edit'] },
    { resource: 'audit', label: 'Platform audit log', actions: ['view'] },
    { resource: 'revenue', label: 'Income figures', actions: ['view'] },
    { resource: 'prospect', label: 'Prospects & follow-ups', actions: ['view', 'create', 'edit'] },
    { resource: 'note', label: 'Internal client notes', actions: ['view', 'create'] },
    { resource: 'partner', label: 'Partners', actions: ['view', 'create', 'edit'] },
  ],
  tenant: [
    { resource: 'settings', label: 'Business settings', actions: ['view', 'edit'] },
    { resource: 'branch', label: 'Branches', actions: ['view', 'create', 'edit'] },
    { resource: 'member', label: 'Users', actions: ['view', 'create', 'edit'] },
    { resource: 'role', label: 'Roles', actions: CRUD },
    { resource: 'config', label: 'Custom fields & terminology', actions: ['view', 'edit'] },
    { resource: 'audit', label: 'Audit log', actions: ['view'] },
    { resource: 'data', label: 'Data export', actions: ['export'] },
    { resource: 'billing', label: 'Subscription & billing', actions: ['view', 'edit'] },
    { resource: 'account', label: 'Close account', actions: ['delete'] },
  ],
  crm: [
    { resource: 'contact', label: 'Contacts & customers', actions: CRUDX },
    { resource: 'lead', label: 'Leads', actions: CRUD },
    { resource: 'activity', label: 'Notes, calls & follow-ups', actions: CRUD },
    { resource: 'pipeline', label: 'Sales pipeline', actions: ['view', 'edit'], tier: 'full' },
    { resource: 'segment', label: 'Tags & segments', actions: CRUD, tier: 'full' },
    { resource: 'discount', label: 'Discount approval', actions: ['approve'], tier: 'full' },
  ],
  catalog: [
    { resource: 'item', label: 'Products & services', actions: CRUDX },
    { resource: 'category', label: 'Categories', actions: CRUD },
    { resource: 'price_list', label: 'Price lists', actions: CRUD, tier: 'full' },
  ],
  sales: [
    { resource: 'quotation', label: 'Quotations', actions: CRUD },
    { resource: 'order', label: 'Sales orders', actions: [...CRUD, 'approve'], tier: 'full' },
    { resource: 'delivery', label: 'Deliveries', actions: ['view', 'create', 'edit'], tier: 'full' },
    { resource: 'return', label: 'Sales returns', actions: ['view', 'create', 'approve'], tier: 'full' },
  ],
  billing: [
    { resource: 'invoice', label: 'Invoices', actions: ['view', 'create', 'edit', 'approve', 'export'] },
    { resource: 'payment', label: 'Receipts & payments', actions: ['view', 'create'] },
    { resource: 'credit_note', label: 'Credit & debit notes', actions: ['view', 'create', 'approve'], tier: 'full' },
    { resource: 'dues', label: 'Outstanding dues', actions: ['view', 'export'], tier: 'full' },
    { resource: 'pos', label: 'POS counter', actions: ['view', 'create'], tier: 'full' },
    { resource: 'refund', label: 'Refunds', actions: ['create', 'approve'], tier: 'full' },
  ],
  finance: [
    { resource: 'expense', label: 'Expenses', actions: CRUD },
    { resource: 'account', label: 'Chart of accounts', actions: CRUD, tier: 'full' },
    { resource: 'journal', label: 'Journal entries', actions: ['view', 'create', 'approve'], tier: 'full' },
    { resource: 'receivable', label: 'Accounts receivable', actions: ['view', 'edit'], tier: 'full' },
    { resource: 'payable', label: 'Accounts payable', actions: ['view', 'edit'], tier: 'full' },
    { resource: 'statement', label: 'Financial statements', actions: ['view', 'export'], tier: 'full' },
    { resource: 'period', label: 'Period closing', actions: ['approve'], tier: 'full' },
  ],
  inventory: [
    { resource: 'stock', label: 'Stock', actions: ['view', 'export'] },
    { resource: 'warehouse', label: 'Warehouses', actions: ['view', 'create', 'edit'] },
    { resource: 'receipt', label: 'Goods receipt', actions: ['view', 'create'] },
    { resource: 'dispatch', label: 'Dispatch', actions: ['view', 'create'] },
    { resource: 'transfer', label: 'Transfers', actions: ['view', 'create', 'approve'] },
    { resource: 'stock_adjustment', label: 'Adjustments', actions: ['view', 'create', 'approve'] },
    { resource: 'stock_count', label: 'Stock counts', actions: ['view', 'create'] },
    { resource: 'valuation', label: 'Valuation', actions: ['view'] },
    { resource: 'supplier', label: 'Suppliers', actions: CRUD },
    { resource: 'purchase_order', label: 'Purchase orders', actions: [...CRUD, 'approve'] },
    { resource: 'supplier_bill', label: 'Supplier bills', actions: ['view', 'create', 'approve'] },
    { resource: 'asset', label: 'Assets', actions: CRUD },
  ],
  hr: [
    { resource: 'employee', label: 'Employees', actions: CRUDX },
    { resource: 'attendance', label: 'Attendance', actions: ['view', 'create', 'edit', 'approve'] },
    { resource: 'leave', label: 'Leave', actions: ['view', 'create', 'approve'] },
    { resource: 'shift', label: 'Shifts', actions: CRUD },
    { resource: 'payroll', label: 'Payroll runs', actions: ['view', 'create', 'approve', 'export'] },
    { resource: 'payslip', label: 'Payslips', actions: ['view'] },
  ],
  tasks: [
    { resource: 'task', label: 'Tasks', actions: CRUD },
    { resource: 'approval', label: 'Approvals', actions: ['view', 'create', 'approve'], tier: 'full' },
  ],
  bookings: [
    { resource: 'appointment', label: 'Appointments', actions: CRUD },
    { resource: 'event', label: 'Calendar events', actions: CRUD },
    { resource: 'resource', label: 'Resources & availability', actions: CRUD, tier: 'full' },
  ],
  support: [
    { resource: 'ticket', label: 'Tickets', actions: CRUD },
    { resource: 'sla', label: 'SLA rules', actions: ['view', 'edit'] },
    { resource: 'kb', label: 'Knowledge base', actions: ['view', 'create', 'edit'] },
  ],
  reports: [
    { resource: 'dashboard', label: 'Dashboards', actions: ['view', 'edit'] },
    { resource: 'report', label: 'Reports', actions: ['view', 'export'] },
    { resource: 'builder', label: 'Report builder', actions: ['view', 'create'], tier: 'full' },
  ],
  ai: [{ resource: 'assistant', label: 'AI assistant', actions: ['view', 'create'] }],
  automation: [
    { resource: 'notification', label: 'Notifications', actions: ['view'] },
    { resource: 'rule', label: 'Automation rules', actions: CRUD, tier: 'full' },
  ],
};

export interface PermissionDef {
  key: string;
  moduleKey: PermissionModule;
  resource: string;
  action: PermissionAction;
  tier: ModuleTier;
  description: string;
  /** The resource's name, e.g. "Contacts & customers" (a row in the roles matrix) */
  label: string;
}

export const PERMISSIONS: PermissionDef[] = Object.entries(PERMISSION_CATALOG).flatMap(([moduleKey, resources]) =>
  resources.flatMap((r) =>
    r.actions.map((action) => ({
      key: `${moduleKey}.${r.resource}.${action}`,
      moduleKey: moduleKey as PermissionModule,
      resource: r.resource,
      action,
      tier: r.tier ?? 'basic',
      description: `${action[0].toUpperCase()}${action.slice(1)} ${r.label.toLowerCase()}`,
      label: r.label,
    })),
  ),
);

export const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

export const isReadAction = (key: string) => {
  const action = key.split('.')[2];
  return action === 'view' || action === 'export';
};
