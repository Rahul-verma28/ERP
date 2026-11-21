// Phase 3 dashboard contract shared by the API and the web app (`@contracts/dashboard`):
// tabs, widgets per tab, date ranges and per-person layout. Dependency-free.

export const DASHBOARD_TABS = [
  { key: 'overview', label: 'Overview', permission: 'reports.dashboard.view' },
  { key: 'myday', label: 'My day', permission: 'reports.dashboard.view' },
  { key: 'billing', label: 'Billing', permission: 'billing.invoice.view' },
  { key: 'pos', label: 'POS', permission: 'billing.pos.view' },
  { key: 'sales', label: 'Sales', permission: 'sales.quotation.view' },
  { key: 'purchase', label: 'Purchase', permission: 'inventory.supplier_bill.view' },
  { key: 'inventory', label: 'Inventory', permission: 'inventory.stock.view' },
  { key: 'crm', label: 'CRM', permission: 'crm.contact.view' },
  { key: 'bookings', label: 'Bookings', permission: 'bookings.appointment.view' },
  { key: 'finance', label: 'Finance', permission: 'finance.expense.view' },
  { key: 'tasks', label: 'Tasks', permission: 'tasks.task.view' },
] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number]['key'];

/** Widgets each tab can show, in their default order. */
export const DASHBOARD_WIDGETS: Record<DashboardTab, { key: string; label: string }[]> = {
  overview: [
    { key: 'kpis', label: 'Sales, collected, to collect, expenses' },
    { key: 'inbox', label: 'Needs you' },
    { key: 'today', label: "Today's appointments" },
    { key: 'trend', label: 'Sales vs collected' },
    { key: 'activity', label: 'Recent activity' },
  ],
  myday: [
    { key: 'kpis', label: 'My numbers' },
    { key: 'schedule', label: 'My schedule' },
    { key: 'tasks', label: 'My tasks' },
  ],
  billing: [
    { key: 'kpis', label: 'Invoiced, collected, outstanding, average' },
    { key: 'trend', label: 'Invoiced vs collected' },
    { key: 'ageing', label: 'Dues by age' },
    { key: 'overdue', label: 'Overdue invoices' },
    { key: 'methods', label: 'How customers paid' },
  ],
  sales: [
    { key: 'kpis', label: 'Quotations sent, won, open, expiring' },
    { key: 'results', label: 'Quotations by result' },
    { key: 'top', label: 'Best-selling services & products' },
    { key: 'open', label: 'Open quotations' },
  ],
  pos: [
    { key: 'kpis', label: 'Counter sales, bills, average, cash in drawers' },
    { key: 'trend', label: 'Counter sales by day' },
    { key: 'counters', label: 'Counters now' },
    { key: 'methods', label: 'How counter bills were paid' },
    { key: 'items', label: 'Best sellers at the counter' },
  ],
  purchase: [
    { key: 'kpis', label: 'Purchased, paid, to pay, overdue' },
    { key: 'trend', label: 'Purchased vs paid' },
    { key: 'due', label: 'Bills to pay' },
    { key: 'suppliers', label: 'Top suppliers' },
  ],
  inventory: [
    { key: 'kpis', label: 'Stock value, low, out, expiring' },
    { key: 'low', label: 'Low on stock' },
    { key: 'movers', label: 'Fast movers' },
    { key: 'warehouses', label: 'Stock by warehouse' },
  ],
  crm: [
    { key: 'kpis', label: 'Leads, converted, customers, follow-ups' },
    { key: 'stages', label: 'Leads by stage' },
    { key: 'sources', label: 'Where leads come from' },
    { key: 'followups', label: 'Follow-ups due' },
    { key: 'top', label: 'Top customers' },
  ],
  bookings: [
    { key: 'kpis', label: 'Appointments, completed, earned, no-shows' },
    { key: 'services', label: 'Earnings by service' },
    { key: 'hours', label: 'Busy hours' },
    { key: 'staff', label: 'Staff utilisation' },
    { key: 'week', label: 'Next 7 days' },
    { key: 'noshows', label: 'No-shows' },
  ],
  finance: [
    { key: 'kpis', label: 'Money in, money out, net, GST' },
    { key: 'categories', label: 'Expenses by category' },
    { key: 'profit', label: 'Profit snapshot' },
    { key: 'gst', label: 'GST for the period' },
  ],
  tasks: [
    { key: 'kpis', label: 'Open, overdue, done, hours, approvals' },
    { key: 'projects', label: 'Projects' },
    { key: 'people', label: 'Open tasks by person' },
    { key: 'due', label: 'Overdue and due today' },
  ],
};

