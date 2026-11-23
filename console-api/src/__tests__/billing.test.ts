import { describe, expect, it } from 'vitest';
import { financialYear, nextPeriod, quote, type BillTo, type Seller } from '../modules/billing/money';

const seller: Seller = { legalName: 'AHEAD Software', gstin: '09AAACH7409R1ZZ', stateCode: '09', address: 'Noida', sac: '998314', gstRateBp: 1800 };
const plan = { name: 'Standard', monthlyPaise: 99_900, yearlyPaise: 999_000 };
const up: BillTo = { kind: 'business', name: 'B', gstin: null, stateCode: '09', email: 'b@x.in', mobile: '+919876543210' };
const mh: BillTo = { ...up, stateCode: '27' };
const extra = { monthly: 19_900, yearly: 199_000 };

describe('AHEAD bills', () => {
  it('splits GST into CGST and SGST inside AHEAD’s state', () => {
    const q = quote({ plan, cycle: 'monthly', extraUsers: 0, extraUserPaise: extra, discount: null, seller, billTo: up });
    expect(q).toMatchObject({ listPaise: 99_900, taxablePaise: 99_900, cgstPaise: 8991, sgstPaise: 8991, igstPaise: 0, totalPaise: 117_882 });
  });
  it('charges IGST outside it, and when the state is unknown', () => {
    expect(quote({ plan, cycle: 'monthly', extraUsers: 0, extraUserPaise: extra, discount: null, seller, billTo: mh })).toMatchObject({ igstPaise: 17_982, cgstPaise: 0, totalPaise: 117_882 });
    expect(quote({ plan, cycle: 'monthly', extraUsers: 0, extraUserPaise: extra, discount: null, seller, billTo: { ...up, stateCode: null } }).igstPaise).toBe(17_982);
  });
  it('adds extra users and takes one discount before tax', () => {
    const q = quote({ plan, cycle: 'yearly', extraUsers: 2, extraUserPaise: extra, discount: { percent: 10 }, seller, billTo: mh });
    expect(q.lines).toHaveLength(2);
    expect(q.listPaise).toBe(999_000 + 2 * 199_000);
    expect(q.discountPaise).toBe(139_700);
    expect(q.taxablePaise).toBe(1_257_300);
    expect(q.totalPaise).toBe(1_257_300 + 226_314);
  });
  it('never takes off more than the price', () => {
    expect(quote({ plan, cycle: 'monthly', extraUsers: 0, extraUserPaise: extra, discount: { amountPaise: 500_000 }, seller, billTo: up }).totalPaise).toBe(0);
  });
  it('charges no GST while AHEAD has no GSTIN', () => {
    expect(quote({ plan, cycle: 'monthly', extraUsers: 0, extraUserPaise: extra, discount: null, seller: { ...seller, gstin: '' }, billTo: up })).toMatchObject({ totalPaise: 99_900, cgstPaise: 0, igstPaise: 0 });
  });
  it('refuses a plan priced by quote', () => {
    expect(() => quote({ plan: { name: 'Enterprise', monthlyPaise: null, yearlyPaise: null }, cycle: 'monthly', extraUsers: 0, extraUserPaise: extra, discount: null, seller, billTo: up })).toThrow(/quote/);
  });
  it('renews from the end of a running period, else from today', () => {
    const now = new Date('2026-11-24T00:00:00Z');
    expect(nextPeriod(new Date('2026-12-01T00:00:00Z'), 'monthly', now).end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(nextPeriod(new Date('2026-11-01T00:00:00Z'), 'yearly', now).end.toISOString()).toBe('2027-11-24T00:00:00.000Z');
  });
  it('numbers by the Indian financial year', () => {
    // 1 April 00:00 in India is 31 March 18:30 UTC
    expect(financialYear(new Date('2026-03-31T18:30:00Z'))).toBe('26-27');
    expect(financialYear(new Date('2026-03-31T18:29:00Z'))).toBe('25-26');
  });
});
