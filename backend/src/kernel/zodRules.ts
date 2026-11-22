import { z } from 'zod';
import * as rules from '../contracts/validation';

// Zod versions of the shared field rules (contracts/validation.ts), so the API and the
// web forms reject exactly the same values with the same messages.

const fromRule = <S extends z.ZodType<string, z.ZodTypeDef, unknown>>(schema: S, rule: rules.Rule) =>
  schema.superRefine((v, ctx) => {
    const message = rule(v);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

/** Turns '' into null so optional text fields can be cleared. */
export const optionalText = <T extends z.ZodTypeAny>(schema: T) => z.union([z.literal('').transform(() => null), schema]).nullish();

export const zPersonName = fromRule(z.string().transform(rules.squish), rules.personName);
/** Indian mobile, stored as +91XXXXXXXXXX */
export const zMobileIN = fromRule(z.string().transform(rules.cleanMobile), rules.mobileIN).transform((v) => `+91${v}`);
export const zPhone = fromRule(z.string(), rules.phone).transform(rules.storedPhone);
export const zEmail = fromRule(z.string().trim().toLowerCase(), rules.email);
export const zPassword = fromRule(z.string(), rules.password);
export const zGstin = fromRule(z.string().transform(rules.upperNoSpaces), rules.gstin);
export const zPan = fromRule(z.string().transform(rules.upperNoSpaces), rules.pan);
export const zIfsc = fromRule(z.string().transform(rules.upperNoSpaces), rules.ifsc);
export const zPincode = fromRule(z.string().trim(), rules.pincode);
export const zHsnOrSac = fromRule(z.string().trim(), (v) => (rules.hsn(v) && rules.sac(v) ? 'Use a 4, 6 or 8-digit HSN or a 6-digit SAC' : null));
export const zStateCode = z.string().refine((v) => rules.stateName(v) !== null, 'Choose a state from the list');
export const zIsoDate = fromRule(z.string(), rules.isoDate);
export const zPastDate = fromRule(z.string(), rules.notFutureDate);
export const zReason = fromRule(z.string().trim(), rules.changeReason);

/**
 * A photo or document on a record: an uploaded file ("file:<id>", see modules/files) or, for
 * older records, a full https link. The file must belong to the same business; that is checked
 * where it's read, through row-level security on the files table.
 */
export const FILE_REF = /^file:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const zFileRef = z
  .string()
  .trim()
  .max(500)
  .refine((v) => FILE_REF.test(v) || /^https?:\/\/\S+$/i.test(v), 'Upload a file');
