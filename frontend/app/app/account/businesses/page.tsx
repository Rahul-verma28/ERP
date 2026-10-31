"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { useAccountBase } from "@/lib/account-base"

// My businesses is now part of My account (one page).
export default function Moved() {
  const router = useRouter()
  const base = useAccountBase()
  React.useEffect(() => router.replace(`${base.account}`), [router, base.account])
  return null
}
