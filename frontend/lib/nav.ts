import {
  BarChart3,
  Bell,
  CalendarDays,
  CheckSquare,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Receipt,
  ShoppingCart,
  Sparkles,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react"
import type { ModuleKey } from "@/lib/types"

export interface ModuleNav {
  key: ModuleKey
  label: string
  /** Terminology key whose plural replaces the label, e.g. Customers → Clients */
  termKey?: string
  icon: LucideIcon
  description: string
  /** Release phase from the PRD; used for "coming soon" screens */
  phase: 1 | 2 | 3
}

export const MODULE_NAV: ModuleNav[] = [
  { key: "crm", label: "CRM", icon: Users, description: "Leads, deals, pipelines, tasks and follow-ups", phase: 1 },
  { key: "catalog", label: "Products & Services", termKey: "entity.item.plural", icon: Package, description: "Your shared catalogue with GST rates and HSN/SAC", phase: 1 },
  { key: "sales", label: "Sales & Orders", icon: FileText, description: "Quotations, sales orders, deliveries and returns", phase: 1 },
  { key: "billing", label: "Billing", icon: Receipt, description: "GST invoices, receipts, dues and POS", phase: 1 },
  { key: "bookings", label: "Calendar & Bookings", termKey: "entity.appointment.plural", icon: CalendarDays, description: "Team calendar, appointments and resources", phase: 1 },
  { key: "tasks", label: "Tasks", icon: CheckSquare, description: "Tasks, checklists and approvals", phase: 1 },
  { key: "finance", label: "Accounting & Finance", icon: Wallet, description: "Cash and bank, expenses, other income and profit & loss", phase: 2 },
  { key: "inventory", label: "Inventory", icon: Warehouse, description: "Stock, warehouses, purchasing and assets", phase: 2 },
  { key: "hr", label: "HR & Payroll", icon: UserCog, description: "Employees, attendance, leave and payroll", phase: 2 },
  { key: "support", label: "Customer Service", icon: LifeBuoy, description: "Tickets, SLAs and complaints", phase: 3 },
  { key: "reports", label: "Reports", icon: BarChart3, description: "Dashboards and standard reports", phase: 3 },
  { key: "ai", label: "AI Assistant", icon: Sparkles, description: "Ask questions about your business in plain language", phase: 3 },
  { key: "automation", label: "Automation", icon: Bell, description: "Notifications, reminders and rules", phase: 3 },
]

export interface SubNav {
  label: string
  href: string
  /** Hidden without this permission */
  permission?: string
  /** Other paths that belong to this link (its pages' sub-tabs) */
  also?: string[]
}

/** Sub-modules shown under a module in the menu. The longest matching link is the active one. */
export const MODULE_SUBS: Partial<Record<ModuleKey, SubNav[]>> = {
  catalog: [
    { label: "Items", href: "/app/m/catalog" },
    { label: "Price Lists", href: "/app/m/catalog/price-lists" },
  ],
  crm: [
    { label: "Leads", href: "/app/m/crm", permission: "crm.lead.view" },
    { label: "Deals", href: "/app/m/crm/deals", permission: "crm.deal.view" },
    { label: "Tasks", href: "/app/m/crm/follow-ups", permission: "crm.activity.view" },
    { label: "Reports", href: "/app/m/crm/reports", permission: "crm.lead.view" },
    { label: "Setup", href: "/app/m/crm/setup", permission: "crm.pipeline.edit" },
  ],
  finance: [
    { label: "Overview", href: "/app/m/finance", permission: "finance.expense.view" },
    { label: "Expenses", href: "/app/m/finance/expenses", permission: "finance.expense.view", also: ["/app/m/finance/income", "/app/m/finance/recurring"] },
    { label: "Cash & Bank", href: "/app/m/finance/accounts", permission: "finance.expense.view", also: ["/app/m/finance/transfers"] },
    { label: "Reports", href: "/app/m/finance/reports", permission: "finance.expense.view" },
    { label: "Accountant", href: "/app/m/finance/accountant", permission: "finance.expense.view", also: ["/app/m/finance/journals", "/app/m/finance/ledgers"] },
    { label: "Setup", href: "/app/m/finance/settings", permission: "finance.expense.view" },
  ],
  inventory: [
    { label: "Stock", href: "/app/m/inventory", permission: "inventory.stock.view" },
    { label: "Warehouses", href: "/app/m/inventory/warehouses", permission: "inventory.warehouse.view" },
    { label: "Transfers", href: "/app/m/inventory/transfers", permission: "inventory.stock.view" },
    { label: "Stock Entries", href: "/app/m/inventory/entries", permission: "inventory.stock.view" },
    { label: "Reports", href: "/app/m/inventory/reports", permission: "inventory.stock.view" },
  ],
}

/**
 * Sales & Revenue: one group over three modules (CRM for customers, Sales for quotations,
 * Billing for invoices). Each page is hidden when its module is off or the person lacks the permission.
 * The menu is fixed; Sales Orders and Delivery Challans are reached from the lists' ⋯ menu.
 */
export const SALES_NAV = {
  label: "Sales",
  icon: FileText,
  subs: [
    { label: "Customers", href: "/app/m/sales/customers", permission: "crm.contact.view" },
    { label: "Quotations", href: "/app/m/sales", permission: "sales.quotation.view" },
    { label: "Sales Invoices", href: "/app/m/billing", permission: "billing.invoice.view" },
    { label: "Sales Returns", href: "/app/m/billing/credit-notes", permission: "billing.invoice.view" },
    { label: "Payments Received", href: "/app/m/billing/payments", permission: "billing.payment.view" },
    { label: "Reports", href: "/app/m/sales/reports", permission: "reports.report.view" },
  ] as SubNav[],
}

/** Purchase sits inside the Inventory module but has its own place in the menu */
export const PURCHASE_NAV = {
  label: "Purchase",
  icon: ShoppingCart,
  subs: [
    { label: "Purchase Invoices", href: "/app/m/purchase", permission: "inventory.supplier_bill.view" },
    { label: "Purchase Returns", href: "/app/m/purchase/returns", permission: "inventory.supplier_bill.view" },
    { label: "Payments Made", href: "/app/m/purchase/payments", permission: "inventory.supplier_bill.view" },
    { label: "Suppliers", href: "/app/m/purchase/suppliers", permission: "inventory.supplier.view" },
    { label: "Reports", href: "/app/m/purchase/reports", permission: "inventory.supplier_bill.view" },
  ] as SubNav[],
}

export const USER_NAV = {
  label: "User Management",
  icon: UserCog,
  subs: [
    { label: "Users", href: "/app/settings/team", permission: "tenant.member.view" },
    { label: "Roles", href: "/app/settings/roles", permission: "tenant.role.view" },
  ] as SubNav[],
}

export const DASHBOARD_NAV = { label: "Dashboard", icon: LayoutDashboard }

export type NavEntry = ModuleKey | "dashboard" | "salesgroup" | "purchase" | "users" | "plan" | "settings"

/** The menu, by business area. Each area holds modules, and each module its own pages. */
export const NAV_SECTIONS: { label: string; entries: NavEntry[] }[] = [
  { label: "Overview", entries: ["dashboard", "reports"] },
  { label: "Sales & Revenue", entries: ["salesgroup", "crm"] },
  { label: "Purchase & Inventory", entries: ["purchase", "inventory", "catalog"] },
  { label: "Project Management", entries: ["tasks", "bookings"] },
  { label: "Accounting & Finance", entries: ["finance"] },
  { label: "HR Management", entries: ["hr"] },
  { label: "Support & Communication", entries: ["support", "ai"] },
  { label: "System", entries: ["users", "automation", "plan", "settings"] },
]
