import type { AccessLinkKind } from '@prisma/client';
import { env } from '../../config/env';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { pepperedHash, randomToken } from '../../kernel/crypto';

// Console v3: one-time login links. Whoever adds a client owner or a Console user sends this
// link; the person verifies their mobile, sets their own password and is signed in.
// All functions run in a platform transaction.

export const LINK_DAYS = 7;
const DAY = 86_400_000;

const linkUrl = (token: string) => `${env.APP_URL}/start/${token}`;

/** Pure: "98110 23456" → "98xxx xx456" style mask for showing on the public page. */
export function maskMobile(mobile: string) {
  const digits = mobile.replace(/^\+91/, '');
  return digits.length < 6 ? digits : `${digits.slice(0, 2)}${'x'.repeat(digits.length - 5)}${digits.slice(-3)}`;
}

/** Create a fresh link; any earlier unused link for the same person and workspace stops working. */
export async function createAccessLink(input: { kind: AccessLinkKind; userId: string; tenantId?: string | null; createdBy: string | null }) {
  const tx = db();
  const now = new Date();
  await tx.accessLink.updateMany({
    where: { userId: input.userId, kind: input.kind, tenantId: input.tenantId ?? null, usedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
  const token = randomToken(12);
  const link = await tx.accessLink.create({
    data: { tokenHash: pepperedHash(token), kind: input.kind, userId: input.userId, tenantId: input.tenantId ?? null, createdBy: input.createdBy, expiresAt: new Date(now.getTime() + LINK_DAYS * DAY) },
  });
  return { id: link.id, url: linkUrl(token), expiresAt: link.expiresAt };
}

async function findLink(token: string) {
  const link = await db().accessLink.findUnique({
    where: { tokenHash: pepperedHash(token) },
    include: { user: { select: { id: true, name: true, email: true, mobile: true, passwordHash: true, status: true } }, tenant: { select: { name: true } } },
  });
  if (!link) throw new AppError('NOT_FOUND', 'This link is not valid. Ask the person who added you to send a new one.');
  return link;
}

/** A link that can still be used, or a plain-language error. */
export async function usableLink(token: string) {
  const link = await findLink(token);
  if (link.usedAt) throw new AppError('INVALID_TRANSITION', 'This link was already used. Sign in with your mobile number and password.', { used: true });
  if (link.expiresAt <= new Date()) throw new AppError('INVALID_TRANSITION', 'This link has expired. Ask the person who added you to send a new one.', { expired: true });
  if (link.user.status === 'disabled') throw new AppError('ACCOUNT_LOCKED', 'This account is disabled.');
  return link;
}

/** What the public /start page shows before anything is sent. */
export async function linkInfo(token: string) {
  const link = await usableLink(token);
  if (!link.openedAt) await db().accessLink.update({ where: { id: link.id }, data: { openedAt: new Date() } });
  return {
    kind: link.kind,
    name: link.user.name,
    email: link.user.email,
    mobile: maskMobile(link.user.mobile),
    businessName: link.tenant?.name ?? null,
    needsPassword: !link.user.passwordHash,
    expiresAt: link.expiresAt,
  };
}

/** Mark the link used and the mobile verified. Returns who to sign in and where. */
export async function useLink(linkId: string, userId: string) {
  const now = new Date();
  await db().accessLink.update({ where: { id: linkId }, data: { usedAt: now } });
  await db().user.update({ where: { id: userId }, data: { mobileVerifiedAt: now } });
}
