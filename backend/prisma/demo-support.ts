// Demo data for Customer Service: setup with the request form on, help articles and saved replies,
// and about two dozen tickets over the last three weeks in every state: new, open, waiting, on hold,
// late on SLA, resolved with ratings, closed, reopened, some raised on the form, with conversations.
// Usage: npx tsx prisma/demo-support.ts <tenantId> [<tenantId> …]
// Uses the same service code the app uses; skips a business that already has demo tickets.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import * as sp from '../src/modules/support/service';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const HOUR = 3_600_000;

const ARTICLES: [string, string, string | null][] = [
  ['Warranty terms', 'Every product carries a 12-month warranty from the date on your bill.\n\nCovered: manufacturing faults, motor and winding failure.\nNot covered: burns from voltage surges, physical damage, wrong wiring by others.\n\nKeep your bill or the serial number handy when you raise a request.', 'repair'],
  ['How to return a product', 'You can return an unused product within 7 days with its box and bill. Bring it to the shop or raise a request and we will arrange pickup in the city. Refunds go back the way you paid within 5 working days.', 'return'],
  ['Fan making a humming noise', 'A light hum is normal at low speed on some regulators. If the hum is loud:\n1. Switch to a step regulator instead of an electronic one.\n2. Check that the canopy screws are tight.\n3. If it continues, raise a request and we will check the capacitor.', 'repair'],
  ['Installation charges', 'Ceiling fan: ₹250. Exhaust fan: ₹200. Inverter with battery: ₹500. Charges include basic wiring up to 2 metres. Our technician gives a bill on the spot.', 'installation'],
];
const REPLIES: [string, string][] = [
  ['First reply', 'Hello {name}, thank you for writing to us. We have noted your request and will update you within a few hours.'],
  ['Technician visit', 'Hello {name}, our technician will visit you tomorrow between 11 am and 2 pm. Please keep the bill or the serial number ready.'],
  ['Need a photo', 'Hello {name}, could you share a photo or a short video of the problem on WhatsApp? It helps us bring the right part.'],
  ['Warranty approved', 'Hello {name}, the product is in warranty, so the repair is free. We will replace the faulty part.'],
  ['Closing note', 'Hello {name}, glad it is sorted. If anything comes up again, just reply here and the request opens again.'],
];

