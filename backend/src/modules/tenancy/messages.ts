import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { CUSTOMER_EVENTS, DEFAULT_NOTIFICATIONS, TEAM_EVENTS, notificationsWithDefaults, renderTemplate, templateProblems, type CustomerEvent, type NotificationSettings } from '../../contracts/account';
import { audit } from '../audit/service';
import { consumer } from '../events/outbox';
import { sendMessage } from '../notifications/service';
import { providers } from '../notifications/delivery';

// Settings › Notifications: messages to customers (templates per event) and team alerts.
// SMS and WhatsApp stay off until a provider is connected.

const customerKeys = CUSTOMER_EVENTS.map((e) => e.key) as [CustomerEvent, ...CustomerEvent[]];
const Template = z.object({
  email: z.boolean(),
  sms: z.literal(false, { errorMap: () => ({ message: 'SMS needs a provider' }) }),
  whatsapp: z.literal(false, { errorMap: () => ({ message: 'WhatsApp needs a provider' }) }),
  subject: z.string().trim().min(1, 'Add a subject').max(150, 'Keep the subject under 150 characters'),
  body: z.string().trim().min(1, 'The message is empty').max(1000, 'Keep the message under 1,000 characters'),
});
export const NotificationsInput = z.object({
  customer: z.object(Object.fromEntries(customerKeys.map((k) => [k, Template])) as Record<CustomerEvent, typeof Template>),
  team: z.object(Object.fromEntries(TEAM_EVENTS.map((e) => [e.key, z.object({ inApp: z.boolean(), email: z.boolean() })])) as Record<string, z.ZodObject<{ inApp: z.ZodBoolean; email: z.ZodBoolean }>>),
  quietHours: z.object({ enabled: z.boolean(), from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) }),
  dailyCap: z.number().int().min(1, 'Use 1–10').max(10, 'Use 1–10'),
});

const raw = (prefs: unknown) => (prefs ?? {}) as Record<string, unknown>;

export async function getNotifications(tenantId: string) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { preferences: true } });
  return { settings: notificationsWithDefaults(raw(t.preferences).notifications), defaults: DEFAULT_NOTIFICATIONS, providers: { email: true, sms: providers.sms, whatsapp: providers.whatsapp } };
}

export async function updateNotifications(tenantId: string, input: z.infer<typeof NotificationsInput>) {
  const fields: Record<string, string> = {};
  for (const k of customerKeys) {
    const p = templateProblems(k, input.customer[k]);
    if (p) fields[`customer.${k}.body`] = p;
  }
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
  const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { preferences: true } });
  const prefs = raw(t.preferences);
  const before = notificationsWithDefaults(prefs.notifications);
  await db().tenant.update({ where: { id: tenantId }, data: { preferences: { ...prefs, notifications: input } as unknown as Prisma.InputJsonValue } });
  await audit({ action: 'tenant.notifications.update', entity: 'tenant', entityId: tenantId, before, after: input });
  return input as NotificationSettings;
}

const SAMPLE: Record<string, string> = {
  customer: 'Meera Kulkarni', amount: '₹1,770.00', number: 'INV/26-27/0001', due_date: '24 Nov 2026',
  link: `${env.APP_URL.replace(/^https?:\/\//, '')}/d/x7Q…`, date: '26 Oct 2026', time: '11:30 am', service: 'Haircut',
};

/** "Send test to me": the unsaved template, with sample values, to the admin's email. */
export async function sendTest(tenantId: string, to: string, event: CustomerEvent, t: { subject: string; body: string }) {
  const problem = templateProblems(event, t);
  if (problem) throw new AppError('VALIDATION_FAILED', problem, { fields: { body: problem } });
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  const vars = { ...SAMPLE, business: tenant.name };
  await sendMessage({ channel: 'email', to, template: `customer.${event}.test`, subject: `[Test] ${renderTemplate(t.subject, vars)}`, text: renderTemplate(t.body, vars) });
}

// ── Delivery (outbox consumers) ──

