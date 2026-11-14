"use client"

import * as React from "react"
import { api, ApiError } from "@/lib/api"

const toApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(500, "INTERNAL", "Something went wrong."))

interface State<T> {
  path: string | null
  data: T | null
  error: ApiError | null
}

/** Load a GET endpoint; returns data, error and a reload function. */
export function useApi<T>(path: string | null) {
  const [state, setState] = React.useState<State<T>>({ path: null, data: null, error: null })

  React.useEffect(() => {
    if (!path) return
    let cancelled = false
    api
      .get<T>(path)
      .then((data) => !cancelled && setState({ path, data, error: null }))
      .catch((e) => !cancelled && setState((s) => ({ path, data: s.data, error: toApiError(e) })))
    return () => {
      cancelled = true
    }
  }, [path])

  const reload = React.useCallback(async () => {
    if (!path) return
    try {
      const data = await api.get<T>(path)
      setState({ path, data, error: null })
    } catch (e) {
      setState((s) => ({ ...s, path, error: toApiError(e) }))
    }
  }, [path])

  const setData = React.useCallback((data: T) => setState((s) => ({ ...s, data })), [])

  return {
    data: state.data,
    error: state.error,
    loading: !!path && state.path !== path,
    reload,
    setData,
  }
}

// Lists many parts of one screen need (warehouses, categories, units): fetched once and shared,
// so a dialog with three warehouse boxes asks the server one time, not three.
const shared = new Map<string, { data?: unknown; error?: ApiError; at?: number; promise?: Promise<unknown>; listeners: Set<() => void> }>()

function entry(path: string) {
  let e = shared.get(path)
  if (!e) shared.set(path, (e = { listeners: new Set() }))
  return e
}

function fetchShared(path: string, force = false) {
  const e = entry(path)
  if (e.promise && !force) return e.promise
  e.promise = api.get(path).then(
    (data) => {
      e.data = data
      e.error = undefined
      e.at = Date.now()
      e.listeners.forEach((l) => l())
      return data
    },
    (err) => {
      // Every screen reading this list learns it failed, so none of them spins for ever
      e.error = toApiError(err)
      e.promise = undefined
      e.listeners.forEach((l) => l())
      throw e.error
    },
  )
  return e.promise
}

/** Like useApi, for a list that many components on a page read at once */
export function useSharedApi<T>(path: string | null) {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    if (!path) return
    const e = entry(path)
    e.listeners.add(rerender)
    // A screen opened later reads it fresh: someone may have added a warehouse since
    if (e.data === undefined || Date.now() - (e.at ?? 0) > 15_000) void fetchShared(path).catch(() => undefined)
    return () => {
      e.listeners.delete(rerender)
    }
  }, [path])
  const reload = React.useCallback(async () => {
    if (path) await fetchShared(path, true).catch(() => undefined)
  }, [path])
  const e = path ? shared.get(path) : undefined
  const data = (e?.data as T | undefined) ?? null
  // Data already on screen wins over a later failed refresh
  const error = data ? null : (e?.error ?? null)
  return { data, error, loading: !!path && !data && !error, reload }
}
