"use client"

import * as React from "react"

// "Has anything changed?" for forms that keep their values in plain state. The first value seen
// is the saved one; `dirty` is true while the current value differs from it (deep compare).
// After a save, call `reset(next)` so the new values become the saved ones.

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function useDirty<T>(value: T) {
  const [base, setBase] = React.useState<T>(value)
  const dirty = !same(base, value)
  const reset = React.useCallback((next: T) => setBase(next), [])
  return { dirty, reset, base }
}

/** True when the value differs from the one given first (no reset needed: dialogs remount) */
export function useChanged<T>(value: T) {
  return useDirty(value).dirty
}
