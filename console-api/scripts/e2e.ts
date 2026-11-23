import { randomBytes } from 'node:crypto';
import { prisma } from '../src/kernel/db';
import { hashPassword } from '../src/kernel/crypto';
import { totpCode } from '../src/kernel/totp';

// End-to-end check against running servers (ERP on 5000, a Console API with email off):
//   PORT=5101 SMTP_HOST= npx tsx src/server.ts   then   npx tsx scripts/e2e.ts
const API = process.env.E2E_API ?? 'http://127.0.0.1:5101/api/v1';
let cookie = '';
async function call(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await wait(700);
  }
}

async function main() {
  const out: Record<string, unknown> = {};
  const pw = `Qa-${randomBytes(6).toString('hex')}-9`;
  const email = 'e2e.admin@example.test';
  await prisma.consoleUser.deleteMany({ where: { email: { in: [email, 'e2e.sales@example.test'] } } });
  await prisma.consoleUser.create({ data: { name: 'E2E Admin', email, role: 'admin', status: 'active', passwordHash: await hashPassword(pw) } });

  // Sign in: wrong password, then right one → two-step setup required for Admin
  out.wrongPassword = (await call('POST', '/auth/login', { email, password: 'nope-nope-1' })).status;
  const l1 = await call('POST', '/auth/login', { email, password: pw });
  out.mfaSetupRequired = l1.body?.mfaSetupRequired;
  const setup = await call('POST', '/auth/mfa/setup', { setupToken: l1.body.setupToken });
  out.wrongCode = (await call('POST', '/auth/mfa/enable', { setupToken: l1.body.setupToken, code: '000000' })).status;
  const on = await call('POST', '/auth/mfa/enable', { setupToken: l1.body.setupToken, code: totpCode(setup.body.secret) });
  const token = on.body.accessToken as string;
  out.signedIn = !!token;
  // Next sign-in asks for the code
  const l2 = await call('POST', '/auth/login', { email, password: pw });
  out.nextLoginAsksCode = l2.body?.mfaRequired;
  out.refresh = (await call('POST', '/auth/refresh')).status;
  out.me = (await call('GET', '/me', undefined, token)).body?.role;
  out.plans = (await call('GET', '/catalog/plans', undefined, token)).body?.data?.map((p: any) => p.key);

  // A business, set up in the ERP by the outbox
  const tag = randomBytes(3).toString('hex');
  const mobile = `9${String(Date.now()).slice(-9)}`;
  const created = await call('POST', '/businesses', { name: `E2E Traders ${tag}`, industryKey: 'retail', owner: { name: 'E2E Owner', email: `e2e.owner.${tag}@example.test`, mobile }, start: { kind: 'trial' } }, token);
  out.create = created.status;
  const id = created.body.id as string;
  await until(async () => (await prisma.business.findUnique({ where: { id } }))?.provisionedAt);
  const detail = await call('GET', `/businesses/${id}`, undefined, token);
  out.inErp = { live: detail.body.factsLive, status: detail.body.facts?.status, owner: detail.body.facts?.owner?.name, licence: detail.body.facts?.licence?.plan, branches: detail.body.facts?.team?.branches };
  out.duplicateTrial = (await call('POST', '/businesses', { name: 'Again', industryKey: 'retail', owner: { name: 'E2E Owner', email: `e2e.owner.${tag}@example.test`, mobile }, start: { kind: 'trial' } }, token)).body?.error?.code;

  // Plan, module switch, close, reopen → each reaches the ERP's licence
  const erpPlan = async () => (await call('GET', `/businesses/${id}`, undefined, token)).body.facts?.licence;
  await call('POST', `/businesses/${id}/plan`, { planKey: 'standard', cycle: 'monthly' }, token);
  out.afterPlan = await until(async () => { const l = await erpPlan(); return l?.plan === 'standard' && l.status === 'active' ? l.plan + '/' + l.status : null; });
  out.moduleOn = (await call('PUT', `/businesses/${id}/modules/hr`, { state: 'on' }, token)).status;
  await call('POST', `/businesses/${id}/close`, undefined, token);
  out.afterClose = await until(async () => { const l = await erpPlan(); return l?.status === 'closed' ? 'closed' : null; });
  await call('POST', `/businesses/${id}/reopen`, undefined, token);
  out.afterReopen = await until(async () => { const l = await erpPlan(); return l?.status === 'free' ? `${l.plan}/free` : null; });

  // A salesperson sees only the businesses they brought
  const sales = await prisma.consoleUser.create({ data: { name: 'E2E Sales', email: 'e2e.sales@example.test', role: 'sales', status: 'active', passwordHash: await hashPassword(pw) } });
  cookie = '';
  const s = await call('POST', '/auth/login', { email: sales.email, password: pw });
  out.salesNoMfaNeeded = !!s.body.accessToken;
  out.salesSees = (await call('GET', '/businesses', undefined, s.body.accessToken)).body?.total;
  out.salesCantChangePlan = (await call('POST', `/businesses/${id}/plan`, { planKey: 'free' }, s.body.accessToken)).status;
  out.unsigned = (await call('GET', '/businesses')).status;

  console.log(JSON.stringify(out, null, 1));
  console.log('E2E_BUSINESS', id);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