type Plan = { subject: string; who: string; category: string; priority: 'low' | 'medium' | 'high' | 'urgent'; channel: 'phone' | 'whatsapp' | 'email' | 'walk_in' | 'web'; daysAgo: number; end: 'new' | 'open' | 'pending' | 'on_hold' | 'late' | 'resolved' | 'closed' | 'reopened'; rating?: number; feedback?: string; talk?: string[] };
const PLANS: Plan[] = [
  { subject: 'Ceiling fan making noise after 2 weeks', who: 'Kapoor General Store', category: 'repair', priority: 'high', channel: 'phone', daysAgo: 20, end: 'resolved', rating: 5, feedback: 'Technician came on time', talk: ['c:The fan hums loudly at speed 3.', 'r:Technician visit', 'c:Thanks, he can come.', 'n:Capacitor replaced, 2.5 µF.'] },
  { subject: 'Wrong GST on invoice', who: 'Green Leaf Café', category: 'billing', priority: 'medium', channel: 'email', daysAgo: 18, end: 'closed', rating: 4, talk: ['c:Our GSTIN is missing on the bill.', 'r:First reply', 'n:Issued a corrected invoice.'] },
  { subject: 'Inverter not charging', who: 'Shiv Shakti Hardware', category: 'repair', priority: 'urgent', channel: 'whatsapp', daysAgo: 16, end: 'resolved', rating: 3, feedback: 'Took two visits', talk: ['c:Battery shows 0% since morning.', 'r:Need a photo', 'c:Sent the photo on WhatsApp.', 'r:Technician visit'] },
  { subject: 'Installation for 4 fans in new office', who: 'Rao Office Supplies', category: 'installation', priority: 'medium', channel: 'phone', daysAgo: 15, end: 'closed', rating: 5, talk: ['r:First reply', 'n:Fitted on Saturday, paid in cash.'] },
  { subject: 'Exhaust fan box damaged on delivery', who: 'Punjab Dhaba', category: 'delivery', priority: 'high', channel: 'walk_in', daysAgo: 13, end: 'resolved', rating: 4, talk: ['c:The box was torn and the blade is bent.', 'r:Warranty approved'] },
  { subject: 'Want to return extra LED panels', who: 'Malhotra Electricals', category: 'return', priority: 'low', channel: 'phone', daysAgo: 12, end: 'closed', talk: ['c:We ordered 20, need only 16.', 'r:First reply', 'n:4 panels taken back, credit note made.'] },
  { subject: 'Geyser thermostat not cutting off', who: 'Siddiqui Caterers', category: 'repair', priority: 'high', channel: 'phone', daysAgo: 10, end: 'reopened', talk: ['c:Water gets too hot.', 'r:Technician visit', 'n:Reset the thermostat.', 'c:It happened again today.'] },
  { subject: 'Price difference from quotation', who: 'Agrawal Sweets & Namkeen', category: 'billing', priority: 'medium', channel: 'email', daysAgo: 9, end: 'resolved', rating: 2, feedback: 'Should have been right the first time', talk: ['c:Quotation said ₹1,850, bill says ₹1,950.', 'r:First reply', 'n:Gave ₹100 credit on the next bill.'] },
  { subject: 'Switchboard sparking', who: 'guest:Rajeev Nigam:9839887766', category: 'complaint', priority: 'urgent', channel: 'phone', daysAgo: 6, end: 'late', talk: ['c:Sparks when switching on the AC.'] },
  { subject: 'Fan regulator not working', who: 'Kapoor General Store', category: 'repair', priority: 'medium', channel: 'whatsapp', daysAgo: 5, end: 'pending', talk: ['c:Regulator stuck at speed 1.', 'r:Need a photo'] },
  { subject: 'Need bill copy for warranty claim', who: 'guest:Sneha Arora:9415776655', category: 'billing', priority: 'low', channel: 'web', daysAgo: 5, end: 'resolved', rating: 5, talk: ['r:First reply', 'n:Sent PDF on WhatsApp.'] },
  { subject: 'Tubelight flickering', who: 'Green Leaf Café', category: 'repair', priority: 'low', channel: 'phone', daysAgo: 4, end: 'on_hold', talk: ['c:Kitchen light flickers.', 'r:First reply', 'n:Waiting for the choke from the supplier.'] },
  { subject: 'Delivery delayed by 3 days', who: 'Rao Office Supplies', category: 'delivery', priority: 'high', channel: 'email', daysAgo: 3, end: 'open', talk: ['c:We were promised Monday.', 'r:First reply'] },
  { subject: 'Cooler pump noise', who: 'guest:Arjun Mehta:9721443322', category: 'repair', priority: 'medium', channel: 'web', daysAgo: 2, end: 'late' },
  { subject: 'Wiring check before Diwali lights', who: 'Shiv Shakti Hardware', category: 'installation', priority: 'medium', channel: 'phone', daysAgo: 2, end: 'open', talk: ['r:Technician visit'] },
  { subject: 'Wants AMC for the whole office', who: 'Malhotra Electricals', category: 'other', priority: 'low', channel: 'email', daysAgo: 1, end: 'new' },
  { subject: 'Emergency light battery dead', who: 'Punjab Dhaba', category: 'repair', priority: 'high', channel: 'whatsapp', daysAgo: 1, end: 'new', talk: ['c:Not lighting up during power cut.'] },
  { subject: 'MCB tripping twice a day', who: 'guest:Pooja Rawat:9935112244', category: 'complaint', priority: 'urgent', channel: 'phone', daysAgo: 0, end: 'new', talk: ['c:Whole shop goes dark twice daily.'] },
  { subject: 'Refund not received', who: 'Agrawal Sweets & Namkeen', category: 'return', priority: 'high', channel: 'phone', daysAgo: 0, end: 'open', talk: ['c:It has been 6 days.', 'r:First reply'] },
  { subject: 'Which fan for a 12x14 room', who: 'guest:Kunal Bhatia:9450223311', category: 'other', priority: 'low', channel: 'web', daysAgo: 0, end: 'new' },
];

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  if (await run(() => prisma.supportTicket.count({ where: { tenantId } }))) return console.log('  · tickets already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };

  // Setup with the form on
  const slug = `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28)}-help`;
  await run(async () => sp.saveSettings(ctx, sp.SettingsInput.parse({ ...(await sp.getSettings(ctx)), formEnabled: true, slug, title: `Help from ${t.name}`, intro: 'Tell us what went wrong. Keep your bill number or the serial number ready for warranty.', autoAssign: 'round_robin' })));
  // Knowledge base
  for (const [title, body, category] of ARTICLES) await run(() => sp.saveArticle(ctx, null, sp.ArticleInput.parse({ title, body, category, kind: 'article', tags: [] })));
  const replies: Record<string, { id: string; body: string }> = {};
  for (const [title, body] of REPLIES) replies[title] = await run(() => sp.saveArticle(ctx, null, sp.ArticleInput.parse({ title, body, kind: 'reply' })));
  console.log(`  ✔ setup, form at /support/${slug}, ${ARTICLES.length} articles and ${REPLIES.length} saved replies`);

  let made = 0;
  for (const p of PLANS) {
    const guest = p.who.startsWith('guest:') ? p.who.split(':') : null;
    const contact = guest ? null : await run(() => db().contact.findFirst({ where: { tenantId, companyName: p.who }, select: { id: true, name: true } }));
    if (!guest && !contact) continue;
    const invoice = contact ? await run(() => db().salesDocument.findFirst({ where: { tenantId, contactId: contact.id, kind: 'invoice', status: { in: ['issued', 'partially_paid', 'paid'] } }, orderBy: { issueDate: 'desc' }, select: { id: true } })) : null;
    const tk = await run(() => sp.createTicket(ctx, sp.TicketInput.parse({
      subject: p.subject, contactId: contact?.id ?? null, guestName: guest?.[1] ?? null, guestPhone: guest?.[2] ?? null,
      channel: p.channel, category: p.category, priority: p.priority, invoiceId: ['repair', 'billing', 'return'].includes(p.category) ? invoice?.id ?? null : null,
      description: p.talk?.[0]?.startsWith('c:') ? p.talk[0].slice(2) : null, labels: p.priority === 'urgent' ? ['Urgent visit'] : [],
    }), { by: p.channel === 'web' ? 'customer' : 'staff' }));
    // Back-date it, then run the conversation forward in time
    const start = new Date(Date.now() - p.daysAgo * 24 * HOUR - (p.end === 'late' ? 30 : 3) * HOUR);
    const sla = (await run(() => sp.getSettings(ctx))).sla[p.priority];
    await run(() => db().supportTicket.update({ where: { id: tk.id }, data: { createdAt: start, firstResponseDue: new Date(start.getTime() + sla.respondH * HOUR), resolveDue: new Date(start.getTime() + sla.resolveH * HOUR) } }));
    await run(() => db().supportMessage.updateMany({ where: { ticketId: tk.id }, data: { createdAt: start } }));
    let at = start.getTime();
    const name = guest?.[1] ?? contact?.name ?? 'there';
    for (const line of (p.talk ?? []).slice(p.talk?.[0]?.startsWith('c:') ? 1 : 0)) {
      at += (p.priority === 'urgent' ? 0.5 : 2) * HOUR;
      const [k, text] = [line.slice(0, 1), line.slice(2)];
      if (k === 'c') await run(() => db().supportMessage.create({ data: { tenantId, ticketId: tk.id, kind: 'customer', body: text, authorName: name, createdAt: new Date(at) } }));
      else {
        const body = k === 'r' ? (replies[text]?.body ?? text).replace(/\{name\}/g, name) : text;
        const m = await run(() => db().supportMessage.create({ data: { tenantId, ticketId: tk.id, kind: k === 'r' ? 'reply' : 'note', body, authorId: ctx.userId, meta: { channel: p.channel === 'whatsapp' ? 'whatsapp' : 'portal' }, createdAt: new Date(at) } }));
        if (k === 'r') {
          await run(() => db().supportTicket.updateMany({ where: { id: tk.id, firstResponseAt: null }, data: { firstResponseAt: m.createdAt, status: 'open' } }));
          if (replies[text]) await run(() => db().kbArticle.update({ where: { id: replies[text].id }, data: { uses: { increment: 1 } } }));
        }
      }
    }
    const end = new Date(at + (p.priority === 'urgent' ? 3 : 20) * HOUR);
    const v = async () => (await run(() => db().supportTicket.findUniqueOrThrow({ where: { id: tk.id } }))).version;
    if (p.end === 'pending' || p.end === 'on_hold' || p.end === 'open') {
      if (p.end !== 'open') await run(async () => sp.updateTicket(ctx, tk.id, sp.TicketPatch.parse({ status: p.end, version: await v() })));
    }
    if (p.end === 'resolved' || p.end === 'closed' || p.end === 'reopened') {
      await run(async () => sp.updateTicket(ctx, tk.id, sp.TicketPatch.parse({ status: 'resolved', resolution: p.talk?.find((l) => l.startsWith('n:'))?.slice(2) ?? 'Sorted on the phone', version: await v() })));
      await run(() => db().supportTicket.update({ where: { id: tk.id }, data: { resolvedAt: end, ...(p.rating ? { rating: p.rating, feedback: p.feedback ?? null } : {}) } }));
      if (p.end === 'closed') await run(async () => { await sp.updateTicket(ctx, tk.id, sp.TicketPatch.parse({ status: 'closed', version: await v() })); await db().supportTicket.update({ where: { id: tk.id }, data: { closedAt: new Date(end.getTime() + 48 * HOUR) } }); });
      if (p.end === 'reopened') await run(async () => sp.updateTicket(ctx, tk.id, sp.TicketPatch.parse({ status: 'open', version: await v() })));
      // Events and the resolution note happened then, not today
      const closedAt = (await run(() => db().supportTicket.findUniqueOrThrow({ where: { id: tk.id }, select: { closedAt: true } }))).closedAt;
      await run(() => db().$executeRaw`update support_messages set created_at = ${end} where ticket_id = ${tk.id}::uuid and created_at > ${new Date(at)} and ((kind = 'event' and body = 'status' and meta->>'to' = 'resolved') or (kind = 'note' and body like 'Resolution:%'))`);
      if (closedAt) await run(() => db().$executeRaw`update support_messages set created_at = ${closedAt} where ticket_id = ${tk.id}::uuid and kind = 'event' and meta->>'to' = 'closed'`);
      if (p.end === 'reopened') await run(() => db().$executeRaw`update support_messages set created_at = ${new Date(end.getTime() + 24 * HOUR)} where ticket_id = ${tk.id}::uuid and kind = 'event' and body = 'reopened'`);
    }
    made++;
  }
  console.log(`  ✔ ${made} tickets: new, open, waiting, on hold, late, resolved with ratings, closed, reopened`);
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-support.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
