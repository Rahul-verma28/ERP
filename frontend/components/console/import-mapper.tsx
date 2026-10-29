"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2, FileUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/form"
import { parseCsv } from "@/lib/csv"
import { api, errorMessage } from "@/lib/api"
import type { ImportResult } from "@/lib/console"
import { cn } from "@/lib/utils"

// Data import with column matching (blueprint S4): upload a CSV, match each column to an AHEAD
// field (guessed from the header), see problems on the right, then import. The API checks
// every row again; nothing is trusted from the browser.

type Kind = "contacts" | "items"

const FIELDS: Record<Kind, { key: string; label: string; required?: boolean; aliases: string[] }[]> = {
  contacts: [
    { key: "name", label: "Customer name", required: true, aliases: ["name", "customer name", "party name", "full name", "contact name", "party"] },
    { key: "phone", label: "Mobile", aliases: ["phone", "mobile", "mob", "phone number", "mobile number", "contact", "mobile no"] },
    { key: "email", label: "Email", aliases: ["email", "email address", "e-mail", "mail"] },
    { key: "companyName", label: "Company", aliases: ["company", "company name", "business", "firm"] },
    { key: "gstin", label: "GSTIN", aliases: ["gstin", "gst", "gst no", "gst number", "gstin no"] },
    { key: "city", label: "City", aliases: ["city", "town", "place"] },
    { key: "notes", label: "Notes", aliases: ["notes", "note", "remarks", "comment"] },
  ],
  items: [
    { key: "name", label: "Item name", required: true, aliases: ["name", "item", "item name", "product", "product name", "service"] },
    { key: "type", label: "Product or service", aliases: ["type", "kind"] },
    { key: "sku", label: "SKU / code", aliases: ["sku", "code", "item code", "barcode"] },
    { key: "unit", label: "Unit", aliases: ["unit", "uom", "units"] },
    { key: "price", label: "Price (₹)", aliases: ["price", "rate", "mrp", "selling price", "sale price"] },
    { key: "gstRate", label: "GST %", aliases: ["gst", "gst %", "gst rate", "tax", "tax %"] },
    { key: "hsnSac", label: "HSN / SAC", aliases: ["hsn", "sac", "hsn/sac", "hsn code"] },
    { key: "description", label: "Description", aliases: ["description", "details"] },
  ],
}

const guess = (kind: Kind, header: string) => FIELDS[kind].find((f) => f.aliases.includes(header.trim().toLowerCase()))?.key ?? ""

interface Problem {
  title: string
  text: string
}

