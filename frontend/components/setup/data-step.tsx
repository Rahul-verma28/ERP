"use client"

import * as React from "react"
import Link from "next/link"
import { Check, Download, FileSpreadsheet, Upload } from "lucide-react"
import { email as emailRule, gstin as gstinRule, hsn as hsnRule, phone as phoneRule, sac as sacRule, storedPhone } from "@contracts/validation"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { NativeSelect } from "@/components/form"
import { ChoiceChip } from "@/components/onboarding"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { downloadCsv, parseCsv } from "@/lib/csv"
import { cn } from "@/lib/utils"
import { StepFooter, StepHeader, useStepSave, type StepProps } from "./wizard"

// Wireframe 2.4: Import a file (Upload → Map columns → Preview & fix → Import, with
// Skip/Update for duplicates), Try with sample data, or Start fresh.

const MAX_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 1000
const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28]

export type ImportKind = "customers" | "items"
type Kind = ImportKind
interface Target {
  key: string
  label: string
  required?: boolean
  aliases: string[]
  check?: (v: string) => string | null
}

const TARGETS: Record<Kind, Target[]> = {
  customers: [
    { key: "name", label: "Customer name", required: true, aliases: ["name", "customer", "customer name", "client", "client name", "full name"] },
    { key: "phone", label: "Mobile", aliases: ["phone", "mobile", "phone number", "mobile number", "contact", "whatsapp"], check: phoneRule },
    { key: "email", label: "Email", aliases: ["email", "email address", "e-mail", "mail"], check: emailRule },
    { key: "companyName", label: "Company", aliases: ["company", "company name", "business", "firm"] },
    { key: "gstin", label: "GSTIN", aliases: ["gstin", "gst", "gst number", "gst no"], check: gstinRule },
    { key: "city", label: "City", aliases: ["city", "town", "location"] },
    { key: "notes", label: "Notes", aliases: ["notes", "note", "remarks", "comments"] },
  ],
  items: [
    { key: "name", label: "Item name", required: true, aliases: ["name", "item", "item name", "product", "product name", "service", "service name"] },
    { key: "type", label: "Product or service", aliases: ["type", "kind", "product/service"] },
    { key: "sku", label: "SKU / code", aliases: ["sku", "code", "item code", "barcode"] },
    { key: "unit", label: "Unit", aliases: ["unit", "uom", "units"] },
    { key: "price", label: "Price (₹)", aliases: ["price", "rate", "mrp", "selling price", "sale price", "amount"], check: (v) => (Number.isFinite(Number(v.replace(/[₹,\s]/g, ""))) ? null : "Price must be a number") },
    { key: "gstRate", label: "GST %", aliases: ["gst %", "gst rate", "tax", "tax rate", "gst%"], check: (v) => (GST_RATES.includes(Number(v.replace("%", ""))) ? null : "GST rate must be 0, 0.25, 3, 5, 12, 18 or 28") },
    { key: "hsnSac", label: "HSN / SAC", aliases: ["hsn", "sac", "hsn/sac", "hsn code", "sac code"], check: (v) => (hsnRule(v) && sacRule(v) ? "Use a 4, 6 or 8-digit HSN or a 6-digit SAC" : null) },
    { key: "description", label: "Description", aliases: ["description", "details"] },
  ],
}
const TEMPLATE: Record<Kind, string[][]> = {
  customers: [["Name", "Phone", "Email", "Company", "GSTIN", "City", "Notes"], ["Meera Kulkarni", "9820111223", "meera@example.com", "", "", "Mumbai", "Prefers WhatsApp"]],
  items: [["Name", "Type", "SKU", "Unit", "Price", "GST %", "HSN/SAC", "Description"], ["Hair spa", "Service", "", "service", "1500", "18", "999721", ""]],
}
const STEPS = ["Upload", "Map columns", "Preview & fix", "Import"] as const

interface Parsed {
  name: string
  header: string[]
  body: string[][]
}
interface ImportResult {
  created: number
  updated: number
  duplicates: { row: number; name: string; reason: string }[]
  errors: { row: number; message: string }[]
}

const autoMap = (kind: Kind, header: string[]) =>
  header.map((h) => {
    const k = h.trim().toLowerCase()
    return TARGETS[kind].find((t) => t.aliases.includes(k) || t.label.toLowerCase() === k)?.key ?? ""
  })

