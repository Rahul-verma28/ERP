import * as React from "react"

/**
 * Every box inside a <Field> gets a hint of what to type when its form didn't give one:
 * a real-looking example for formats (mobile, GSTIN, PIN…), otherwise "Enter <label>".
 * Only fills an empty placeholder, so nothing a form sets itself changes.
 */
export const FieldLabelContext = React.createContext<string | null>(null)

const EXAMPLES: Record<string, string> = {
  mobile: "e.g. 98765 43210",
  phone: "e.g. 98765 43210",
  pincode: "e.g. 110001",
  gstin: "e.g. 09ABCDE1234F1Z5",
  pan: "e.g. ABCDE1234F",
  ifsc: "e.g. HDFC0001234",
  email: "e.g. name@business.com",
  code: "e.g. CODE-1",
}

// Label words that mean a known format
const BY_LABEL: [RegExp, string][] = [
  [/\bgstin\b/i, EXAMPLES.gstin],
  [/\bpan\b/i, EXAMPLES.pan],
  [/\bifsc\b/i, EXAMPLES.ifsc],
  [/\bupi\b/i, "e.g. business@okhdfc"],
  [/\be-?mail\b/i, EXAMPLES.email],
  [/\b(mobile|phone|whatsapp)\b/i, EXAMPLES.mobile],
  [/\b(pin ?code|pin)\b/i, EXAMPLES.pincode],
  [/\b(website|url|link)\b/i, "https://"],
  [/\bhsn\b|\bsac\b/i, "e.g. 8471"],
  [/\baccount (number|no)\b/i, "e.g. 50100123456789"],
]

const clean = (label: string) => label.replace(/\s*\((optional|required)\)\s*$/i, "").replace(/[*:]+$/, "").trim()

/** Lower-case the first letter unless the word is an acronym (GSTIN, PAN, SKU…) */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)

export function autoPlaceholder(label: string | null, opts: { type?: string; mask?: string; multiline?: boolean } = {}): string | undefined {
  const { type, mask, multiline } = opts
  if (type && ["checkbox", "radio", "file", "color", "hidden", "range", "date", "time", "datetime-local", "month", "week"].includes(type)) return undefined
  if (mask && EXAMPLES[mask]) return EXAMPLES[mask]
  if (type === "email") return EXAMPLES.email
  if (type === "tel") return EXAMPLES.mobile
  if (type === "url") return "https://"
  if (type === "password") return "Enter password"
  if (!label) return type === "number" ? "0" : undefined
  const l = clean(label)
  if (!l) return undefined
  for (const [re, example] of BY_LABEL) if (re.test(l)) return example
  if (type === "number" || mask === "digits") return /%|percent/i.test(l) ? "e.g. 10" : "0"
  return multiline ? `Write ${lowerFirst(l)}…` : `Enter ${lowerFirst(l)}`
}
