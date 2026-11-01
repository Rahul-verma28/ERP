"use client"

import * as React from "react"
import { ApiError, errorMessage } from "@/lib/api"

// Form state + the validation checklist (Phase 0): errors show on blur and on submit, never
// while a field is first being typed; after that they update live. Submit validates
// everything, moves focus to the first error and maps the API's 422 field errors back.

type Values = Record<string, unknown>
export type FieldRules<T extends Values> = { [K in keyof T]?: (value: T[K], values: T) => string | null | undefined }
export type FieldClean<T extends Values> = { [K in keyof T]?: (value: T[K]) => T[K] }

export interface UseFormOptions<T extends Values> {
  initial: T
  rules?: FieldRules<T>
  /** Applied on blur and before submit (trim, upper-case GSTIN …) */
  clean?: FieldClean<T>
  /** Human names for the error summary; defaults to the key */
  labels?: Partial<Record<keyof T, string>>
  /** API field path (e.g. "address.pincode") → form key; default: same name */
  fromServer?: (path: string) => keyof T | undefined
  onSubmit: (values: T, changed: (keyof T)[]) => Promise<void> | void
}

/** Throw from onSubmit when the user backs out (e.g. closes a confirm dialog): no error is shown. */
export class Cancelled extends Error {
  constructor() {
    super("Cancelled")
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function validate<T extends Values>(rules: FieldRules<T> | undefined, v: T) {
  const out: Partial<Record<keyof T, string>> = {}
  for (const key of Object.keys(rules ?? {}) as (keyof T)[]) {
    const msg = rules?.[key]?.(v[key], v)
    if (msg) out[key] = msg
  }
  return out
}

function applyClean<T extends Values>(clean: FieldClean<T> | undefined, v: T): T {
  const out = { ...v }
  for (const key of Object.keys(clean ?? {}) as (keyof T)[]) out[key] = clean![key]!(out[key])
  return out
}

export function useForm<T extends Values>(opts: UseFormOptions<T>) {
  // Latest options for event handlers (onSubmit closes over fresh props)
  const optsRef = React.useRef(opts)
  React.useEffect(() => {
    optsRef.current = opts
  })
  const [initial, setInitial] = React.useState<T>(opts.initial)
  const [values, setValues] = React.useState<T>(opts.initial)
  const [touched, setTouched] = React.useState<Partial<Record<keyof T, boolean>>>({})
  const [server, setServer] = React.useState<Partial<Record<keyof T, string>>>({})
  const [submitted, setSubmitted] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [formEl, setFormEl] = React.useState<HTMLFormElement | null>(null)

  const allErrors = validate(opts.rules, values)
  const errors: Partial<Record<keyof T, string>> = {}
  for (const key of Object.keys(values) as (keyof T)[]) {
    const msg = server[key] ?? allErrors[key]
    if (msg && (submitted || touched[key] || server[key])) errors[key] = msg
  }
  const changed = (Object.keys(values) as (keyof T)[]).filter((k) => !same(values[k], initial[k]))

  const set = React.useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setServer((s) => (s[key] ? { ...s, [key]: undefined } : s))
  }, [])

  const blur = React.useCallback((key: keyof T) => {
    const clean = optsRef.current.clean?.[key]
    if (clean) setValues((v) => (same(clean(v[key]), v[key]) ? v : { ...v, [key]: clean(v[key]) }))
    setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  }, [])

  /** Props for a text-like input or select bound to `key`. */
  const field = <K extends keyof T>(key: K) => ({
    name: String(key),
    value: (values[key] ?? "") as string | number,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(key, e.target.value as T[K]),
    onBlur: () => blur(key),
  })

  /** Props for a common dropdown (StateSelect, IndustrySelect, SearchSelect) bound to `key`. */
  const pick = <K extends keyof T>(key: K) => ({
    name: String(key),
    value: (values[key] ?? "") as string,
    onChange: (value: string) => set(key, value as T[K]),
    onBlur: () => blur(key),
  })

  /** Start over from `next` (e.g. what the API returned after saving) or the original values. */
  const reset = React.useCallback((next?: T) => {
    const v = next ?? optsRef.current.initial
    setInitial(v)
    setValues(v)
    setTouched({})
    setServer({})
    setSubmitted(false)
    setFormError(null)
  }, [])

  const focusFirst = (keys: (keyof T)[]) => {
    if (!formEl) return
    for (const el of Array.from(formEl.querySelectorAll<HTMLElement>("[name]"))) {
      if (keys.includes(el.getAttribute("name") as keyof T)) {
        el.focus()
        return
      }
    }
  }

  /** Validate only some fields (one step of a multi-step form); shows their errors and focuses the first. */
  const check = (keys: (keyof T)[]) => {
    const o = optsRef.current
    const cleaned = applyClean(o.clean, values)
    setValues(cleaned)
    setTouched((t) => ({ ...t, ...Object.fromEntries(keys.map((k) => [k, true])) }))
    const errs = validate(o.rules, cleaned)
    const bad = keys.filter((k) => errs[k] || server[k])
    if (bad.length) requestAnimationFrame(() => focusFirst(bad))
    return bad.length === 0
  }

  /** Show field errors that came from somewhere else (e.g. the API on a later step). */
  const setServerErrors = (fields: Partial<Record<keyof T, string>>) => {
    setServer(fields)
    requestAnimationFrame(() => focusFirst(Object.keys(fields) as (keyof T)[]))
  }

  /** Resolves true when onSubmit finished without an error. */
  const submit = async (e?: React.FormEvent): Promise<boolean> => {
    e?.preventDefault()
    if (submitting) return false // no double submit
    const o = optsRef.current
    const cleaned = applyClean(o.clean, values)
    setValues(cleaned)
    setSubmitted(true)
    setFormError(null)
    const bad = Object.keys(validate(o.rules, cleaned)) as (keyof T)[]
    if (bad.length) {
      requestAnimationFrame(() => focusFirst(bad))
      return false
    }
    setSubmitting(true)
    try {
      await o.onSubmit(cleaned, (Object.keys(cleaned) as (keyof T)[]).filter((k) => !same(cleaned[k], initial[k])))
      return true
    } catch (err) {
      if (err instanceof Cancelled) return false
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        const mapped: Partial<Record<keyof T, string>> = {}
        let unmapped: string | null = null
        for (const [path, msg] of Object.entries(err.fields)) {
          const key = o.fromServer?.(path) ?? (path in cleaned ? (path as keyof T) : undefined)
          if (key) mapped[key] = msg
          else unmapped ??= msg
        }
        setServer(mapped)
        setFormError(unmapped ?? (Object.keys(mapped).length ? null : err.message))
        requestAnimationFrame(() => focusFirst(Object.keys(mapped) as (keyof T)[]))
      } else {
        setFormError(errorMessage(err))
      }
      return false
    } finally {
      setSubmitting(false)
    }
  }

  return {
    values,
    set,
    blur,
    field,
    pick,
    errors,
    hasErrors: Object.keys(allErrors).length > 0,
    changed,
    dirty: changed.length > 0,
    submit,
    check,
    setServerErrors,
    submitting,
    submitted,
    formError,
    setFormError,
    reset,
    /** Spread on the <form> so submit can focus the first invalid field */
    formProps: { ref: setFormEl, noValidate: true },
    /** Errors to list in the summary box (shown once there are 3 or more) */
    summary: Object.keys(errors).map((k) => opts.labels?.[k as keyof T] ?? k),
  }
}

export type FormApi<T extends Values> = ReturnType<typeof useForm<T>>
