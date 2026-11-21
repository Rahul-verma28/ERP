import { AuthShell } from "@/components/auth/auth-shell"

// Sign in, forgot password, invitations, first-time links and verification share one frame:
// the brand panel on the left and the form on the right. Pages that still use a Card read as a
// plain form here (no box), with the large title the new pages use.

const FLAT = [
  "[&_[data-slot=card]]:overflow-visible [&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:py-0 [&_[data-slot=card]]:shadow-none [&_[data-slot=card]]:gap-6",
  "[&_[data-slot=card-header]]:px-0 [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-footer]]:px-0",
  "[&_[data-slot=card-title]]:text-[28px] [&_[data-slot=card-title]]:leading-tight [&_[data-slot=card-title]]:font-bold [&_[data-slot=card-title]]:tracking-tight",
  "[&_[data-slot=input]]:h-11",
  "[&_[data-slot=card-description]]:mt-1 [&_[data-slot=card-description]]:leading-relaxed",
].join(" ")

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthShell>
      <div className={FLAT}>{children}</div>
    </AuthShell>
  )
}