/** The setup step; with importKind it is just the import flow (Settings › Data). */
export function DataStep({ complete, back, importKind, onImported }: StepProps & { importKind?: ImportKind; onImported?: () => void }) {
  const { term, can } = useAuth()
  const customers = term("entity.contact.plural", "Customers")
  const itemsLabel = term("entity.item.plural", "Products & services")
  const [mode, setMode] = React.useState<"import" | "sample" | "fresh">("import")
  const [kind, setKind] = React.useState<Kind>(importKind ?? "customers")
  const [stage, setStage] = React.useState(0)
  const [file, setFile] = React.useState<Parsed | null>(null)
  const [mapping, setMapping] = React.useState<string[]>([])
  const [onDuplicate, setOnDuplicate] = React.useState<"skip" | "update">("skip")
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [sample, setSample] = React.useState<number | null>(null)
  const { saving, error, run } = useStepSave()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const kindLabel = kind === "customers" ? customers : itemsLabel
  const canImport = kind === "customers" ? can("crm.contact.create") : can("catalog.item.create")
  const targets = TARGETS[kind]

  const reset = (k: Kind = kind) => {
    setKind(k)
    setStage(0)
    setFile(null)
    setResult(null)
    setFileError(null)
  }

  const pick = async (f: File | undefined) => {
    setFileError(null)
    if (!f) return
    if (!/\.csv$/i.test(f.name)) return setFileError("Use a .csv file. In Excel: File › Save as › CSV (Comma delimited).")
    if (f.size > MAX_BYTES) return setFileError("This file is larger than 5 MB. Split it into smaller files.")
    const [header, ...body] = parseCsv(await f.text())
    if (!header || !body.length) return setFileError("No rows found. The first row must be the column names.")
    if (body.length > MAX_ROWS) return setFileError(`This file has ${body.length.toLocaleString("en-IN")} rows; import up to ${MAX_ROWS.toLocaleString("en-IN")} at a time.`)
    setFile({ name: f.name, header, body })
    setMapping(autoMap(kind, header))
    setStage(1)
  }

  // Rows as { targetKey: value } with their problems, after the mapping
  const mappedRows = React.useMemo(() => {
    if (!file) return []
    const seen = new Set<string>()
    return file.body.map((cells, i) => {
      const data: Record<string, string> = {}
      mapping.forEach((t, c) => {
        if (t && cells[c]?.trim()) data[t] = cells[c].trim()
      })
      let problem: string | null = data.name ? null : `${targets[0].label} is missing`
      for (const t of targets) if (!problem && t.check && data[t.key]) problem = t.check(data[t.key])
      const dupKey = kind === "customers" ? (data.phone && !phoneRule(data.phone) ? storedPhone(data.phone) : data.email?.toLowerCase()) : (data.sku ?? data.name)?.toLowerCase()
      const duplicate = !problem && !!dupKey && seen.has(dupKey)
      if (dupKey && !problem) seen.add(dupKey)
      return { row: i + 2, data, problem, duplicate }
    })
  }, [file, mapping, targets, kind])
  const ready = mappedRows.filter((r) => !r.problem && !r.duplicate)
  const bad = mappedRows.filter((r) => r.problem)
  const dups = mappedRows.filter((r) => r.duplicate)
  const nameMapped = mapping.includes("name")
  const mappedTargets = targets.filter((t) => mapping.includes(t.key))

  const doImport = () =>
    run(async () => {
      const rows = ready.map((r) => r.data)
      const r =
        kind === "customers"
          ? await api.post<ImportResult>("/contacts/import", { type: "customer", rows, onDuplicate })
          : await api.post<ImportResult>("/items/import", { rows, onDuplicate })
      setResult({ ...r, updated: r.updated ?? 0 })
      onImported?.()
      setStage(3)
    })

  const addSample = () =>
    run(async () => {
      const r = await api.post<{ created: number; alreadyThere: boolean }>("/tenant/sample-data")
      setSample(r.alreadyThere ? -1 : r.created)
    })

  const downloadErrors = () =>
    downloadCsv("rows-to-fix.csv", [["Row", ...mappedTargets.map((t) => t.label), "Problem"], ...[...bad, ...dups].map((r) => [r.row, ...mappedTargets.map((t) => r.data[t.key] ?? ""), r.problem ?? "Repeated in the file"])])

  const done = mode === "fresh" || (mode === "import" && !!result?.created) || (mode === "sample" && sample !== null)

  return (
    <form
      className="flex min-h-full flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => complete(done || result ? "done" : "skipped"))
      }}
    >
      <StepHeader title="Bring your data" description="Start with what you already have, or explore with sample data first." />
      {!importKind && (
      <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="How to start">
        <ChoiceChip selected={mode === "import"} onClick={() => setMode("import")} className="grid gap-0.5 rounded-[10px] px-3.5 py-3">
          <span className="text-sm font-bold">Import a file</span>
          <span className="text-xs font-normal text-muted-foreground">{customers}, {itemsLabel.toLowerCase()}</span>
        </ChoiceChip>
        <ChoiceChip selected={mode === "sample"} onClick={() => setMode("sample")} className="grid gap-0.5 rounded-[10px] px-3.5 py-3">
          <span className="text-sm font-bold">Try with sample data</span>
          <span className="text-xs font-normal text-muted-foreground">20 sample {customers.toLowerCase()} — remove in one click</span>
        </ChoiceChip>
        <ChoiceChip selected={mode === "fresh"} onClick={() => setMode("fresh")} className="grid gap-0.5 rounded-[10px] px-3.5 py-3">
          <span className="text-sm font-bold">Start fresh</span>
          <span className="text-xs font-normal text-muted-foreground">Add records as you go</span>
        </ChoiceChip>
      </div>
      )}

      {mode === "import" && (
        <div className="grid min-h-0 gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-3.5">
            <NativeSelect value={kind} onChange={(e) => reset(e.target.value as Kind)} aria-label="What to import" className="h-9 w-48">
              <option value="customers">{customers}</option>
              <option value="items">{itemsLabel}</option>
            </NativeSelect>
            <ol className="flex flex-wrap items-center gap-2" aria-label="Import steps">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  {i > 0 && <span className="text-border" aria-hidden>—</span>}
                  <span className={cn("flex items-center gap-1.5 text-xs font-semibold", i === stage ? "text-accent-foreground" : "text-muted-foreground")} aria-current={i === stage ? "step" : undefined}>
                    <span className="grid size-[18px] place-items-center rounded-full border-[1.5px] border-current text-[10px]">{i < stage ? <Check className="size-3" /> : i + 1}</span>
                    {s}
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => downloadCsv(`${kind}-template.csv`, TEMPLATE[kind])}>
              <Download className="size-3.5" /> Download template
            </button>
          </div>

          {!canImport && <p className="text-sm text-muted-foreground">Your role can&apos;t import {kindLabel.toLowerCase()}.</p>}

          {canImport && stage === 0 && (
            <div
              className="grid place-items-center gap-2 rounded-xl border border-dashed border-input px-4 py-10 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                void pick(e.dataTransfer.files?.[0])
              }}
            >
              <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-semibold">Drop your {kindLabel.toLowerCase()} file here</p>
              <p className="text-xs text-muted-foreground">CSV up to 5 MB and {MAX_ROWS.toLocaleString("en-IN")} rows. First row = column names.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                <Upload /> Choose CSV file
              </Button>
              <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} aria-label="CSV file" />
              {fileError && <p className="text-sm text-destructive">{fileError}</p>}
            </div>
          )}

          {file && stage === 1 && (
            <div className="grid gap-3">
              <p className="text-sm">
                <strong>{file.name}</strong> · {file.body.length} rows. Match your columns to AHEAD fields — we guessed from the names.
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Your column</TableHead>
                      <TableHead>First value</TableHead>
                      <TableHead>AHEAD field</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {file.header.map((h, c) => (
                      <TableRow key={c}>
                        <TableCell className="font-medium">{h || `Column ${c + 1}`}</TableCell>
                        <TableCell className="text-muted-foreground">{file.body[0]?.[c] || "—"}</TableCell>
                        <TableCell>
                          <NativeSelect
                            value={mapping[c] ?? ""}
                            onChange={(e) => setMapping((m) => m.map((x, i) => (i === c ? e.target.value : x === e.target.value && e.target.value ? "" : x)))}
                            aria-label={`AHEAD field for ${h}`}
                            className="h-8 w-52"
                          >
                            <option value="">Don&apos;t import</option>
                            {targets.map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.label}
                                {t.required ? " *" : ""}
                              </option>
                            ))}
                          </NativeSelect>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {!nameMapped && <p className="text-xs text-destructive">Choose which column is the {targets[0].label.toLowerCase()}.</p>}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => reset()}>
                  Choose another file
                </Button>
                <Button type="button" className="ml-auto" disabled={!nameMapped} onClick={() => setStage(2)}>
                  Preview
                </Button>
              </div>
            </div>
          )}

          {file && stage === 2 && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-4 text-[13px]">
                <span>
                  <strong>{file.name}</strong> · {mappedRows.length} rows
                </span>
                <span className="font-semibold text-[#1F7A4D] dark:text-emerald-400">{ready.length} ready</span>
                {bad.length > 0 && <span className="font-semibold text-destructive">{bad.length} with errors</span>}
                {dups.length > 0 && <span className="font-semibold text-[#8A5A00] dark:text-amber-400">{dups.length} duplicates</span>}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="align-top">Row</TableHead>
                      {mappedTargets.slice(0, 4).map((t) => (
                        <TableHead key={t.key} className="align-top">
                          <span className="block text-[11px] font-normal">{file.header[mapping.indexOf(t.key)]} →</span>
                          <span className="text-foreground">{t.label}</span>
                        </TableHead>
                      ))}
                      <TableHead className="align-top">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappedRows.slice(0, 10).map((r) => (
                      <TableRow key={r.row} className={cn(r.problem && "bg-[#FDECEA] dark:bg-red-950/40", !r.problem && r.duplicate && "bg-[#FFF8EB] dark:bg-amber-950/40")}>
                        <TableCell className="tabular-nums">{r.row}</TableCell>
                        {mappedTargets.slice(0, 4).map((t) => (
                          <TableCell key={t.key}>{r.data[t.key] ?? ""}</TableCell>
                        ))}
                        <TableCell className={cn("text-xs", r.problem ? "text-destructive" : r.duplicate ? "text-[#8A5A00] dark:text-amber-400" : "text-[#1F7A4D] dark:text-emerald-400")}>
                          {r.problem ?? (r.duplicate ? "Same as an earlier row" : "Ready")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {mappedRows.length > 10 && <p className="text-xs text-muted-foreground">Showing the first 10 rows.</p>}
              <div className="flex flex-wrap items-center gap-4 text-[13px]">
                <span>Already in AHEAD:</span>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="dup" checked={onDuplicate === "skip"} onChange={() => setOnDuplicate("skip")} /> Skip
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="dup" checked={onDuplicate === "update"} onChange={() => setOnDuplicate("update")} /> Update existing
                </label>
                {(bad.length > 0 || dups.length > 0) && (
                  <button type="button" className="ml-auto font-semibold text-primary hover:underline" onClick={downloadErrors}>
                    Download {bad.length + dups.length} rows to fix
                  </button>
                )}
                <Button type="button" variant="ghost" onClick={() => setStage(1)} className={cn(!(bad.length > 0 || dups.length > 0) && "ml-auto")}>
                  Back to mapping
                </Button>
                <Button type="button" onClick={() => void doImport()} disabled={!ready.length || saving}>
                  {saving ? "Importing…" : `Import ${ready.length} ${kindLabel.toLowerCase()}`}
                </Button>
              </div>
            </div>
          )}

          {result && stage === 3 && (
            <div role="status" className="grid gap-1 rounded-lg bg-[#F1F8F4] p-4 text-sm text-[#14532D] dark:bg-emerald-950 dark:text-emerald-100">
              <p className="font-semibold">
                Imported {result.created} {kindLabel.toLowerCase()}
                {result.updated ? ` · updated ${result.updated}` : ""}.
              </p>
              {result.duplicates.length > 0 && <p>{result.duplicates.length} skipped — already in AHEAD.</p>}
              {result.errors.length > 0 && <p>{result.errors.length} rows had problems and were not imported.</p>}
              <div className="flex gap-4">
                <Link href={kind === "customers" ? "/app/m/sales/customers" : "/app/m/catalog"} target="_blank" className="font-semibold underline underline-offset-2">
                  Open {kindLabel}
                </Link>
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => reset(kind === "customers" ? "items" : "customers")}>
                  Import {kind === "customers" ? itemsLabel.toLowerCase() : customers.toLowerCase()} too
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "sample" && (
        <div className="grid gap-3 rounded-xl border p-5 text-sm">
          {sample === null ? (
            <>
              <p>
                We&apos;ll add <strong>20 sample {customers.toLowerCase()}</strong> so you can try invoices, bookings and reports. They&apos;re tagged as samples and removed together from Settings › Data.
              </p>
              <div>
                <Button type="button" onClick={() => void addSample()} disabled={saving}>
                  {saving ? "Adding…" : "Add sample data"}
                </Button>
              </div>
            </>
          ) : (
            <p role="status" className="text-[#1F7A4D] dark:text-emerald-400">
              {sample === -1 ? "Sample data is already in your workspace." : `Added ${sample} sample ${customers.toLowerCase()}.`} Remove them any time from Settings › Data.
            </p>
          )}
        </div>
      )}

      {mode === "fresh" && <div className="rounded-xl border p-5 text-sm text-muted-foreground">Nothing to import now — add {customers.toLowerCase()} and {itemsLabel.toLowerCase()} as you go.</div>}

      {!importKind && <StepFooter back={back} onSkip={() => void complete("skipped")} saving={saving} error={error} saveLabel="Continue" note="Checked against your plan's limits · people already in AHEAD are matched by mobile or email" />}
    </form>
  )
}
