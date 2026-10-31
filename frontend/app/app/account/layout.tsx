"use client"

// My account: one page for the signed-in person (profile, password and sign-in, preferences,
// notifications, devices), the same in every business.

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-1 px-4 py-6 sm:px-7">{children}</div>
}
