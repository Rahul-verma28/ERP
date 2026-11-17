import { Prisma } from '@prisma/client';
export { bundle } from '../../kernel/bundle';
import type { Row } from '../../kernel/bundle';

// HR names for one-query reads (see kernel/bundle).

/** The SELECTs behind `names()`: departments, designations, shifts, branches, employees and the
 *  people (logins) of this business, to turn ids into names. Spread into a bundle. */
export const nameParts = (tenantId: string) => ({
  _dept: Prisma.sql`select id, name from hr_departments where tenant_id = ${tenantId}::uuid`,
  _desig: Prisma.sql`select id, name from hr_designations where tenant_id = ${tenantId}::uuid`,
  _shift: Prisma.sql`select id, name from hr_shifts where tenant_id = ${tenantId}::uuid`,
  _branch: Prisma.sql`select id, name from branches where tenant_id = ${tenantId}::uuid`,
  _emp: Prisma.sql`select id, name, code, email, phone, designation_id from employees where tenant_id = ${tenantId}::uuid`,
  _user: Prisma.sql`select u.id, u.name from users u join tenant_members m on m.user_id = u.id where m.tenant_id = ${tenantId}::uuid`,
});

export type Names = ReturnType<typeof namesFrom>;

/** Maps from a bundle that included `nameParts` */
export function namesFrom(b: Record<'_dept' | '_desig' | '_shift' | '_branch' | '_emp' | '_user', Row[]>) {
  const m = (rows: Row[]) => new Map<string, string>(rows.map((r) => [r.id as string, r.name as string]));
  const desig = m(b._desig);
  return {
    dept: m(b._dept), desig, shift: m(b._shift), branch: m(b._branch), emp: m(b._emp), user: m(b._user),
    code: new Map<string, string>(b._emp.map((e) => [e.id as string, e.code as string])),
    /** Second line under a name in lists: designation, else email */
    sub: new Map<string, string | null>(b._emp.map((e) => [e.id as string, (e.designationId ? desig.get(e.designationId as string) : null) ?? (e.email as string | null) ?? null])),
  };
}
