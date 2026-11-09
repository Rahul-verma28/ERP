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
  { key: "crm", label: "CRM", termKey: "entity.contact.plural", icon: Users, description: "Contacts, leads, notes, calls and follow-ups", phase: 1 },
  { key: "catalog", label: "Products & Services", termKey: "entity.item.plural", icon: Package, description: "Your shared catalogue with GST rates and HSN/SAC", phase: 1 },
  { key: "sales", label: "Sales & Orders", icon: FileText, description: "Quotations, sales orders, deliveries and returns", phase: 1 },
  { key: "billing", label: "Billing", icon: Receipt, description: "GST invoices, receipts, dues and POS", phase: 1 },
  { key: "bookings", label: "Calendar & Bookings", termKey: "entity.appointment.plural", icon: CalendarDays, description: "Team calendar, appointments and resources", phase: 1 },
  { key: "tasks", label: "Tasks", icon: CheckSquare, description: "Tasks, checklists and approvals", phase: 1 },
  { key: "finance", label: "Expenses & Finance", icon: Wallet, description: "Expenses, ledgers and financial statements", phase: 2 },
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
  /** Shown only when the business has turned on Purchase Orders */
  needsPurchaseOrders?: boolean
}

/** Sub-modules shown under a module in the menu. The longest matching link is the active one. */
export const MODULE_SUBS: Partial<Record<ModuleKey, SubNav[]>> = {
  catalog: [
    { label: "Items", href: "/app/m/catalog" },
    { label: "Price Lists", href: "/app/m/catalog/price-lists" },
  ],
  sales: [
    { label: "Quotations", href: "/app/m/sales", permission: "sales.quotation.view" },
    { label: "Sales Orders", href: "/app/m/sales/orders", permission: "sales.order.view" },
    { label: "Delivery Challans", href: "/app/m/sales/challans" },
  ],
  billing: [
    { label: "Invoices", href: "/app/m/billing", permission: "billing.invoice.view" },
    { label: "Credit Notes", href: "/app/m/billing/credit-notes" },
    { label: "Debit Notes", href: "/app/m/billing/debit-notes" },
    { label: "Dues", href: "/app/m/billing/dues" },
  ],
  inventory: [
    { label: "Stock", href: "/app/m/inventory", permission: "inventory.stock.view" },
    { label: "Stock Entries", href: "/app/m/inventory/entries", permission: "inventory.stock.view" },
    { label: "Godowns", href: "/app/m/inventory/godowns", permission: "inventory.warehouse.view" },
    { label: "Stock Count", href: "/app/m/inventory/count", permission: "inventory.stock_count.create" },
    { label: "Near Expiry", href: "/app/m/inventory/expiry", permission: "inventory.stock.view" },
    { label: "Stock Ageing", href: "/app/m/inventory/ageing", permission: "inventory.stock.view" },
  ],
}

/** Purchase sits inside the Inventory module but has its own place in the menu */
export const PURCHASE_NAV = {
  label: "Purchase",
  icon: ShoppingCart,
  subs: [
    { label: "Purchase Invoices", href: "/app/m/purchase", permission: "inventory.supplier_bill.view" },
    { label: "Purchase Orders", href: "/app/m/purchase/orders", permission: "inventory.purchase_order.view", needsPurchaseOrders: true },
    { label: "Goods Receipts", href: "/app/m/purchase/grn", permission: "inventory.receipt.view", needsPurchaseOrders: true },
    { label: "Purchase Returns", href: "/app/m/purchase/returns", permission: "inventory.supplier_bill.view" },
    { label: "Suppliers", href: "/app/m/purchase/suppliers", permission: "inventory.supplier.view" },
    { label: "Low Stock", href: "/app/m/purchase/reorder", permission: "inventory.purchase_order.view" },
    { label: "Purchase Reports", href: "/app/m/purchase/reports", permission: "inventory.supplier_bill.view" },
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

export type NavEntry = ModuleKey | "dashboard" | "purchase" | "users" | "plan" | "settings"

/** The menu, by business area. Each area holds modules, and each module its own pages. */
export const NAV_SECTIONS: { label: string; entries: NavEntry[] }[] = [
  { label: "Overview", entries: ["dashboard", "reports"] },
  { label: "Sales & Revenue", entries: ["sales", "billing", "crm"] },
  { label: "Purchase & Inventory", entries: ["purchase", "inventory", "catalog"] },
  { label: "Project Management", entries: ["tasks", "bookings"] },
  { label: "Accounting & Finance", entries: ["finance"] },
  { label: "HR Management", entries: ["hr"] },
  { label: "Support & Communication", entries: ["support", "ai"] },
  { label: "System", entries: ["users", "automation", "plan", "settings"] },
]