const rupees = (paise: bigint | number) => `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

async function deliver(tenantId: string, event: CustomerEvent, documentId: string, amountPaise?: number) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, preferences: true } });
  const settings = notificationsWithDefaults(raw(t.preferences).notifications);
  const tpl = settings.customer[event];
  if (!tpl.email) return;
  const doc = await db().salesDocument.findUnique({ where: { id: documentId } });
  if (!doc) return;
  const buyer = (doc.buyer ?? {}) as { name?: string; email?: string };
  if (!buyer.email) return;
  // Daily cap per customer
  const since = new Date(Date.now() - 86_400_000);
  const sent = await db().notificationLog.count({ where: { tenantId, target: buyer.email, sentAt: { gt: since }, template: { startsWith: 'customer.' } } });
  if (sent >= settings.dailyCap) return;
  const vars = {
    customer: buyer.name ?? 'there', business: t.name, number: doc.number ?? '', amount: rupees(amountPaise ?? doc.totalPaise),
    due_date: fmtDate(doc.dueDate), link: doc.shareToken ? `${env.APP_URL}/d/${doc.shareToken}` : '',
  };
  await sendMessage({ channel: 'email', to: buyer.email, template: `customer.${event}`, subject: renderTemplate(tpl.subject, vars), text: renderTemplate(tpl.body, vars) });
  await db().notificationLog.create({ data: { tenantId, template: `customer.${event}`, channel: 'email', target: buyer.email } });
}

/**
 * "Remind" on the dashboard and the dues list: the Invoice overdue message, sent now whether
 * or not the automatic overdue reminders are on. Skips customers without an email and those
 * who already got today's maximum.
 */
export async function sendOverdueReminders(tenantId: string, ids: string[]) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, preferences: true } });
  const settings = notificationsWithDefaults(raw(t.preferences).notifications);
  const tpl = settings.customer.invoice_overdue;
  const docs = await db().salesDocument.findMany({ where: { id: { in: ids }, kind: 'invoice', status: { in: ['issued', 'partially_paid'] } } });
  const since = new Date(Date.now() - 86_400_000);
  const sent: string[] = [];
  const skipped: { number: string | null; reason: string }[] = [];
  for (const doc of docs) {
    const buyer = (doc.buyer ?? {}) as { name?: string; email?: string };
    if (!buyer.email) {
      skipped.push({ number: doc.number, reason: 'No email for this customer' });
      continue;
    }
    const today = await db().notificationLog.count({ where: { tenantId, target: buyer.email, sentAt: { gt: since }, template: { startsWith: 'customer.' } } });
    if (today >= settings.dailyCap) {
      skipped.push({ number: doc.number, reason: `Already got ${settings.dailyCap} message${settings.dailyCap === 1 ? '' : 's'} today` });
      continue;
    }
    const vars = {
      customer: buyer.name ?? 'there', business: t.name, number: doc.number ?? '', amount: rupees(doc.totalPaise - doc.paidPaise),
      due_date: fmtDate(doc.dueDate), link: doc.shareToken ? `${env.APP_URL}/d/${doc.shareToken}` : '',
    };
    await sendMessage({ channel: 'email', to: buyer.email, template: 'customer.invoice_overdue', subject: renderTemplate(tpl.subject, vars), text: renderTemplate(tpl.body, vars) });
    await db().notificationLog.create({ data: { tenantId, template: 'customer.invoice_overdue', channel: 'email', target: buyer.email } });
    sent.push(doc.number ?? doc.id);
  }
  const missing = ids.length - docs.length;
  if (missing) skipped.push({ number: null, reason: `${missing} invoice${missing === 1 ? ' is' : 's are'} already paid or cancelled` });
  await audit({ action: 'billing.invoice.remind', entity: 'invoice', after: { sent, skipped: skipped.length } });
  return { sent: sent.length, skipped };
}

consumer('messages.invoice_issued', 'invoice.issued', async (evt) => {
  await deliver(evt.tenantId!, 'invoice_issued', String(evt.payload.documentId));
});
consumer('messages.payment_received', 'payment.received', async (evt) => {
  await deliver(evt.tenantId!, 'payment_received', String(evt.payload.documentId), Number(evt.payload.amountPaise));
});
