import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import { audit } from '../audit/service';
import { validateAcquisition, type AcquisitionInput } from './createTenant';

// R1: the acquisition record is locked at signup. Only an Admin may correct it
// (Console, Step 3), always with a reason, and the change is audited.

/** Must run inside withPlatform(). */
export async function changeAcquisition(tenantId: string, next: AcquisitionInput, actorId: string, reason: string) {
  if (reason.trim().length < 5) throw new AppError('VALIDATION_FAILED', 'Give a reason for the change.', { fields: { reason: 'At least 5 characters' } });
  const source = validateAcquisition(next);
  const tx = db();
  const before = await tx.tenantAcquisition.findUnique({ where: { tenantId } });
  if (!before) throw notFound('Tenant acquisition');

  const after = await tx.tenantAcquisition.update({
    where: { tenantId },
    data: {
      acquiredByType: next.byType, acquiredByUserId: next.byUserId ?? null, method: next.method,
      referralCode: next.referralCode ?? null, couponCode: next.couponCode?.toUpperCase() ?? null,
      changedBy: actorId, changeReason: reason.trim(),
    },
  });
  await tx.tenant.update({ where: { id: tenantId }, data: { source } });
  await audit({ tenantId: null, actorId, action: 'tenant.acquisition_changed', entity: 'tenant', entityId: tenantId, before, after: { ...after, reason: reason.trim() } });
  return after;
}
