"use client"

import * as React from "react"
import { api, ApiError, refreshAccessToken, serverUnavailable, setAccessToken } from "@/lib/api"
import type { LockReason, Me, ModuleKey } from "@/lib/types"

interface AuthState {
  /** "unavailable" = the API or database is down; the session may still be valid */
  status: "loading" | "anonymous" | "authenticated" | "unavailable"
  me: Me | null
  /** Store a fresh access token (after login/signup) and load /me */
  signIn: (accessToken: string) => Promise<Me>
  signOut: () => Promise<void>
  reload: () => Promise<Me | null>
  /** Retry restoring the session after the server was unavailable */
  retry: () => Promise<void>
  switchTenant: (tenantId: string) => Promise<void>
  /** AHEAD team only: move this session into the Console */
  switchToConsole: () => Promise<void>
  /** Console permission check (UI only; the API enforces it) */
  canConsole: (permission: string) => boolean
  /** UI convenience only — the API enforces every permission */
  can: (permission: string) => boolean
  /** Why the plan holds back a permission the role has (null = not held back by the plan) */
  lockOf: (permission: string) => LockReason | null
  canView: (module: ModuleKey | "tenant") => boolean
  term: (key: string, fallback?: string) => string
}

const AuthContext = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthState["status"]>("loading")
  const [me, setMe] = React.useState<Me | null>(null)

  const reload = React.useCallback(async () => {
    try {
      const data = await api.get<Me>("/me")
      setMe(data)
      setStatus("authenticated")
      return data
    } catch (e) {
      const down = e instanceof ApiError && (e.status === 0 || e.status >= 500)
      if (!down) setMe(null)
      setStatus(down ? "unavailable" : "anonymous")
      return null
    }
  }, [])

  const restore = React.useCallback(async () => {
    const token = await refreshAccessToken()
    if (token) await reload()
    else setStatus(serverUnavailable ? "unavailable" : "anonymous")
  }, [reload])

  React.useEffect(() => {
    refreshAccessToken().then((token) => {
      if (token) void reload()
      else setStatus(serverUnavailable ? "unavailable" : "anonymous")
    })
  }, [reload])

  // Keep retrying quietly while the server is down
  React.useEffect(() => {
    if (status !== "unavailable") return
    const t = setInterval(() => void restore(), 10_000)
    return () => clearInterval(t)
  }, [status, restore])

  const signIn = React.useCallback(
    async (accessToken: string) => {
      setAccessToken(accessToken)
      const data = await reload()
      if (!data) throw new Error("Could not load your account.")
      return data
    },
    [reload]
  )

  const signOut = React.useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined)
    setAccessToken(null)
    setMe(null)
    setStatus("anonymous")
  }, [])

  const switchTenant = React.useCallback(
    async (tenantId: string) => {
      const { accessToken } = await api.post<{ accessToken: string }>("/auth/switch-tenant", { tenantId })
      // Close the pages of the old place first: anything they load with the new token fails
      // ("Switch to the AHEAD Console", "No active business") and flashes an error
      setStatus("loading")
      setAccessToken(accessToken)
      await reload()
    },
    [reload]
  )

  const switchToConsole = React.useCallback(async () => {
    const { accessToken } = await api.post<{ accessToken: string }>("/auth/switch-console")
    setStatus("loading")
    setAccessToken(accessToken)
    await reload()
  }, [reload])

  const value = React.useMemo<AuthState>(
    () => ({
      status,
      me,
      signIn,
      signOut,
      reload,
      retry: restore,
      switchTenant,
      switchToConsole,
      canConsole: (p) => !!me?.console?.permissions?.[p],
      can: (p) => !!me?.permissions?.[p],
      lockOf: (p) => me?.locked?.[p] ?? null,
      canView: (m) => Object.keys(me?.permissions ?? {}).some((k) => k.startsWith(`${m}.`) && k.endsWith(".view")),
      term: (key, fallback) => me?.terms?.[key] ?? fallback ?? key,
    }),
    [status, me, signIn, signOut, reload, restore, switchTenant, switchToConsole]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
