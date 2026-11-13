import type { PermissionScope, RoleLayer, RoleType } from '@prisma/client';
import { PERMISSIONS } from './permissions';
import type { ModuleKey } from './modules';

// Predefined roles: 4 Console roles + 2 partner roles (Console v3) + 4 core + 17 module roles.
// Grants use patterns: "crm.*", "crm.contact.*", "*.view", "billing.invoice.create".

type Grant = [pattern: string, scope: PermissionScope];

export interface RoleDef {
  key: string;
  name: string;
  layer: RoleLayer;
  roleType: RoleType;
  description: string;
  /** Visible only when every module here is active at full tier */
  requiredModules: ModuleKey[];
  isSystem?: boolean;
  grants: Grant[];
  /** Grants removed after patterns expand */
  deny?: string[];
  fieldAccess?: { entity: string; field: string; access: 'read' | 'write' }[];
}

const SENSITIVE_ALL = [
  { entity: 'employee', field: 'salary', access: 'write' as const },
  { entity: 'employee', field: 'bank_account', access: 'write' as const },
  { entity: 'item', field: 'cost_price', access: 'write' as const },
  { entity: 'contact', field: 'phone_export', access: 'read' as const },
];

export const ROLES: RoleDef[] = [
  // ── Console v3: six roles across the AHEAD Console, the vendor panel and the partner portal ──
  { key: 'super_admin', name: 'Admin', layer: 'platform', roleType: 'admin', description: 'Everything: businesses, partners, billing, people, roles, plans, prices and Console settings', requiredModules: [], isSystem: true, grants: [['platform.*', 'all']] },
  { key: 'console_staff', name: 'Staff', layer: 'platform', roleType: 'user', description: 'All businesses: onboard, change plan, extend, record payments; partners (view)', requiredModules: [], grants: [['platform.dashboard.view', 'all'], ['platform.tenant.*', 'all'], ['platform.grace.create', 'all'], ['platform.plan.view', 'all'], ['platform.payment.view', 'all'], ['platform.payment.create', 'all'], ['platform.revenue.view', 'all'], ['platform.note.*', 'all'], ['platform.partner.view', 'all']] },
  { key: 'console_sales', name: 'Sales', layer: 'platform', roleType: 'salesperson', description: 'Own businesses: onboard, change plan, extend trial; own referral link and code', requiredModules: [], grants: [['platform.dashboard.view', 'own'], ['platform.tenant.*', 'own'], ['platform.grace.create', 'own'], ['platform.plan.view', 'all'], ['platform.payment.view', 'own'], ['platform.note.*', 'own']] },
  { key: 'vendor', name: 'Vendor', layer: 'platform', roleType: 'user', description: 'Own businesses: onboard and send the login link; own referral link and code', requiredModules: [], grants: [['platform.dashboard.view', 'own'], ['platform.tenant.view', 'own'], ['platform.tenant.create', 'own'], ['platform.payment.view', 'own'], ['platform.plan.view', 'all']] },
  // Partner people are Console members linked to a partner: every client query is limited to that partner (scopedTenantFilter)
  { key: 'partner_admin', name: 'Partner owner', layer: 'partner', roleType: 'admin', description: "The partner's businesses and plans, its team and the monthly bill from AHEAD", requiredModules: [], grants: [['platform.dashboard.view', 'all'], ['platform.tenant.*', 'all'], ['platform.plan.view', 'all'], ['platform.member.*', 'all'], ['platform.partner.view', 'all']] },
  { key: 'partner_staff', name: 'Partner staff', layer: 'partner', roleType: 'user', description: "Onboard and look after the partner's businesses; no bill or team", requiredModules: [], grants: [['platform.dashboard.view', 'all'], ['platform.tenant.view', 'all'], ['platform.tenant.create', 'all'], ['platform.plan.view', 'all']] },

  // ── Tenant core roles (always visible) ──
  {
    key: 'owner', name: 'Owner', layer: 'tenant', roleType: 'admin', isSystem: true, requiredModules: [],
    description: 'Full access to all subscribed modules, billing and subscription, users',
    grants: [['*', 'all']],
    fieldAccess: SENSITIVE_ALL,
  },
  {
    key: 'admin', name: 'Admin', layer: 'tenant', roleType: 'admin', requiredModules: [],
    description: 'Full access to all subscribed modules and users; no subscription or plan changes',
    grants: [['*', 'all']],
    deny: ['tenant.billing.edit', 'tenant.account.delete', 'hr.payroll.approve'],
    fieldAccess: [{ entity: 'item', field: 'cost_price', access: 'write' }],
  },
  {
    key: 'staff', name: 'Staff', layer: 'tenant', roleType: 'user', requiredModules: [],
    description: 'Basic work in free modules: own tasks, customers, quotations, invoices, calendar',
    grants: [
      ['crm.contact.view', 'all'], ['crm.contact.create', 'all'], ['crm.contact.edit', 'own'],
      ['crm.lead.view', 'own'], ['crm.lead.create', 'own'], ['crm.lead.edit', 'own'],
      ['crm.activity.view', 'own'], ['crm.activity.create', 'own'], ['crm.activity.edit', 'own'],
      ['crm.deal.view', 'own'], ['crm.deal.create', 'own'], ['crm.deal.edit', 'own'], ['crm.pipeline.view', 'all'],
      ['catalog.item.view', 'all'], ['catalog.category.view', 'all'],
      ['sales.quotation.view', 'own'], ['sales.quotation.create', 'own'], ['sales.quotation.edit', 'own'],
      ['billing.invoice.view', 'own'], ['billing.invoice.create', 'own'], ['billing.payment.view', 'own'], ['billing.payment.create', 'own'],
      ['finance.expense.view', 'own'], ['finance.expense.create', 'own'],
      ['tasks.task.view', 'own'], ['tasks.task.create', 'own'], ['tasks.task.edit', 'own'],
      ['bookings.appointment.view', 'all'], ['bookings.appointment.create', 'all'], ['bookings.appointment.edit', 'own'],
      ['bookings.event.view', 'all'], ['bookings.event.create', 'own'], ['bookings.event.edit', 'own'],
      ['reports.dashboard.view', 'own'], ['automation.notification.view', 'own'],
      ['tenant.settings.view', 'all'], ['tenant.branch.view', 'all'],
    ],
  },
  {
    key: 'viewer', name: 'Read-only Viewer', layer: 'tenant', roleType: 'user', requiredModules: [],
    description: 'View and export reports and records; no create, edit or delete (auditors, CAs)',
    grants: [['*.view', 'all'], ['*.export', 'all']],
    deny: ['tenant.audit.view', 'tenant.data.export', 'tenant.billing.view', 'tenant.role.view', 'tenant.member.view', 'hr.payroll.view', 'hr.payroll.export', 'hr.payslip.view'],
  },

  // ── Tenant module roles (visible only when the required module is active) ──
  {
    key: 'sales_manager', name: 'Sales Manager', layer: 'tenant', roleType: 'user', requiredModules: ['crm'],
    description: 'All leads, pipelines, team assignment, sales reports, discount approval',
    grants: [['crm.*', 'all'], ['sales.*', 'all'], ['catalog.item.view', 'all'], ['billing.invoice.view', 'all'], ['billing.dues.view', 'all'], ['reports.*', 'all'], ['tasks.task.*', 'team'], ['bookings.event.*', 'team']],
  },
  {
    key: 'sales_person', name: 'Sales Person', layer: 'tenant', roleType: 'salesperson', requiredModules: ['crm'],
    description: 'Own leads, customers, quotations and orders only',
    grants: [['crm.contact.view', 'own'], ['crm.contact.create', 'own'], ['crm.contact.edit', 'own'], ['crm.lead.*', 'own'], ['crm.activity.*', 'own'], ['crm.deal.*', 'own'], ['crm.pipeline.view', 'all'], ['sales.quotation.*', 'own'], ['sales.order.view', 'own'], ['sales.order.create', 'own'], ['catalog.item.view', 'all'], ['tasks.task.*', 'own'], ['bookings.event.*', 'own']],
  },
  {
    key: 'cashier', name: 'Billing Staff / Cashier', layer: 'tenant', roleType: 'counter', requiredModules: ['billing'],
    description: 'Create invoices and receipts, record payments; no deletes or refunds',
    grants: [['billing.invoice.view', 'branch'], ['billing.invoice.create', 'branch'], ['billing.payment.*', 'branch'], ['billing.pos.*', 'branch'], ['crm.contact.view', 'all'], ['crm.contact.create', 'all'], ['catalog.item.view', 'all']],
    deny: ['billing.payment.approve'],
  },
  {
    key: 'finance_manager', name: 'Finance Manager / Accountant', layer: 'tenant', roleType: 'user', requiredModules: ['finance'],
    description: 'Full accounting, journals, statements, period closing',
    grants: [['finance.*', 'all'], ['billing.*', 'all'], ['inventory.supplier_bill.*', 'all'], ['inventory.valuation.view', 'all'], ['reports.*', 'all']],
    deny: ['billing.pos.create'],
    fieldAccess: [{ entity: 'item', field: 'cost_price', access: 'read' }],
  },
  {
    key: 'ar_manager', name: 'Accounts Receivable Manager', layer: 'tenant', roleType: 'user', requiredModules: ['finance'],
    description: 'Customer dues, collections, credit notes, receipts',
    grants: [['finance.receivable.*', 'all'], ['billing.invoice.view', 'all'], ['billing.payment.*', 'all'], ['billing.credit_note.*', 'all'], ['billing.refund.*', 'all'], ['billing.dues.*', 'all'], ['crm.contact.view', 'all'], ['reports.report.view', 'all']],
  },
  {
    key: 'ap_manager', name: 'Accounts Payable Manager', layer: 'tenant', roleType: 'user', requiredModules: ['finance'],
    description: 'Supplier bills, payments due, debit notes',
    grants: [['finance.payable.*', 'all'], ['finance.expense.*', 'all'], ['inventory.supplier.view', 'all'], ['inventory.supplier_bill.*', 'all'], ['inventory.purchase_order.view', 'all'], ['reports.report.view', 'all']],
  },
  {
    key: 'warehouse_manager', name: 'Warehouse Manager', layer: 'tenant', roleType: 'user', requiredModules: ['inventory'],
    description: 'All stock, warehouses, transfers, adjustments, stock reports',
    grants: [['inventory.stock.*', 'all'], ['inventory.warehouse.*', 'all'], ['inventory.receipt.*', 'all'], ['inventory.dispatch.*', 'all'], ['inventory.transfer.*', 'all'], ['inventory.stock_adjustment.*', 'all'], ['inventory.stock_count.*', 'all'], ['inventory.valuation.view', 'all'], ['inventory.asset.*', 'all'], ['catalog.*', 'all'], ['reports.report.view', 'all']],
    fieldAccess: [{ entity: 'item', field: 'cost_price', access: 'read' }],
  },
  {
    key: 'warehouse_staff', name: 'Warehouse Staff', layer: 'tenant', roleType: 'user', requiredModules: ['inventory'],
    description: 'Receive, dispatch, transfer and count stock; no adjustments or valuation',
    grants: [['inventory.stock.view', 'branch'], ['inventory.receipt.*', 'branch'], ['inventory.dispatch.*', 'branch'], ['inventory.transfer.view', 'branch'], ['inventory.transfer.create', 'branch'], ['inventory.stock_count.*', 'branch'], ['catalog.item.view', 'all']],
  },
  {
    key: 'procurement_manager', name: 'Procurement Manager', layer: 'tenant', roleType: 'user', requiredModules: ['inventory'],
    description: 'Suppliers, purchase requests, POs, supplier bills',
    grants: [['inventory.supplier.*', 'all'], ['inventory.purchase_order.*', 'all'], ['inventory.supplier_bill.*', 'all'], ['inventory.receipt.view', 'all'], ['inventory.stock.view', 'all'], ['catalog.item.view', 'all'], ['reports.report.view', 'all']],
    fieldAccess: [{ entity: 'item', field: 'cost_price', access: 'read' }],
  },
  {
    key: 'hr_manager', name: 'HR Manager', layer: 'tenant', roleType: 'user', requiredModules: ['hr'],
    description: 'Employee records, attendance, leave, shifts, recruitment',
    grants: [['hr.employee.*', 'all'], ['hr.attendance.*', 'all'], ['hr.leave.*', 'all'], ['hr.shift.*', 'all'], ['hr.payslip.view', 'all'], ['tasks.approval.*', 'all'], ['reports.report.view', 'all']],
    fieldAccess: [{ entity: 'employee', field: 'salary', access: 'write' }, { entity: 'employee', field: 'bank_account', access: 'write' }],
  },
  {
    key: 'payroll_manager', name: 'Payroll Manager', layer: 'tenant', roleType: 'user', requiredModules: ['hr'],
    description: 'Salary structures, payroll runs, payslips; can see salaries',
    grants: [['hr.payroll.*', 'all'], ['hr.payslip.*', 'all'], ['hr.employee.view', 'all'], ['hr.attendance.view', 'all'], ['hr.leave.view', 'all']],
    fieldAccess: [{ entity: 'employee', field: 'salary', access: 'write' }, { entity: 'employee', field: 'bank_account', access: 'write' }],
  },
  {
    key: 'employee', name: 'Employee (Self-service)', layer: 'tenant', roleType: 'employee', requiredModules: ['hr'],
    description: 'Own profile, attendance, leave requests, payslips only',
    grants: [['hr.employee.view', 'own'], ['hr.attendance.view', 'own'], ['hr.attendance.create', 'own'], ['hr.leave.view', 'own'], ['hr.leave.create', 'own'], ['hr.payslip.view', 'own'], ['tasks.task.view', 'own'], ['tasks.task.edit', 'own'], ['automation.notification.view', 'own']],
  },
  {
    key: 'front_desk', name: 'Front Desk / Receptionist', layer: 'tenant', roleType: 'counter', requiredModules: ['bookings'],
    description: 'Create and change bookings, check-in customers, view schedules',
    grants: [['bookings.appointment.*', 'branch'], ['bookings.event.view', 'branch'], ['bookings.resource.view', 'branch'], ['crm.contact.view', 'all'], ['crm.contact.create', 'all'], ['crm.contact.edit', 'all'], ['catalog.item.view', 'all'], ['billing.invoice.create', 'branch'], ['billing.invoice.view', 'branch'], ['billing.payment.create', 'branch']],
  },
  {
    key: 'service_provider', name: 'Service Provider', layer: 'tenant', roleType: 'user', requiredModules: ['bookings'],
    description: 'Own appointments and schedule; renamed per industry (Stylist, Trainer, Teacher, Doctor)',
    grants: [['bookings.appointment.view', 'own'], ['bookings.appointment.edit', 'own'], ['bookings.event.view', 'own'], ['crm.contact.view', 'all'], ['crm.activity.create', 'own'], ['tasks.task.view', 'own'], ['tasks.task.edit', 'own']],
  },
  {
    key: 'support_manager', name: 'Support Manager', layer: 'tenant', roleType: 'user', requiredModules: ['support'],
    description: 'All tickets, assignment, SLA rules, knowledge base',
    grants: [['support.*', 'all'], ['crm.contact.view', 'all'], ['billing.invoice.view', 'all'], ['reports.report.view', 'all']],
  },
  {
    key: 'support_agent', name: 'Support Agent', layer: 'tenant', roleType: 'user', requiredModules: ['support'],
    description: 'Assigned tickets and replies only',
    grants: [['support.ticket.view', 'own'], ['support.ticket.create', 'own'], ['support.ticket.edit', 'own'], ['support.kb.view', 'all'], ['crm.contact.view', 'all']],
  },
  {
    key: 'report_analyst', name: 'Report Analyst', layer: 'tenant', roleType: 'user', requiredModules: ['reports'],
    description: 'Report Builder, scheduled reports, all permitted dashboards; read-only data',
    grants: [['reports.*', 'all'], ['*.view', 'all']],
    deny: ['hr.payroll.view', 'hr.payslip.view', 'tenant.audit.view', 'tenant.billing.view', 'tenant.member.view', 'tenant.role.view'],
  },
];