export type RangePreset = 'today' | 'week' | 'month' | 'custom';

export interface DashboardLayout {
  /** Widget keys in display order (unknown or missing keys fall back to the default order) */
  order: string[];
  hidden: string[];
}

export interface DashboardPrefs {
  lastTab: DashboardTab | null;
  range: RangePreset;
  from: string | null;
  to: string | null;
  compare: boolean;
  branchId: string | null;
  layouts: Partial<Record<DashboardTab, DashboardLayout>>;
  hiddenTabs: DashboardTab[];
}

export const DEFAULT_DASHBOARD: DashboardPrefs = { lastTab: null, range: 'month', from: null, to: null, compare: true, branchId: null, layouts: {}, hiddenTabs: [] };

export function dashboardWithDefaults(stored: unknown): DashboardPrefs {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<DashboardPrefs>;
  return { ...DEFAULT_DASHBOARD, ...s, layouts: { ...(s.layouts ?? {}) }, hiddenTabs: s.hiddenTabs ?? [] };
}

/** Widgets of a tab in the person's order, without hidden ones. */
export function visibleWidgets(tab: DashboardTab, layout?: DashboardLayout) {
  const all = DASHBOARD_WIDGETS[tab].map((w) => w.key);
  const order = [...(layout?.order ?? []).filter((k) => all.includes(k)), ...all.filter((k) => !(layout?.order ?? []).includes(k))];
  return order.filter((k) => !(layout?.hidden ?? []).includes(k));
}

// ── Dates (India time, YYYY-MM-DD) ──

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * DAY));
export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / DAY) + 1;

/** The range for a preset, on `today`. Weeks start on Monday (or Sunday). */
export function rangeFor(preset: RangePreset, today: string, custom?: { from: string | null; to: string | null }, weekStart: 'monday' | 'sunday' = 'monday') {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') {
    const dow = parse(today).getUTCDay();
    const back = weekStart === 'monday' ? (dow + 6) % 7 : dow;
    return { from: addDays(today, -back), to: today };
  }
  if (preset === 'custom' && custom?.from && custom?.to) return { from: custom.from, to: custom.to };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** The same number of days just before the range. */
export function previousRange(r: { from: string; to: string }) {
  const n = daysBetween(r.from, r.to);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

/** Chart buckets: days up to a month, weeks up to ~6 months, then months. */
export function bucketsFor(r: { from: string; to: string }): { key: string; label: string; from: string; to: string }[] {
  const n = daysBetween(r.from, r.to);
  const out: { key: string; label: string; from: string; to: string }[] = [];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (n <= 31) {
    for (let i = 0; i < n; i++) {
      const d = addDays(r.from, i);
      out.push({ key: d, label: String(Number(d.slice(8))), from: d, to: d });
    }
  } else if (n <= 186) {
    for (let d = r.from, w = 1; d <= r.to; d = addDays(d, 7), w++) {
      const end = addDays(d, 6) > r.to ? r.to : addDays(d, 6);
      out.push({ key: d, label: `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`, from: d, to: end });
    }
  } else {
    for (let d = `${r.from.slice(0, 8)}01`; d <= r.to; ) {
      const y = Number(d.slice(0, 4));
      const m = Number(d.slice(5, 7));
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      out.push({ key: d, label: `${MON[m - 1]} ${String(y).slice(2)}`, from: d < r.from ? r.from : d, to: addDays(next, -1) > r.to ? r.to : addDays(next, -1) });
      d = next;
    }
  }
  return out;
}

/** GSTR-3B is due on the 20th of the month after the return period. */
export function gstr3bDue(periodEnd: string) {
  const y = Number(periodEnd.slice(0, 4));
  const m = Number(periodEnd.slice(5, 7));
  return m === 12 ? `${y + 1}-01-20` : `${y}-${String(m + 1).padStart(2, '0')}-20`;
}