export function ImportMapper({ tenantId, onImported }: { tenantId: string; onImported: (kind: Kind, r: ImportResult) => void }) {
  const [kind, setKind] = React.useState<Kind>("contacts")
  const [file, setFile] = React.useState<{ name: string; header: string[]; rows: string[][] } | null>(null)
  const [map, setMap] = React.useState<string[]>([])
  const [skip, setSkip] = React.useState<boolean[]>([])
  const [onDuplicate, setOnDuplicate] = React.useState<"skip" | "update">("skip")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ImportResult | null>(null)

  function load(kindNow: Kind, f: { name: string; header: string[]; rows: string[][] }) {
    setFile(f)
    setMap(f.header.map((h) => guess(kindNow, h)))
    setSkip(f.header.map(() => false))
    setResult(null)
    setError(null)
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    if (f.size > 2_000_000) return setError("Files up to 2 MB, about 1,000 rows. Split bigger files.")
    const parsed = parseCsv(await f.text())
    const [header, ...rows] = parsed
    if (!header?.length || !rows.length) return setError("This file has no rows under the header.")
    if (rows.length > 1000) return setError(`This file has ${rows.length.toLocaleString("en-IN")} rows. Import up to 1,000 at a time.`)
    load(kind, { name: f.name, header, rows })
  }

  const fields = FIELDS[kind]
  const used = map.filter((m, i) => m && !skip[i])
  const problems: Problem[] = []
  if (file) {
    const unmatched = file.header.filter((_, i) => !map[i] && !skip[i])
    for (const h of unmatched) problems.push({ title: "Column not matched", text: `"${h}" has no AHEAD field. Match it, or skip it.` })
    for (const f of fields.filter((x) => x.required && !used.includes(x.key))) problems.push({ title: `${f.label} is required`, text: "Match one column to it." })
    const twice = used.filter((m, i) => used.indexOf(m) !== i)
    for (const m of [...new Set(twice)]) problems.push({ title: "Two columns, one field", text: `More than one column is matched to ${fields.find((f) => f.key === m)?.label}.` })
    const phoneCol = map.findIndex((m, i) => m === "phone" && !skip[i])
    if (phoneCol >= 0) {
      const phones = file.rows.map((r) => r[phoneCol]?.replace(/\D/g, "").slice(-10)).filter(Boolean)
      const dup = phones.length - new Set(phones).size
      if (dup) problems.push({ title: `${dup} repeated mobile${dup === 1 ? "" : "s"}`, text: "Only the first row with each mobile is imported." })
    }
  }
  const blocking = problems.some((p) => p.title.endsWith("required") || p.title.startsWith("Two columns"))

  async function run() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const rows = file.rows.map((r) => Object.fromEntries(map.map((m, i) => [m, r[i]]).filter(([m, v], i) => m && !skip[i] && v?.trim())))
      const r = await api.post<ImportResult>(`/console/onboarding/${tenantId}/import`, { kind, rows, onDuplicate })
      setResult(r)
      onImported(kind, r)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-1" role="group" aria-label="What to import">
          {(["contacts", "items"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => (setKind(k), file && load(k, file))} className={cn("h-8 rounded-md px-3 text-[13px] font-medium", kind === k ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
              {k === "contacts" ? "Customers" : "Products & services"}
            </button>
          ))}
        </div>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-medium hover:bg-muted">
          <FileUp className="size-4" /> {file ? "Choose another file" : "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={pick} />
        </label>
        {file && <span className="text-[13px] text-muted-foreground">{file.name} · {file.rows.length.toLocaleString("en-IN")} rows</span>}
      </div>
      {error && <p className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="size-4" /> {error}</p>}

      {!file ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Export customers or products from Excel, Tally or the old software as CSV. The first row must hold the column names.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_17rem]">
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="w-10 px-3 py-2 font-medium">Use</th>
                  <th className="px-3 py-2 font-medium">Your column</th>
                  <th className="px-3 py-2 font-medium">AHEAD field</th>
                  <th className="px-3 py-2 font-medium">First value</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {file.header.map((h, i) => {
                  const ok = skip[i] || !!map[i]
                  return (
                    <tr key={i} className={cn("border-b last:border-0", skip[i] && "text-muted-foreground")}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={!skip[i]} onChange={(e) => setSkip((s) => s.map((x, j) => (j === i ? !e.target.checked : x)))} aria-label={`Use ${h}`} className="size-4 accent-[var(--primary)]" />
                      </td>
                      <td className="px-3 py-1.5 font-medium whitespace-nowrap">{h || `Column ${i + 1}`}</td>
                      <td className="px-3 py-1.5">
                        <NativeSelect value={map[i] ?? ""} disabled={skip[i]} onChange={(e) => setMap((m) => m.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`AHEAD field for ${h}`} className={cn("h-8 min-w-44", !ok && "border-destructive text-destructive")}>
                          <option value="">No match</option>
                          {fields.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>
                          ))}
                        </NativeSelect>
                      </td>
                      <td className="max-w-48 truncate px-3 py-1.5 text-muted-foreground">{file.rows[0]?.[i] || "—"}</td>
                      <td className="px-3 py-1.5">{ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertCircle className="size-4 text-destructive" />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="grid content-start gap-3">
            <div className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between text-[13px] font-semibold">
                Problems <span className={cn("rounded-full px-2 text-xs", problems.length ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300")}>{problems.length}</span>
              </div>
              {problems.length ? (
                <ul className="grid gap-2">
                  {problems.map((p, i) => (
                    <li key={i} className="rounded-lg bg-red-50 p-2 text-xs dark:bg-red-950/40">
                      <b className="block text-red-700 dark:text-red-300">{p.title}</b>
                      <span className="text-foreground/80">{p.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Every column is matched.</p>
              )}
            </div>
            <label className="grid gap-1 text-[13px]">
              <span className="font-medium">If it already exists</span>
              <NativeSelect value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value as "skip" | "update")}>
                <option value="skip">Keep the existing record</option>
                <option value="update">Update it from the file</option>
              </NativeSelect>
            </label>
            <Button type="button" onClick={run} disabled={busy || blocking}>
              {busy ? "Importing…" : `Import ${file.rows.length.toLocaleString("en-IN")} rows`}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-xl border bg-card p-3 text-sm">
          <p className="font-medium">
            {result.created} added{result.updated ? `, ${result.updated} updated` : ""}
            {result.duplicates.length ? `, ${result.duplicates.length} already there` : ""}
            {result.errors.length ? `, ${result.errors.length} with problems` : ""}.
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 grid max-h-40 gap-1 overflow-y-auto text-xs text-muted-foreground">
              {result.errors.slice(0, 50).map((e) => (
                <li key={e.row}>Row {e.row + 1}: {e.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
