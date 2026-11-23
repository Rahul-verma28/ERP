import { prisma } from '../../kernel/db';
import { JobTally, reason } from '../../kernel/jobs';
import { sendEmail } from '../../kernel/mail';
import { erp, ErpError } from './client';

// The outbox of calls to the ERP: set up a business, deliver a licence, a fresh owner link. Each
// runs on its own; a failure waits longer each time (30 s, 1 min, 2 min … up to 1 hour) and stops
// after 12 tries, when it shows in System health for someone to look at. A request the ERP refuses
// as wrong (4xx) is not retried.

export const MAX_ATTEMPTS = 12;
const LEASE_S = 120;
const backoffS = (attempts: number) => Math.min(30 * 2 ** (attempts - 1), 3600);

interface ProvisionPayload {
  industryKey: string;
  billedToPartner: boolean;
  source: 'direct' | 'sales' | 'vendor' | 'partner';
}

async function deliver(d: { id: string; kind: string; businessId: string; payload: unknown }) {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: d.businessId } });
  if (d.kind === 'provision') {
    const p = d.payload as ProvisionPayload;
    const licence = await prisma.licence.findFirstOrThrow({ where: { businessId: b.id }, orderBy: { seq: 'desc' } });
    const out = await erp<{ tenantId: string; created: boolean; ownerLink: { url: string; expiresAt: string } }>('POST', '/tenants', {
      id: b.id, name: b.name, industryKey: p.industryKey, legalName: b.legalName, gstin: b.gstin, stateCode: b.stateCode,
      owner: { name: b.ownerName, email: b.ownerEmail, mobile: b.ownerMobile }, billedToPartner: p.billedToPartner, licence: licence.token, source: p.source,
    });
    await prisma.$transaction([
      prisma.business.update({ where: { id: b.id }, data: { provisionedAt: new Date(), ownerLinkSentAt: new Date() } }),
      prisma.licence.update({ where: { id: licence.id }, data: { deliveredAt: new Date() } }),
    ]);
    await sendOwnerLink(b, out.ownerLink.url, out.ownerLink.expiresAt);
    return;
  }
  if (d.kind === 'licence') {
    // Always the newest: an older queued licence is not worth sending once a newer one exists
    const licence = await prisma.licence.findFirstOrThrow({ where: { businessId: b.id }, orderBy: { seq: 'desc' } });
    if (licence.deliveredAt) return;
    await erp('PUT', `/tenants/${b.id}/licence`, { licence: licence.token });
    await prisma.licence.updateMany({ where: { businessId: b.id, seq: { lte: licence.seq }, deliveredAt: null }, data: { deliveredAt: new Date() } });
    return;
  }
  if (d.kind === 'owner_link') {
    const out = await erp<{ url: string; expiresAt: string }>('POST', `/tenants/${b.id}/owner-link`);
    await prisma.business.update({ where: { id: b.id }, data: { ownerLinkSentAt: new Date() } });
    await sendOwnerLink(b, out.url, out.expiresAt);
    return;
  }
  throw new Error(`Unknown delivery kind ${d.kind}`);
}

async function sendOwnerLink(b: { name: string; ownerName: string; ownerEmail: string }, url: string, expiresAt: string) {
  const until = new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  await sendEmail(
    b.ownerEmail,
    `Set up your login for ${b.name}`,
    `Hi ${b.ownerName},\n\n${b.name} is ready on AHEAD. Open this link to verify your mobile and choose your password:\n\n${url}\n\nThe link works once, until ${until}.\n\nAHEAD`,
  );
}

/** Send what is due. Safe to run from several servers: each delivery is leased before it is sent. */
export async function runDeliveries(limit = 20) {
  const tally = new JobTally();
  const due = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE deliveries SET locked_until = now() + make_interval(secs => ${LEASE_S}::int)
     WHERE id IN (SELECT id FROM deliveries
                   WHERE done_at IS NULL AND attempts < ${MAX_ATTEMPTS} AND next_attempt_at <= now()
                     AND (locked_until IS NULL OR locked_until < now())
                   ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
     RETURNING id`;
  for (const { id } of due) {
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id } });
    await tally.item(`${d.kind} · ${d.businessId}`, async () => {
      try {
        await deliver(d);
        await prisma.delivery.update({ where: { id }, data: { doneAt: new Date(), lockedUntil: null, attempts: { increment: 1 }, lastError: null } });
      } catch (e) {
        const attempts = d.attempts + 1;
        const retry = !(e instanceof ErpError) || e.retry;
        await prisma.delivery.update({
          where: { id },
          data: { attempts: retry ? attempts : MAX_ATTEMPTS, lastError: reason(e), lockedUntil: null, nextAttemptAt: new Date(Date.now() + backoffS(attempts) * 1000) },
        });
        throw e;
      }
    });
  }
  return tally;
}
