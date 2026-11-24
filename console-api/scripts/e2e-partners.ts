import { randomBytes } from 'node:crypto';
import { prisma } from '../src/kernel/db';
import { hashPassword } from '../src/kernel/crypto';
import { totpCode } from '../src/kernel/totp';
import { billPartner } from '../src/modules/partners/service';

// Partners end to end against running servers (ERP on 5000, a Console API with email off):
//   PORT=5101 SMTP_HOST= npx tsx src/server.ts   then   SMTP_HOST= npx tsx scripts/e2e-partners.ts
const API = `${process.env.E2E_BASE ?? 'http://127.0.0.1:5101'}/api/v1`;
async function call(method: string, path: string, body?: unknown, token?: string, raw?: { body: Buffer; type: string; name: string }) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': raw?.type ?? 'application/json', ...(raw ? { 'X-File-Name': raw.name } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ? new Uint8Array(raw.body) : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, body: json };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(700); }
}
async function adminToken() {
  const email = 'e2e.partners.admin@example.test';
  const pw = `Qa-${randomBytes(6).toString('hex')}-9`;
  await prisma.consoleUser.deleteMany({ where: { email } });
  await prisma.consoleUser.create({ data: { name: 'E2E Admin', email, role: 'admin', status: 'active', passwordHash: await hashPassword(pw) } });
  const l = await call('POST', '/auth/login', { email, password: pw });
  const s = await call('POST', '/auth/mfa/setup', { setupToken: l.body.setupToken });
  return (await call('POST', '/auth/mfa/enable', { setupToken: l.body.setupToken, code: totpCode(s.body.secret) })).body.accessToken as string;
}

async function main() {
  const out: Record<string, unknown> = {};
  const admin = await adminToken();
  const tag = randomBytes(3).toString('hex');
  const ownerEmail = `e2e.partner.${tag}@example.test`;

  // The website form
  const form = { kind: 'partner', name: 'Pooja Partner', company: `E2E Resellers ${tag}`, email: ownerEmail, mobile: `8${String(Date.now()).slice(-9)}`, stateCode: '27', city: 'Pune' };
  out.apply = (await call('POST', '/public/applications', form)).status;
  out.applyAgain = (await call('POST', '/public/applications', { ...form, message: 'Calling back' })).status;
  out.companyRequired = (await call('POST', '/public/applications', { ...form, company: null })).status;
  const app = (await call('GET', '/applications', undefined, admin)).body.data.find((a: any) => a.email === ownerEmail);
  out.noKycNoApprove = (await call('POST', `/applications/${app.id}/approve`, { discountPct: 20 }, admin)).body?.error?.message;
  out.textRefused = (await call('POST', `/files?entityType=application&entityId=${app.id}`, undefined, admin, { body: Buffer.from('just text'), type: 'application/octet-stream', name: 'pan.txt' })).status;
  out.kycUpload = (await call('POST', `/files?entityType=application&entityId=${app.id}`, undefined, admin, { body: Buffer.from('%PDF-1.4\n% test PAN card\n'), type: 'application/octet-stream', name: 'PAN card.pdf' })).status;
  const approved = await call('POST', `/applications/${app.id}/approve`, { discountPct: 20 }, admin);
  out.approved = [approved.status, approved.body.kind];
  const partnerId = approved.body.resultId as string;

  // The partner owner signs in (password set as the invite link would)
  const pw = `Qa-${randomBytes(6).toString('hex')}-9`;
  await prisma.consoleUser.update({ where: { email: ownerEmail }, data: { passwordHash: await hashPassword(pw), status: 'active' } });
  const p = (await call('POST', '/auth/login', { email: ownerEmail, password: pw })).body.accessToken as string;
  out.partnerSignedIn = !!p;
  const detail = await call('GET', `/partners/${partnerId}`, undefined, p);
  out.kycMoved = detail.body.files?.length;
  out.cantSeeOtherPartners = (await call('GET', '/partners', undefined, p)).status;

  // Its clients: one on trial, one on a plan the partner pays for
  const mk = (name: string, start: unknown) => call('POST', '/businesses', { name, industryKey: 'retail', owner: { name: 'Client Owner', email: `e2e.client.${randomBytes(3).toString('hex')}@example.test`, mobile: `7${String(Date.now() + Math.floor(Math.random() * 1e5)).slice(-9)}` }, start }, p);
  const trial = await mk(`E2E Client Trial ${tag}`, { kind: 'trial' });
  const paid = await mk(`E2E Client Plan ${tag}`, { kind: 'partner_plan', planKey: 'standard' });
  out.clients = [trial.status, paid.status, (await prisma.subscription.findUniqueOrThrow({ where: { businessId: paid.body.id } })).status];
  out.notPaidStart = (await mk('Nope', { kind: 'paid', planKey: 'standard', cycle: 'monthly' })).status;
  out.seesOnlyOwn = (await call('GET', '/businesses', undefined, p)).body.total;
  await until(async () => (await prisma.business.findUnique({ where: { id: trial.body.id } }))?.provisionedAt);
  await call('POST', `/businesses/${trial.body.id}/plan`, { planKey: 'professional' }, p);
  out.trialToProfessional = await until(async () => { const l = (await call('GET', `/businesses/${trial.body.id}`, undefined, p)).body.facts?.licence; return l?.plan === 'professional' && l.status === 'active' ? 'professional/active' : null; });
  out.noOrdersForPartnerClients = await prisma.order.count({ where: { businessId: { in: [trial.body.id, paid.body.id] } } });

  // This month's bill: 999 + 2,499 at 20% off = ₹2,798.40, GST on top
  const month = (await call('GET', `/partners/${partnerId}`, undefined, p)).body.thisMonth;
  out.thisMonth = { subtotal: month.subtotalPaise, total: month.totalPaise };
  const bill = await billPartner(partnerId);
  out.billOnce = [!!bill, await billPartner(partnerId)];
  const pay = await fetch(`${API}/pay/test/${bill!.linkId}`, { method: 'POST' });
  out.billPaid = [(await pay.text()).includes('Payment received'), (await prisma.partnerBill.findUniqueOrThrow({ where: { id: bill!.id } })).invoiceNumber];

  // Paused: the partner's people are out at once
  await call('PATCH', `/partners/${partnerId}`, { status: 'disabled' }, admin);
  out.pausedToken = (await call('GET', '/me', undefined, p)).status;
  out.pausedLogin = (await call('POST', '/auth/login', { email: ownerEmail, password: pw })).status;
  await call('PATCH', `/partners/${partnerId}`, { status: 'active' }, admin);

  // A vendor
  const vEmail = `e2e.vendor.${tag}@example.test`;
  await call('POST', '/public/applications', { kind: 'vendor', name: 'Vikram Vendor', email: vEmail, mobile: `6${String(Date.now()).slice(-9)}` });
  const vApp = (await call('GET', '/applications', undefined, admin)).body.data.find((a: any) => a.email === vEmail);
  const v = await call('POST', `/applications/${vApp.id}/approve`, {}, admin);
  const vendor = await prisma.consoleUser.findUnique({ where: { email: vEmail }, select: { role: true, referralCode: true, status: true } });
  out.vendor = [v.status, vendor?.role, !!vendor?.referralCode, vendor?.status];

  await prisma.consoleUser.deleteMany({ where: { email: 'e2e.partners.admin@example.test' } });
  console.log(JSON.stringify(out, null, 1));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
