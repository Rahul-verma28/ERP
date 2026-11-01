// What a field accepts while typing, so a wrong value can't be entered in the first place
// (the rules in @contracts/validation still check the finished value). Pasted text is cleaned too.

export type InputMask = keyof typeof MASKS
export interface MaskRule {
  clean: (v: string) => string
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  autoCapitalize?: string
}

const digits = (v: string) => v.replace(/\D/g, "")
const upperAlnum = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "")

export const MASKS = {
  /** Indian mobile: 10 digits, whether or not +91 or a leading 0 was pasted with it */
  mobile: { clean: (v: string) => digits(v).replace(/^(91|0)(?=\d{10}$)/, "").slice(0, 10), inputMode: "numeric" },
  /** A customer's phone: 10 digits, or a number written with its country code (+44 …) */
  phone: { clean: (v: string) => (v.trimStart().startsWith("+") ? `+${v.replace(/[^\d ]/g, "").replace(/^ +/, "").slice(0, 18)}` : digits(v).replace(/^0(?=\d{10}$)/, "").slice(0, 10)), inputMode: "tel" },
  pincode: { clean: (v: string) => digits(v).slice(0, 6), inputMode: "numeric" },
  gstin: { clean: (v: string) => upperAlnum(v).slice(0, 15), autoCapitalize: "characters" },
  pan: { clean: (v: string) => upperAlnum(v).slice(0, 10), autoCapitalize: "characters" },
  ifsc: { clean: (v: string) => upperAlnum(v).slice(0, 11), autoCapitalize: "characters" },
  /** Bank account, SAC, HSN and other digit-only codes */
  digits: { clean: digits, inputMode: "numeric" },
  /** Referral and coupon codes */
  code: { clean: (v: string) => v.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20), autoCapitalize: "characters" },
  /** A person's name: letters, spaces and . ' - */
  name: { clean: (v: string) => v.replace(/[^\p{L}\p{M} .'-]/gu, "").replace(/^ +/, "").slice(0, 100), autoCapitalize: "words" },
  email: { clean: (v: string) => v.replace(/\s/g, "").slice(0, 254), inputMode: "email" },
  /** UPI ID and similar: no spaces */
  noSpaces: { clean: (v: string) => v.replace(/\s/g, "") },
} satisfies Record<string, MaskRule>
