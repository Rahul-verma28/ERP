import { db } from '../../kernel/db';
import { isDev } from '../../config/env';
import { providers, sendEmail, sendSms } from './delivery';

/** Emails sent without a subject of their own (codes, notices) */
const subjectFor = (m: OutgoingMessage) => (m.template.startsWith('otp.') ? 'Your AHEAD verification code' : 'A message from AHEAD ERP');

// Message delivery: email over SMTP and SMS through textbee (see delivery.ts). A channel with no
// provider (WhatsApp for now, or anything in tests) is written to the server log instead.

export interface OutgoingMessage {
  channel: 'sms' | 'whatsapp' | 'email';
  to: string;
  template: string;
  subject?: string;
  text: string;
}

/** Development only: the last messages "sent", for the /dev/messages page (codes, invites) */
const devOutbox: (OutgoingMessage & { at: string })[] = [];
export const getDevOutbox = () => (isDev ? [...devOutbox] : []);

export async function sendMessage(msg: OutgoingMessage) {
  if (isDev) {
    devOutbox.unshift({ ...msg, at: new Date().toISOString() });
    devOutbox.length = Math.min(devOutbox.length, 50);
  }
  // Delivered for real when the channel is set up; a failure stops the action that sent it, so
  // nobody waits for a code or an invite that never left
  if (msg.channel === 'email' && providers.email) return sendEmail(msg.to, msg.subject ?? subjectFor(msg), msg.text);
  if (msg.channel === 'sms' && providers.sms) return sendSms(msg.to, msg.text);
  console.log(`\n📨 [${msg.channel}] to ${msg.to} (${msg.template})${msg.subject ? `\n   ${msg.subject}` : ''}\n   ${msg.text}\n`);
}

/** In-app notification for a user in the current tenant context (AUT-01). */
export async function notify(userId: string, title: string, body?: string, link?: string) {
  const tx = db();
  const row = await tx.$queryRaw<{ tid: string }[]>`SELECT current_setting('app.tenant_id', true) AS tid`;
  const tenantId = row[0]?.tid;
  if (!tenantId) return;
  await tx.notification.create({ data: { tenantId, userId, title, body, link } });
}

export async function listNotifications(userId: string) {
  const [items, unread] = await Promise.all([
    db().notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db().notification.count({ where: { userId, readAt: null } }),
  ]);
  return { data: items, unread };
}

export async function markRead(userId: string, id?: string) {
  await db().notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
}
