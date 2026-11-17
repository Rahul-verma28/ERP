// Top-up demo data for the HR additions: approval on events and documents, employee papers,
// descriptions on setup lists and leave types, and holiday and loan types from the setup lists.
// Usage: npx tsx prisma/demo-hr-extra.ts <tenantId> [<tenantId> …]
// Safe to run again: each part checks what is already there.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import * as setup from '../src/modules/hr/setup';
import * as people from '../src/modules/hr/people';
import * as rec from '../src/modules/hr/records';

const step = <T>(label: string, fn: () => Promise<T>) =>
  withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 }).then((r) => { console.log(`  ✔ ${label}`); return r; });
const roll = (key: string) => { let h = 7; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 100; };

const NOTES: Record<string, Record<string, string>> = {
  awardTypes: { 'Employee of the month': 'Best all-round work in the month', 'Best salesperson': 'Highest sales in the period', 'Long service': 'Five or more years with us', 'Perfect attendance': 'No unplanned leave all year' },
  warningTypes: { 'Late coming': 'Late more than three times in a month', Misconduct: 'Rude or unsafe behaviour at work', 'Poor performance': 'Targets missed for two months in a row' },
  complaintTypes: { Harassment: 'Handled in confidence by the owner', 'Pay issue': 'Salary, overtime or deduction not right', 'Workplace safety': 'Unsafe equipment or place' },
  terminationTypes: { Misconduct: 'Serious breach of company rules', 'Poor performance': 'No improvement after warnings', Redundancy: 'Role no longer needed', 'End of contract': 'Fixed-term contract finished', Absconding: 'Absent without notice for 7+ days' },
  allowanceTypes: { HRA: 'House rent allowance, usually 40–50% of basic', Conveyance: 'Travel to work', 'Special allowance': 'Balances the salary to the agreed CTC', Medical: 'Medical bills', Incentive: 'Monthly sales incentive' },
  deductionTypes: { TDS: 'Income tax deducted at source', Canteen: 'Meals at the canteen', Uniform: 'Cost of uniforms, recovered monthly' },
  holidayTypes: { National: 'Republic Day, Independence Day, Gandhi Jayanti', Festival: 'Diwali, Holi, Eid and other festivals', Regional: 'State or local holidays', Company: 'Foundation day and company off days', Optional: 'Staff choose to take it or not' },
  loanTypes: { 'Salary advance': 'Part of next salary, taken back in 1–3 months', 'Personal loan': 'Larger amounts over 6–12 months', 'Medical loan': 'For medical emergencies, no interest', 'Festival advance': 'Before Diwali or other festivals', 'Vehicle loan': 'Two-wheeler for delivery staff' },
  announcementCategories: { General: 'Day-to-day notices', Policy: 'Changes to company rules', Celebration: 'Birthdays, festivals, achievements', Urgent: 'Needs everyone’s attention today' },
  eventTypes: { Meeting: 'Team or all-hands meetings', Celebration: 'Festivals and parties', Training: 'Product or skills training', Outing: 'Team trips' },
  documentCategories: { Policy: 'Rules everyone follows', Handbook: 'The employee handbook', Form: 'Forms to fill in', Agreement: 'Contracts and NDAs' },
};
const LEAVE_NOTES: Record<string, string> = {
  'Casual leave': 'Short personal work or emergencies; apply a day before when you can',
  'Sick leave': 'When unwell; a doctor’s note is needed for more than 2 days',
  'Earned leave': 'Earned by working days; can be carried forward and encashed',
  'Loss of pay': 'Leave beyond your balance; salary is cut for these days',
  'Maternity leave': '26 weeks paid under the Maternity Benefit Act',
};