const matches = (pattern: string, key: string) => {
  if (pattern === '*') return true;
  const p = pattern.split('.');
  const k = key.split('.');
  if (p.length === 2 && p[0] === '*') return k[2] === p[1]; // "*.view"
  return p.every((part, i) => part === '*' || part === k[i]);
};

/** Console roles removed in Console v3 and the role their members move to (applied by the seed). */
export const RETIRED_ROLES: Record<string, string> = {
  platform_ops: 'console_staff',
  platform_support: 'console_staff',
  finance_payout_admin: 'console_staff',
  console_sales_manager: 'console_sales',
  console_sales_executive: 'console_sales',
};

/** Expand a role's grant patterns to concrete permission keys (most specific grant wins). */
export function expandGrants(role: RoleDef): Map<string, PermissionScope> {
  const result = new Map<string, PermissionScope>();
  const consoleRole = role.layer !== 'tenant';
  for (const [pattern, scope] of role.grants) {
    for (const p of PERMISSIONS) {
      // Console keys only ever go to Console roles, and Console roles get nothing else
      if ((p.moduleKey === 'platform') !== consoleRole) continue;
      if (p.moduleKey === 'tenant' && pattern.startsWith('*.')) {
        // wildcards over modules only include tenant settings views, never admin actions
        if (!['tenant.settings.view', 'tenant.branch.view'].includes(p.key)) continue;
      }
      if (matches(pattern, p.key)) result.set(p.key, scope);
    }
  }
  for (const key of role.deny ?? []) result.delete(key);
  return result;
}
