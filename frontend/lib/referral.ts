// A vendor's or salesperson's link (/signup?ref=CODE) is remembered for 30 days on this device,
// so a visitor who signs up later is still credited to them.

const KEY = "ahead.referral"
const TTL_MS = 30 * 86_400_000

/** Remember ?ref= from the current URL. */
export function captureReferral() {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase()
    if (ref && /^[A-Z0-9]{3,20}$/.test(ref)) localStorage.setItem(KEY, JSON.stringify({ code: ref, at: Date.now() }))
  } catch {
    // Storage blocked (private mode): the link still works for this visit through the URL
  }
}

/** The remembered code for the signup request, if still fresh. */
export function referralFields(): { referralCode?: string; referralVia?: "link" } {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase()
    if (fromUrl) return { referralCode: fromUrl, referralVia: "link" }
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { code: string; at: number } | null
    if (saved && Date.now() - saved.at < TTL_MS) return { referralCode: saved.code, referralVia: "link" }
  } catch {
    // ignore
  }
  return {}
}
