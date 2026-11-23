// Pure money rules for AHEAD's own bills: what a plan costs for a cycle with extra users, one
// discount, and GST on top (CGST + SGST inside AHEAD's state, IGST outside; none when AHEAD's
// GSTIN isn't set, as an unregistered seller can't charge GST).

export interface Seller {
  legalName: string;
  gstin: string;
  stateCode: string;
  address: string;
  email?: string;
  sac: string;
  gstRateBp: number;
}

export interface BillTo {
  name: string;
  gstin: string | null;
  stateCode: string | null;
  email: string;
  mobile: string;
  /** partner = the partner pays for its client's business */
  kind: 'business' | 'partner';
}

export interface Line {
  description: string;
  sac: string;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
}

export interface Quote {
  lines: Line[];
  listPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/** Round half away from zero, to the paisa */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

export function quote(input: {
  plan: { name: string; monthlyPaise: number | null; yearlyPaise: number | null };
  cycle: 'monthly' | 'yearly';
  extraUsers: number;
  extraUserPaise: { monthly: number; yearly: number };
  /** Either a percent, or an amount (a coupon), never both */
  discount: { percent: number } | { amountPaise: number } | null;
  seller: Seller;
  billTo: BillTo;
}): Quote {
  const unit = input.cycle === 'yearly' ? input.plan.yearlyPaise : input.plan.monthlyPaise;
  if (unit == null) throw new Error('This plan is priced by quote');
  const period = input.cycle === 'yearly' ? '1 year' : '1 month';
  const lines: Line[] = [{ description: `AHEAD ${input.plan.name} plan, ${period}`, sac: input.seller.sac, quantity: 1, unitPaise: unit, amountPaise: unit }];
  if (input.extraUsers > 0) {
    const u = input.extraUserPaise[input.cycle];
    lines.push({ description: `Extra users, ${period}`, sac: input.seller.sac, quantity: input.extraUsers, unitPaise: u, amountPaise: u * input.extraUsers });
  }
  const listPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
  const d = input.discount;
  const discountPaise = !d ? 0 : 'percent' in d ? round((listPaise * d.percent) / 100) : Math.min(d.amountPaise, listPaise);
  const taxablePaise = listPaise - discountPaise;
  const registered = !!input.seller.gstin;
  const tax = registered ? round((taxablePaise * input.seller.gstRateBp) / 10_000) : 0;
  // Place of supply is the buyer's state; no state given: treated as outside (IGST)
  const intra = registered && !!input.billTo.stateCode && input.billTo.stateCode === input.seller.stateCode;
  const cgstPaise = intra ? Math.floor(tax / 2) : 0;
  const sgstPaise = intra ? tax - cgstPaise : 0;
  const igstPaise = intra ? 0 : tax;
  return { lines, listPaise, discountPaise, taxablePaise, cgstPaise, sgstPaise, igstPaise, totalPaise: taxablePaise + tax };
}

/** Financial year in India (April–March), e.g. "26-27" */
export function financialYear(date: Date) {
  const ist = new Date(date.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() + 1 >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** The period a payment buys: from the current period's end if it is still running, else from now */
export function nextPeriod(currentEnd: Date | null, cycle: 'monthly' | 'yearly', now = new Date()) {
  const start = currentEnd && currentEnd > now ? currentEnd : now;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + (cycle === 'yearly' ? 12 : 1));
  return { start, end };
}

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
