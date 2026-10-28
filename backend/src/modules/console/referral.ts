import { randomInt } from 'node:crypto';
import type { AcquisitionMethod } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { env } from '../../config/env';
import type { AcquisitionInput } from '../tenancy/createTenant';
import { invalidatePlatformMember } from './service';

// Referral link and code (platform design §2A): vendors and salespeople share
// /signup?ref=CODE or the code itself. A self-signup that brings a valid code is credited to them.

const REFERRERS: Record<string, 'vendor' | 'sales_user'> = { vendor: 'vendor', console_sales_executive: 'sales_user', console_sales_manager: 'sales_user' };

/** "Neha Joshi" → NEHA + 3 digits; letters only, so codes read well on a call. */
function makeCode(name: string) {
  const stem = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'AHEAD';
  return `${stem}${randomInt(100, 1000)}`;
}

/** The signed-in person's code and link, made on first use. */
export async function myReferral(ctx: ConsoleCtx) {
  const tx = db();
  const member = await tx.platformMember.findUniqueOrThrow({ where: { id: ctx.memberId }, include: { role: { select: { key: true } }, user: { select: { name: true } } } });
  if (!REFERRERS[member.role.key]) throw new AppError('PERMISSION_DENIED', 'Referral links are for vendors and the sales team.');
  let code = member.referralCode;
  for (let attempt = 0; !code && attempt < 5; attempt++) {
    const candidate = makeCode(member.user.name);
    if (!(await tx.platformMember.findUnique({ where: { referralCode: candidate } }))) {
      await tx.platformMember.update({ where: { id: member.id }, data: { referralCode: candidate } });
      invalidatePlatformMember(member.userId);
      code = candidate;
    }
  }
  if (!code) throw new AppError('CONFLICT', 'Could not make a referral code. Please try again.');
  return { code, link: `${env.APP_URL}/signup?ref=${code}` };
}

/** Who a signup's referral code belongs to; an unknown or inactive code is ignored (plain self-signup). */
export async function referralAcquisition(code: string | null | undefined, via: 'link' | 'code'): Promise<Partial<AcquisitionInput> | null> {
  if (!code) return null;
  const m = await db().platformMember.findUnique({ where: { referralCode: code.trim().toUpperCase() }, include: { role: { select: { key: true } } } });
  const byType = m && m.status === 'active' ? REFERRERS[m.role.key] : undefined;
  if (!m || !byType) return null;
  const method: AcquisitionMethod = via === 'link' ? 'referral_link' : 'referral_code';
  return { byType, byUserId: m.userId, method, referralCode: code.trim().toUpperCase() };
}
