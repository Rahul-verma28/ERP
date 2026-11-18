import { describe, expect, it } from 'vitest';
import { availableTabs } from '../modules/reports/dashboard';
import { bucketsFor, dashboardWithDefaults, daysBetween, gstr3bDue, previousRange, rangeFor, visibleWidgets } from '../contracts/dashboard';

// Phase 3: date ranges, comparison periods, chart buckets and saved layouts (no database).

describe('dashboard ranges', () => {
  const today = '2026-10-25'; // a Sunday

  it('builds the presets in India dates', () => {
    expect(rangeFor('today', today)).toEqual({ from: today, to: today });
    expect(rangeFor('month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(rangeFor('week', today)).toEqual({ from: '2026-10-19', to: today });
    expect(rangeFor('week', today, undefined, 'sunday')).toEqual({ from: today, to: today });
    expect(rangeFor('custom', today, { from: '2026-04-01', to: '2026-09-30' })).toEqual({ from: '2026-04-01', to: '2026-09-30' });
    // Custom without dates falls back to this month
    expect(rangeFor('custom', today, { from: null, to: null })).toEqual({ from: '2026-10-01', to: today });
  });

  it('compares with the same number of days just before', () => {
    expect(previousRange({ from: '2026-10-01', to: '2026-10-25' })).toEqual({ from: '2026-09-06', to: '2026-09-30' });
    expect(previousRange({ from: today, to: today })).toEqual({ from: '2026-10-24', to: '2026-10-24' });
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(31);
  });

  it('picks days, weeks or months for the chart', () => {
    expect(bucketsFor({ from: '2026-10-01', to: '2026-10-25' })).toHaveLength(25);
    const weeks = bucketsFor({ from: '2026-07-01', to: '2026-09-30' });
    expect(weeks[0]).toMatchObject({ from: '2026-07-01', to: '2026-07-07', label: '1 Jul' });
    expect(weeks.at(-1)!.to).toBe('2026-09-30');
    const months = bucketsFor({ from: '2025-04-15', to: '2026-03-31' });
    expect(months.map((m) => m.label)).toEqual(['Apr 25', 'May 25', 'Jun 25', 'Jul 25', 'Aug 25', 'Sep 25', 'Oct 25', 'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26']);
    expect(months[0].from).toBe('2025-04-15');
  });

  it('knows the GSTR-3B date', () => {
    expect(gstr3bDue('2026-10-25')).toBe('2026-11-20');
    expect(gstr3bDue('2026-12-31')).toBe('2027-01-20');
  });
});

describe('dashboard tabs per role', () => {
  const ctx = { kind: 'tenant', tenantId: 't', userId: 'u', memberId: 'm', roleId: 'r', sessionId: 's', branchIds: [] } as never;
  const scopedFor = (keys: string[]) => (key: string) => (keys.includes(key) ? ({ ...(ctx as object), scope: 'all' } as never) : null);
  const keys = (perm: string[], readOnly: string[] = []) => availableTabs(scopedFor(perm), (m) => readOnly.includes(m)).map((t) => `${t.key}${t.readOnly ? '(ro)' : ''}`);

  it('gives the owner the Overview and a tab per module', () => {
    expect(keys(['reports.dashboard.view', 'billing.invoice.view', 'sales.quotation.view', 'crm.contact.view', 'bookings.appointment.view', 'finance.expense.view', 'tasks.task.view'], ['finance'])).toEqual(['overview', 'billing', 'sales', 'crm', 'bookings', 'finance(ro)', 'tasks']);
  });

  it('gives staff without money views "My day" instead of the Overview', () => {
    expect(keys(['reports.dashboard.view', 'bookings.appointment.view', 'tasks.task.view'])).toEqual(['myday', 'bookings', 'tasks']);
  });

  it('shows nothing without the dashboard permission, and no tab for modules the role can\'t see', () => {
    expect(keys(['billing.invoice.view'])).toEqual(['billing']);
    expect(keys(['bookings.appointment.view'])).toEqual(['myday', 'bookings']);
    expect(keys(['reports.dashboard.view', 'billing.invoice.view'])).toEqual(['overview', 'billing']);
  });
});

describe('dashboard layout', () => {
  it('keeps the person order, adds new widgets at the end and drops hidden ones', () => {
    expect(visibleWidgets('overview', { order: ['trend', 'kpis', 'gone'], hidden: ['activity'] })).toEqual(['trend', 'kpis', 'inbox', 'today']);
    expect(visibleWidgets('tasks')).toEqual(['kpis', 'projects', 'people', 'due']);
  });

  it('fills defaults for a first visit', () => {
    expect(dashboardWithDefaults(undefined)).toMatchObject({ range: 'month', compare: true, lastTab: null, hiddenTabs: [] });
    expect(dashboardWithDefaults({ range: 'week' }).range).toBe('week');
  });
});
