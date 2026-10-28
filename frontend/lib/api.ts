// Thin fetch wrapper for the AHEAD API. The access token lives in memory only; the
// refresh token is an HttpOnly cookie, so a page reload restores the session via /auth/refresh.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    /** X-Request-Id of the failed call, shown to users to quote to support */
    readonly requestId?: string
  ) {
    super(message)
  }

  /** Field errors from VALIDATION_FAILED responses */
  get fields(): Record<string, string> {
    return (this.details?.fields as Record<string, string>) ?? {}
  }
}

let accessToken: string | null = null
let refreshing: Promise<string | null> | null = null

/** Set when the last refresh failed because the server (or its database) was unreachable */
export let serverUnavailable = false

export const setAccessToken = (token: string | null) => {
  accessToken = token
}

/** Authorization header for raw fetches (file downloads) */
export const authHeader = (): Record<string, string> => (accessToken ? { authorization: `Bearer ${accessToken}` } : {})

export async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
    .then(async (res) => {
      // 5xx = API or database down: not the same as being signed out
      serverUnavailable = res.status >= 500
      if (!res.ok) return null
      const body = (await res.json()) as { accessToken: string }
      return body.accessToken
    })
    .catch(() => {
      serverUnavailable = true
      return null
    })
    .then((token) => {
      accessToken = token
      refreshing = null
      return token
    })
  return refreshing
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"

async function request<T>(method: Method, path: string, body?: unknown, retried = false): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection and try again.")
  }

  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    const token = await refreshAccessToken()
    if (token) return request<T>(method, path, body, true)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  let json: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    // Non-JSON body: usually the dev proxy reporting that the API process is down
    json = undefined
  }
  if (!res.ok) {
    const e = json?.error ?? {}
    const requestId = res.headers.get("x-request-id") ?? undefined
    if (!e.code && res.status >= 500) throw new ApiError(res.status, "PROVIDER_UNAVAILABLE", "The server is not responding. Please try again in a moment.", undefined, requestId)
    throw new ApiError(res.status, e.code ?? "INTERNAL", e.message ?? "Something went wrong.", e.details, requestId)
  }
  return json as T
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.")