async function seed(tenantId: string) {
  const t = await withPlatform(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  const member = await withPlatform(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };

  await step('descriptions on setup lists', async () => {
    const cfg = await setup.getConfig(ctx);
    const listNotes: Record<string, string> = {};
    for (const [list, notes] of Object.entries(NOTES)) {
      const items = (cfg.lists as Record<string, string[]>)[list] ?? [];
      for (const [name, note] of Object.entries(notes)) if (items.includes(name) && !cfg.listNotes[`${list}::${name}`]) listNotes[`${list}::${name}`] = note;
    }
    await setup.updateConfig(ctx, { listNotes });
  });

  await step('leave type descriptions', async () => {
    for (const [name, description] of Object.entries(LEAVE_NOTES)) await db().leaveType.updateMany({ where: { tenantId, name, description: null }, data: { description } });
  });

  await step('holiday and loan types from the setup lists', async () => {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    for (const h of await db().holiday.findMany({ where: { tenantId } })) if (h.kind !== cap(h.kind)) await db().holiday.update({ where: { id: h.id }, data: { kind: cap(h.kind) } });
    await db().hrLoan.updateMany({ where: { tenantId, kind: 'advance' }, data: { kind: 'Salary advance' } });
    await db().hrLoan.updateMany({ where: { tenantId, kind: 'loan' }, data: { kind: 'Personal loan' } });
  });

  await step('approvals on events and documents', async () => {
    const old = await db().hrPost.findMany({ where: { tenantId, kind: { in: ['event', 'document'] }, status: { in: ['active', 'draft', 'inactive'] } }, orderBy: { createdAt: 'asc' } });
    for (const [i, p] of old.entries()) {
      // Most were already live, so they become approved; the newest one of each kind waits for approval
      const last = old.filter((x) => x.kind === p.kind).at(-1)?.id === p.id && i > 0;
      const status = p.status === 'active' && !last ? 'approved' : 'pending';
      await db().hrPost.update({ where: { id: p.id }, data: { status, approvedBy: status === 'approved' ? ctx.userId : null, approvedAt: status === 'approved' ? p.createdAt : null } });
    }
    const has = async (title: string) => !!(await db().hrPost.findFirst({ where: { tenantId, title } }));
    const add = async (b: Parameters<typeof people.savePost>[1], status: string) => {
      if (await has(b.title)) return;
      const p = await people.savePost(ctx, b);
      if (status !== 'pending') await people.setPostStatus(ctx, p.id, status);
    };
    const doc = (title: string, category: string, url: string, needsAck = false) => people.PostInput.parse({ kind: 'document', title, category, url, needsAck, priority: 'normal' });
    await add(doc('Work from home policy (draft)', 'Policy', 'https://drive.google.com/file/d/demo-wfh-policy', true), 'pending');
    await add(doc('Travel reimbursement form', 'Form', 'https://drive.google.com/file/d/demo-travel-form'), 'pending');
    await add(doc('Old attendance rules 2024', 'Policy', 'https://drive.google.com/file/d/demo-old-rules'), 'rejected');
    await add(people.PostInput.parse({ kind: 'event', title: 'Quarterly sales review', category: 'Meeting', startsOn: '2026-12-05', startsAt: '11:00', endsAt: '12:30', location: 'Main shop, first floor', body: 'Each salesperson brings their numbers for the quarter.', priority: 'normal' }), 'pending');
    await add(people.PostInput.parse({ kind: 'event', title: 'New year party', category: 'Celebration', startsOn: '2026-12-31', startsAt: '19:00', endsAt: '22:00', location: 'Hotel Clarks', body: 'Families welcome.', priority: 'normal' }), 'approved');
  });

  await step('employee documents', async () => {
    const emps = await db().employee.findMany({ where: { tenantId }, orderBy: { joinedOn: 'asc' } });
    const already = new Set((await db().hrRecord.findMany({ where: { tenantId, kind: 'emp_doc' }, select: { refId: true } })).map((r) => r.refId));
    for (const [i, e] of emps.entries()) {
      if (already.has(e.id)) continue;
      const r = roll(e.name);
      const docs: { type: string; number?: string; issued?: string; expires?: string; status: string }[] = [];
      docs.push({ type: 'Aadhaar card', number: `XXXX XXXX ${String(1000 + r * 37).slice(-4)}`, status: 'verified' });
      if (e.pan) docs.push({ type: 'PAN card', number: e.pan, status: 'verified' });
      // A few have not handed in the cheque yet, so their profile shows it as missing
      if (r % 4 !== 0) docs.push({ type: 'Cancelled cheque or passbook', status: i % 5 === 1 ? 'pending' : 'verified' });
      if (r % 2 === 0) docs.push({ type: 'Passport photo', status: 'verified' });
      if (r % 3 === 0) docs.push({ type: 'Education certificate', number: 'B.Com', issued: '2018-06-30', status: i % 6 === 2 ? 'rejected' : 'verified' });
      if (i < 4) docs.push({ type: 'Experience or relieving letter', issued: '2021-03-31', status: 'pending' });
      // One driving licence that has run out, so the profile flags it
      if (e.designationId && i % 7 === 3) docs.push({ type: 'Driving licence', number: `UP32 2019 00${r}45`, issued: '2019-02-01', expires: '2026-02-01', status: 'verified' });
      for (const d of docs) {
        const row = await rec.createRecord(ctx, 'emp_doc', { employeeId: e.id, documentType: d.type, number: d.number ?? null, url: `https://drive.google.com/file/d/demo-${d.type.split(' ')[0].toLowerCase()}-${e.code}`, issuedOn: d.issued ?? null, expiresOn: d.expires ?? null, notes: d.status === 'rejected' ? 'Photo copy not clear, please send again' : null });
        if (d.status !== 'pending') await rec.setRecordStatus(ctx, row.id, d.status);
      }
    }
  });

  await step('career records: documents, who a complaint is about, warning replies', async () => {
    const emps = await db().employee.findMany({ where: { tenantId, status: { not: 'exited' } }, select: { id: true, code: true }, orderBy: { joinedOn: 'asc' } });
    const acts = await db().hrAction.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    for (const [i, a] of acts.entries()) {
      const data: Record<string, unknown> = {};
      // About half have the signed letter attached
      if (!a.documentUrl && ['promotion', 'transfer', 'resignation', 'termination', 'warning'].includes(a.kind) && i % 2 === 0) data.documentUrl = `https://drive.google.com/file/d/demo-${a.kind}-letter-${i}`;
      if (a.kind === 'complaint' && !a.againstId && i % 3 !== 0) {
        const other = emps.find((e, k) => e.id !== a.employeeId && k % 3 === i % 3) ?? emps.find((e) => e.id !== a.employeeId);
        if (other) data.againstId = other.id;
      }
      if (a.kind === 'warning' && a.status === 'acknowledged' && !a.response) data.response = 'I understand and will be on time from now on.';
      if (a.kind === 'warning' && !a.severity) data.severity = ['low', 'medium', 'high'][i % 3];
      if (Object.keys(data).length) await db().hrAction.update({ where: { id: a.id }, data });
    }
  });

  await step('events this month and next, for the calendars', async () => {
    const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const list: [string, string, string, string, string, string][] = [
      ['Monthly team meeting', 'Meeting', plus(2), '10:00', '11:00', 'Main shop, first floor'],
      ['Product training: new arrivals', 'Training', plus(5), '15:00', '17:00', 'Training room'],
      ['Birthday celebration', 'Celebration', plus(9), '17:30', '18:30', 'Pantry'],
      ['Safety drill', 'Meeting', plus(14), '11:30', '12:00', 'Warehouse'],
      ['Team outing', 'Outing', plus(23), '09:00', '19:00', 'Lucknow Zoo'],
    ];
    for (const [title, category, startsOn, startsAt, endsAt, location] of list) {
      if (await db().hrPost.findFirst({ where: { tenantId, title } })) continue;
      const p = await people.savePost(ctx, people.PostInput.parse({ kind: 'event', title, category, startsOn, startsAt, endsAt, location, priority: 'normal' }));
      if (title !== 'Safety drill') await people.setPostStatus(ctx, p.id, 'approved');
    }
  });
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Pass one or more tenant ids');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
