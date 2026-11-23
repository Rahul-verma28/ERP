import { randomBytes } from 'node:crypto';
import { prisma } from '../src/kernel/db';
import { hashPassword } from '../src/kernel/crypto';
import { totpCode } from '../src/kernel/totp';
import { testWebhook } from '../src/modules/billing/gateway';

// Billing end to end against running servers (ERP on 5000, a Console API with email off):
//   PORT=5101 SMTP_HOST= npx tsx src/server.ts   then   npx tsx scripts/e2e-billing.ts
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:5101';
const API = `${BASE}/api/v1`;
async function call(method: string, path: string, body?: unknown, token?: string, raw?: { body: string; headers: Record<string, string> }) {
  const r = await fetch(API + path, { method, headers: raw?.headers ?? { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: raw?.body ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(700); }
}
async function signIn(email: string, role: 'admin' | 'sales') {
  const pw = `Qa-${randomBytes(6).toString('hex')}-9`;
  await prisma.consoleUser.deleteMany({ where: { email } });
  await prisma.consoleUser.create({ data: { name: `E2E ${role}`, email, role, status: 'active', passwordHash: await hashPassword(pw) } });
  const l = await call('POST', '/auth/login', { email, password: pw });
  if (l.body.accessToken) return l.body.accessToken as string;
  const s = await call('POST', '/auth/mfa/setup', { setupToken: l.body.setupToken });
  return (await call('POST', '/auth/mfa/enable', { setupToken: l.body.setupToken, code: totpCode(s.body.secret) })).body.accessToken as string;
}

async function main() {
  const out: Record<string, unknown> = {};
  const admin = await signIn('e2e.billing.admin@example.test', 'admin');
  const tag = randomBytes(3).toString('hex');

  // A business that starts on Standard, monthly, 10% off: waits for its first payment
  const quoteBody = { planKey: 'standard', cycle: 'monthly', extraUsers: 1, discountPct: 10 };
  const created = await call('POST', '/businesses', { name: `E2E Billing ${tag}`, industryKey: 'retail', gstin: null, stateCode: '27', owner: { name: 'Bill Owner', email: `e2e.bill.${tag}@example.test`, mobile: `9${String(Date.now()).slice(-9)}` }, start: { kind: 'paid', ...quoteBody } }, admin);
  const id = created.body.id as string;
  out.created = [created.status, created.body.firstOrder?.status, created.body.firstOrder?.totalPaise];
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  const q = await call('POST', `/billing/businesses/${id}/quote`, quoteBody, admin);
  out.quote = { list: q.body.listPaise, discount: q.body.discountPaise, igst: q.body.igstPaise, total: q.body.totalPaise, kind: q.body.kind };
  await until(async () => (await prisma.business.findUnique({ where: { id } }))?.provisionedAt);
  const erpLicence = async () => (await call('GET', `/businesses/${id}`, undefined, admin)).body.facts?.licence;
  out.beforePay = (await erpLicence())?.status;

  // Pay through the test gateway's page
  const order = await prisma.order.findFirstOrThrow({ where: { businessId: id, status: 'awaiting_payment' } });
  const pay = await fetch(`${API}/pay/test/${order.linkId}`, { method: 'POST' });
  out.payPage = (await pay.text()).includes('Payment received');
  const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { invoice: true, payments: true } });
  out.paid = { status: paid.status, invoice: paid.invoice?.number, payments: paid.payments.length };
  out.afterPay = await until(async () => { const l = await erpLicence(); return l?.status === 'active' ? `${l.plan}/${l.status}` : null; });
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: id } });
  out.subscription = { status: sub.status, plan: sub.planKey, extraUsers: sub.extraUsers, periodEnd: sub.periodEnd?.toISOString().slice(0, 10) };

  // The same gateway event twice: nothing more happens
  const again = testWebhook(order.linkId!, order.totalPaise);
  const replay = await call('POST', '/webhooks/test', undefined, undefined, { body: again.body, headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': again.signature, 'x-razorpay-event-id': again.eventId } });
  const replay2 = await call('POST', '/webhooks/test', undefined, undefined, { body: again.body, headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': again.signature, 'x-razorpay-event-id': again.eventId } });
  out.replay = [replay.body.status, replay2.body.status, (await prisma.payment.count({ where: { orderId: order.id } }))];
  out.badSignature = (await call('POST', '/webhooks/test', undefined, undefined, { body: again.body, headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'bad' } })).status;

  // A salesperson's discount above their limit waits for Admin
  const sales = await signIn('e2e.billing.sales@example.test', 'sales');
  await prisma.business.update({ where: { id }, data: { onboardedById: (await prisma.consoleUser.findUniqueOrThrow({ where: { email: 'e2e.billing.sales@example.test' } })).id } });
  const big = await call('POST', `/billing/businesses/${id}/orders`, { planKey: 'professional', cycle: 'yearly', discountPct: 25 }, sales);
  out.salesDiscount = big.body.status;
  out.salesCantApprove = (await call('POST', `/billing/orders/${big.body.id}/approve`, undefined, sales)).status;
  const approved = await call('POST', `/billing/orders/${big.body.id}/approve`, undefined, admin);
  out.adminApproves = !!approved.body.url;

  // Paid by bank transfer, recorded by the team
  const o2 = await prisma.order.findUniqueOrThrow({ where: { id: big.body.id } });
  out.wrongAmount = (await call('POST', `/billing/orders/${o2.id}/payments`, { method: 'bank', reference: 'UTR123456', amountPaise: 100 }, admin)).status;
  const off = await call('POST', `/billing/orders/${o2.id}/payments`, { method: 'bank', reference: 'UTR123456', amountPaise: o2.totalPaise }, admin);
  out.offline = [off.status, off.body.invoice];
  out.afterChange = await until(async () => { const l = await erpLicence(); return l?.plan === 'professional' ? `${l.plan}/${l.status}` : null; });

  // Refund: credit note and back to Free
  const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: o2.id } });
  const cn = await call('POST', `/billing/invoices/${inv.id}/credit-note`, { reason: 'Customer asked to cancel', endPlan: true }, admin);
  out.creditNote = [cn.status, cn.body.number];
  out.afterRefund = await until(async () => { const l = await erpLicence(); return l?.status === 'free' ? `${l.plan}/${l.status}` : null; });
  out.invoices = (await call('GET', `/billing/invoices?businessId=${id}`, undefined, admin)).body.data.map((i: any) => [i.number, i.totalPaise, i.creditNote?.number ?? null]);

  // Clean up the test people (the test business stays, closed)
  await prisma.consoleUser.deleteMany({ where: { email: { in: ['e2e.billing.admin@example.test', 'e2e.billing.sales@example.test'] } } });
  console.log(JSON.stringify(out, null, 1));
  console.log('E2E_BUSINESS', id);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
