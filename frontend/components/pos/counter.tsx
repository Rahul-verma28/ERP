"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeftRight, Banknote, Expand, Loader2, Lock, Package, PauseCircle, Pencil, ScanBarcode, Search, Settings2, Shrink, Store, Trash2, Undo2, User, X } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState, MoneyInput } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { ModuleLocked, PageLoading, PageError } from "@/components/page-states"
import { CashMoveDialog, CustomerDialog, DoneDialog, HeldDialog, PayDialog, ReturnDialog, SerialDialog, type HeldBill, type SaleResult } from "@/components/pos/dialogs"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise, formatDateTime } from "@/lib/format"
import { cartTotals, emptyCart, type Cart, type CartLine, type PosItem, type Register, type ShiftSummary, type Tender } from "@/lib/pos"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"
import { FileImg } from "@/components/file-field"

// The POS counter: scan or tap items, set the customer, take payment and print. A barcode scanner
// types into the search box and presses Enter, so a scan adds the item at once. Keys: F2 search,
// F4 customer, F8 hold, F9 or Ctrl+Enter pay. The cart is kept on this device until the sale is made.

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* private window */ } },
}

export function PosCounter() {
  const { me } = useAuth()
  const reg = useApi<Register>("/pos/register")
  if (me?.modules?.billing && me.modules.billing.tier !== "full") return <UpgradeNotice />
  if (reg.error) return <PageError error={reg.error} />
  if (!reg.data) return <PageLoading />
  if (!reg.data.shift) return <OpenShift reg={reg.data} onOpened={() => void reg.reload()} />
  return <Till key={reg.data.shift.id} reg={reg.data} shift={reg.data.shift} onShift={(s) => reg.setData({ ...reg.data!, shift: s })} />
}

function UpgradeNotice() {
  const { can } = useAuth()
  return <ModuleLocked name="POS counter" description="Counter billing with shifts, cash closing and receipts comes with a paid plan of Billing." canUpgrade={can("tenant.billing.view")} />
}

/** No shift yet: choose the counter and count the opening cash */
function OpenShift({ reg, onOpened }: { reg: Register; onOpened: () => void }) {
  const free = reg.counters.filter((c) => !c.busyBy)
  const [counterId, setCounterId] = React.useState(free[0]?.id ?? "")
  const counter = reg.counters.find((c) => c.id === counterId)
  const [cash, setCash] = React.useState<number | null>(counter ? Number(counter.floatPaise) : 0)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  if (!reg.counters.length) {
    return (
      <EmptyState icon={Store} title="No counter yet" description={reg.can.setup ? "Add a billing counter first: where its sales come from and where the money goes." : "Ask your admin to add a billing counter."}
        action={reg.can.setup ? <Link href="/app/m/pos/setup" className={buttonVariants()}><Settings2 /> Add a counter</Link> : undefined} />
    )
  }
  async function open() {
    if (!counterId) return setError("Choose the counter")
    setBusy(true)
    setError(null)
    try {
      await api.post("/pos/shifts", { counterId, openingCashPaise: cash ?? 0 })
      toast.success("Shift opened")
      onOpened()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto grid max-w-3xl gap-5 py-4">
      <div>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">Open a shift</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose your counter and count the cash in the drawer. Every bill, refund and cash move is kept on this shift until you close it.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Counter">
        {reg.counters.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={counterId === c.id} disabled={!!c.busyBy} onClick={() => { setCounterId(c.id); setCash(Number(c.floatPaise)) }}
            className={cn("flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60", counterId === c.id && "border-primary ring-2 ring-primary/20")}>
            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="size-5" /></span>
            <span className="min-w-0"><span className="block font-semibold">{c.name}</span><span className="text-xs text-muted-foreground">{c.busyBy ? `In use by ${c.busyBy}` : `Last left in drawer ${formatPaise(Number(c.floatPaise))}`}</span></span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Cash in the drawer now" hint="Count the notes and coins before you start."><MoneyInput value={cash} onChange={setCash} /></Field>
        <Button className="h-10 px-6" onClick={() => void open()} disabled={busy || !counterId}>{busy && <Loader2 className="animate-spin" />} Open shift</Button>
      </div>
      <FormError message={error} />
    </div>
  )
}

/** The counter while the shift is open */
function Till({ reg, shift, onShift }: { reg: Register; shift: ShiftSummary; onShift: (s: ShiftSummary) => void }) {
  const counterId = shift.counter.id
  const cartKey = `pos-cart:${counterId}`
  const items = useApi<{ data: PosItem[] }>(`/pos/items?counterId=${counterId}`)
  const held = useApi<{ data: HeldBill[] }>(`/pos/held?counterId=${counterId}`)
  const [cart, setCartState] = React.useState<Cart & { heldId?: string }>(() => {
    const saved = store.get(cartKey)
    try { return saved ? JSON.parse(saved) : emptyCart() } catch { return emptyCart() }
  })
  const setCart = React.useCallback((next: Cart & { heldId?: string } | ((c: Cart & { heldId?: string }) => Cart & { heldId?: string })) => {
    setCartState((c) => {
      const v = typeof next === "function" ? next(c) : next
      store.set(cartKey, v.lines.length || v.customer ? JSON.stringify(v) : null)
      return v
    })
  }, [cartKey])
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<null | "pay" | "customer" | "cash" | "held" | "return">(null)
  const [serialFor, setSerialFor] = React.useState<CartLine | null>(null)
  const [done, setDone] = React.useState<(SaleResult & { phone: string | null; shareToken: string | null }) | null>(null)
  const [paying, setPaying] = React.useState(false)
  const [payError, setPayError] = React.useState<string | null>(null)
  const [full, setFull] = React.useState(false)
  const search = React.useRef<HTMLInputElement>(null)
  const box = React.useRef<HTMLDivElement>(null)

  const all = React.useMemo(() => items.data?.data ?? [], [items.data])
  const categories = React.useMemo(() => [...new Set(all.map((i) => i.category).filter(Boolean))] as string[], [all])
  const q = query.trim().toLowerCase()
  const shown = all.filter((i) => (!category || i.category === category) && (!q || i.name.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q) || i.barcode === query.trim())).slice(0, 120)
  const rules = { pricesIncludeTax: reg.rules.pricesIncludeTax, noTax: reg.rules.noTax }
  const t = cartTotals(cart, rules)
  const limit = shift.counter.maxDiscountPct
  const overLimit = limit != null && t.gross > 0 && t.given * 100 > t.gross * limit && !reg.can.approve

  const add = React.useCallback((it: PosItem) => {
    if (it.tracking === "serial") {
      const line: CartLine = { key: `${it.id}-${Date.now()}`, itemId: it.id, name: it.name, unit: it.unit, gstRateBp: it.gstRateBp, hsnSac: it.hsnSac, listPricePaise: it.pricePaise, unitPricePaise: it.pricePaise, quantity: 0, discountPaise: 0, tracking: it.tracking, trackStock: it.trackStock, stock: it.stock, serials: [] }
      setSerialFor(cart.lines.find((l) => l.itemId === it.id) ?? line)
      return
    }
    setCart((c) => {
      const same = c.lines.find((l) => l.itemId === it.id && l.unitPricePaise === it.pricePaise && !l.discountPaise)
      if (same) return { ...c, lines: c.lines.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l)) }
      return { ...c, lines: [...c.lines, { key: `${it.id}-${Date.now()}`, itemId: it.id, name: it.name, unit: it.unit, gstRateBp: it.gstRateBp, hsnSac: it.hsnSac, listPricePaise: it.pricePaise, unitPricePaise: it.pricePaise, quantity: 1, discountPaise: 0, tracking: it.tracking, trackStock: it.trackStock, stock: it.stock, serials: [] }] }
    })
  }, [cart.lines, setCart])

  /** Enter in the search box: an exact barcode or code adds it; one match adds it */
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return
    e.preventDefault()
    const code = query.trim()
    if (!code) return
    const exact = all.find((i) => i.barcode === code) ?? all.find((i) => i.sku?.toLowerCase() === code.toLowerCase())
    const hit = exact ?? (shown.length === 1 ? shown[0] : null)
    if (hit) { add(hit); setQuery("") }
    else toast.error(shown.length ? "More than one item matches. Tap the one you want." : `No item with code ${code}`)
  }

  const update = (key: string, patch: Partial<CartLine>) => setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
  const remove = (key: string) => setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== key) }))
  const clear = () => { setCart(emptyCart()); setEditing(null) }

  const hold = React.useCallback(async () => {
    if (!cart.lines.length) return
    const label = cart.customer?.name && cart.customer.name !== "Walk-in customer" ? cart.customer.name : `Bill at ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`
    try {
      await api.post("/pos/held", { counterId, label: label.slice(0, 60), cart: { ...cart, heldId: undefined }, totalPaise: cartTotals(cart, rules).payable, lines: cart.lines.length })
      if (cart.heldId) await api.delete(`/pos/held/${cart.heldId}`).catch(() => undefined)
      toast.success(`Put on hold: ${label}`)
      clear()
      void held.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }, [cart, counterId, held]) // eslint-disable-line react-hooks/exhaustive-deps

  const pay = React.useCallback(() => {
    if (!cart.lines.length) return toast.error("Add an item first")
    if (shift.counter.needCustomer && (!cart.customer || !cart.customer.phone)) { toast.error("This counter needs the customer's name and phone"); return setDialog("customer") }
    if (cart.lines.some((l) => l.tracking === "serial" && l.serials.length !== l.quantity)) return toast.error("Choose the serial numbers for each piece")
    setPayError(null)
    setDialog("pay")
  }, [cart, shift.counter.needCustomer])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || done || serialFor) return
      if (e.key === "F2") { e.preventDefault(); search.current?.focus() }
      else if (e.key === "F4") { e.preventDefault(); setDialog("customer") }
      else if (e.key === "F8") { e.preventDefault(); void hold() }
      else if (e.key === "F9" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); pay() }
      // A scanner typing while nothing is focused still lands in the search box
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement) && !(document.activeElement instanceof HTMLSelectElement)) search.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dialog, done, serialFor, hold, pay])

  React.useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])
  const toggleFull = () => (document.fullscreenElement ? void document.exitFullscreen() : void box.current?.requestFullscreen?.().catch(() => undefined))

  async function finish(tenders: { method: Tender; amountPaise: number; reference: string | null }[]) {
    setPaying(true)
    setPayError(null)
    try {
      const r = await api.post<SaleResult & { shareToken: string | null }>("/pos/sales", {
        shiftId: shift.id, contactId: cart.customer?.id ?? null, customer: cart.customer && !cart.customer.id ? { name: cart.customer.name, phone: cart.customer.phone } : null,
        lines: cart.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPricePaise: l.unitPricePaise, discountPaise: l.discountPaise, serials: l.serials.length ? l.serials : undefined })),
        billDiscountPaise: cart.billDiscountPaise, tenders, notes: cart.notes || null, heldId: cart.heldId ?? null,
      })
      setDone({ ...r, phone: cart.customer?.phone ?? null })
      setDialog(null)
      clear()
      void items.reload()
      if (cart.heldId) void held.reload()
      void api.get<ShiftSummary>(`/pos/shifts/${shift.id}`).then(onShift).catch(() => undefined)
    } catch (e) {
      setPayError(e instanceof ApiError && e.details?.discountLimit ? `${e.message}` : errorMessage(e))
    } finally {
      setPaying(false)
    }
  }
  const printReceipt = (id: string) => window.open(`/print/pos/${id}?auto=1`, "pos-receipt", "width=420,height=720")

  return (
    <div ref={box} className={cn("grid gap-3 bg-background", full && "h-svh overflow-hidden p-3")}>
      {/* Shift bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-3 py-2">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="size-4" /></span>
        <span className="mr-auto min-w-0">
          <span className="block font-semibold leading-tight">{shift.counter.name}</span>
          <span className="text-xs text-muted-foreground">{shift.number} · {shift.openedByName} · since {formatDateTime(shift.openedAt)} · {shift.totals.bills} bills · {formatPaise(shift.totals.salesPaise)}</span>
        </span>
        <Button variant="outline" size="sm" onClick={() => setDialog("held")}><PauseCircle /> On hold{held.data?.data.length ? ` (${held.data.data.length})` : ""}</Button>
        <Button variant="outline" size="sm" onClick={() => setDialog("cash")}><Banknote /> Cash in/out</Button>
        {reg.can.refund && <Button variant="outline" size="sm" onClick={() => setDialog("return")}><Undo2 /> Return</Button>}
        <Link href={`/app/m/pos/shifts/${shift.id}?close=1`} className={buttonVariants({ variant: "outline", size: "sm" })}><Lock /> Close shift</Link>
        <Button variant="ghost" size="icon-sm" onClick={toggleFull} title={full ? "Leave full screen" : "Full screen"} aria-label={full ? "Leave full screen" : "Full screen"}>{full ? <Shrink /> : <Expand />}</Button>
      </div>

      <div className={cn("grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px]", full ? "min-h-0 flex-1" : "lg:h-[calc(100svh-11rem)]")}>
        {/* Items */}
        <section className="flex min-h-0 flex-col gap-3 rounded-2xl border bg-card p-3">
          <div className="relative">
            <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input ref={search} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder="Scan a barcode, or type a name or code (F2)" className="h-11 pl-10 text-base" aria-label="Scan or search items" />
            {query && <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" aria-label="Clear search"><X className="size-4" /></button>}
          </div>
          {categories.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Categories">
              {[null, ...categories].map((c) => <button key={c ?? "all"} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)} className={cn("shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap", category === c ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary")}>{c ?? "All"}</button>)}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.loading && !items.data ? <p className="p-6 text-center text-sm text-muted-foreground">Loading items…</p> : !shown.length ? (
              <div className="grid place-items-center gap-2 p-10 text-center text-sm text-muted-foreground"><Search className="size-8" />{all.length ? "No item matches." : "No items yet. Add products in Products & Services."}</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((it) => {
                  const out = it.trackStock && it.stock <= 0
                  return (
                    <button key={it.id} type="button" onClick={() => add(it)} className="group flex flex-col overflow-hidden rounded-xl border text-left transition-colors hover:border-primary">
                      <span className="relative grid aspect-[4/3] place-items-center bg-muted/50">
                        <FileImg value={it.imageUrl} className="size-full object-cover" fallback={<Package className="size-7 text-muted-foreground/60" />} />
                        {it.trackStock && <span className={cn("absolute top-1.5 right-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", out ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" : it.stock < 5 ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" : "bg-white/90 text-neutral-700")}>{out ? "Out" : `${Number(it.stock.toFixed(2))} ${it.unit}`}</span>}
                      </span>
                      <span className="grid gap-0.5 p-2">
                        <span className="line-clamp-2 text-sm leading-snug font-medium">{it.name}</span>
                        <span className="text-sm font-semibold text-primary tabular-nums">{formatPaise(it.pricePaise)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Bill */}
        <section className="flex min-h-0 flex-col rounded-2xl border bg-card">
          <button type="button" onClick={() => setDialog("customer")} className="flex items-center gap-3 border-b px-4 py-3 text-left hover:bg-muted/40">
            <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary"><User className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{cart.customer?.name ?? "Walk-in customer"}</span><span className="text-xs text-muted-foreground">{cart.customer?.phone ?? (shift.counter.needCustomer ? "Name and phone needed (F4)" : "Tap to add a customer (F4)")}</span></span>
            {cart.customer?.id && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">Customer</span>}
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!cart.lines.length ? (
              <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground"><span><ScanBarcode className="mx-auto mb-2 size-9" />Scan or tap items to start the bill.</span></div>
            ) : (
              <ul className="divide-y">
                {cart.lines.map((l) => {
                  const lineTotal = Math.round(l.quantity * l.unitPricePaise) - l.discountPaise
                  const short = l.trackStock && l.quantity > l.stock
                  return (
                    <li key={l.key} className="grid gap-2 px-4 py-2.5">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm leading-snug font-medium">{l.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{formatPaise(l.unitPricePaise)} / {l.unit}{l.discountPaise > 0 && ` · ${formatPaise(l.discountPaise)} off`}{l.unitPricePaise < l.listPricePaise && " · price changed"}</span>
                          {short && <span className="block text-xs text-amber-700 dark:text-amber-400">Only {Number(l.stock.toFixed(2))} in stock here</span>}
                          {l.tracking === "serial" && <button type="button" onClick={() => setSerialFor(l)} className="block text-xs font-medium text-primary hover:underline">{l.serials.length ? `Serials: ${l.serials.join(", ")}` : "Choose serial numbers"}</button>}
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{formatPaise(lineTotal)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {l.tracking === "serial" ? <span className="text-sm text-muted-foreground">{l.quantity} {l.unit}</span> : <NumberStepper size="sm" className="w-32" value={String(l.quantity)} min={0.001} decimals={!["pcs", "nos", "box", "pack"].includes(l.unit)} onChange={(v) => update(l.key, { quantity: Number(v) || 0 })} aria-label={`Quantity of ${l.name}`} />}
                        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setEditing(editing === l.key ? null : l.key)} aria-label={`Change price or discount of ${l.name}`}><Pencil /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => remove(l.key)} aria-label={`Remove ${l.name}`}><Trash2 /></Button>
                      </div>
                      {editing === l.key && (
                        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-2">
                          <Field label="Price"><MoneyInput value={l.unitPricePaise} onChange={(v) => update(l.key, { unitPricePaise: v ?? 0 })} /></Field>
                          <Field label="Discount on line"><MoneyInput value={l.discountPaise} onChange={(v) => update(l.key, { discountPaise: Math.min(v ?? 0, Math.round(l.quantity * l.unitPricePaise)) })} /></Field>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="grid gap-2 border-t p-4">
            <div className="grid gap-1 text-sm">
              <p className="flex justify-between text-muted-foreground"><span>{t.items ? `${Number(t.items.toFixed(3))} item${t.items === 1 ? "" : "s"}` : "Items"}</span><span className="tabular-nums">{formatPaise(t.sumNet)}</span></p>
              <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Bill discount</span><MoneyInput className="w-32" value={cart.billDiscountPaise} onChange={(v) => setCart((c) => ({ ...c, billDiscountPaise: Math.max(0, v ?? 0) }))} aria-label="Bill discount" /></div>
              {!reg.rules.noTax && <p className="flex justify-between text-muted-foreground"><span>GST {reg.rules.pricesIncludeTax ? "(included)" : ""}</span><span className="tabular-nums">{formatPaise(t.tax)}</span></p>}
              {t.roundOff !== 0 && <p className="flex justify-between text-muted-foreground"><span>Round off</span><span className="tabular-nums">{formatPaise(t.roundOff)}</span></p>}
              {t.given > 0 && <p className={cn("flex justify-between text-xs", overLimit ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}><span>You save{limit != null ? ` (limit ${limit}%)` : ""}</span><span className="tabular-nums">{formatPaise(t.given)}</span></p>}
            </div>
            <p className="flex items-baseline justify-between"><span className="font-semibold">To pay</span><span className="text-3xl font-bold tabular-nums">{formatPaise(t.payable)}</span></p>
            {overLimit && <p className="text-xs text-destructive">More than this counter&apos;s {limit}% discount. A manager has to finish this bill.</p>}
            <div className="grid grid-cols-[auto_auto_1fr] gap-2">
              <Button variant="outline" onClick={() => void hold()} disabled={!cart.lines.length} title="Hold (F8)"><PauseCircle /> Hold</Button>
              <Button variant="outline" onClick={clear} disabled={!cart.lines.length && !cart.customer} title="Clear the bill"><X /> Clear</Button>
              <Button className="h-11 text-base" onClick={pay} disabled={!cart.lines.length || overLimit || t.payable < 0}><ArrowLeftRight /> Pay {formatPaise(t.payable)} (F9)</Button>
            </div>
          </div>
        </section>
      </div>

      {dialog === "pay" && <PayDialog payable={t.payable} customer={cart.customer} allowCredit={shift.counter.allowCredit} upiId={reg.rules.upiId} business={reg.rules.business} busy={paying} error={payError} onPay={(x) => void finish(x)} onClose={() => setDialog(null)} />}
      {dialog === "customer" && <CustomerDialog current={cart.customer} need={shift.counter.needCustomer} onPick={(c) => { setCart((x) => ({ ...x, customer: c })); setDialog(null) }} onClose={() => setDialog(null)} />}
      {dialog === "cash" && <CashMoveDialog shift={shift} rules={reg.rules} financeOn={reg.financeOn} onDone={(s) => { onShift(s); setDialog(null) }} onClose={() => setDialog(null)} />}
      {dialog === "held" && (
        <HeldDialog rows={held.data?.data ?? []} onClose={() => setDialog(null)}
          onResume={(h) => {
            if (cart.lines.length) return toast.error("Hold or clear the bill you are on first")
            setCart({ ...emptyCart(), ...(h.cart as Cart), heldId: h.id })
            setDialog(null)
          }}
          onDrop={async (h) => { try { await api.delete(`/pos/held/${h.id}`); void held.reload() } catch (e) { toast.error(errorMessage(e)) } }}
        />
      )}
      {dialog === "return" && <ReturnDialog shiftId={shift.id} onClose={() => setDialog(null)} onDone={(msg) => { toast.success(msg, { duration: 8000 }); setDialog(null); void items.reload(); void api.get<ShiftSummary>(`/pos/shifts/${shift.id}`).then(onShift).catch(() => undefined) }} />}
      {serialFor && (
        <SerialDialog itemName={serialFor.name} itemId={serialFor.itemId} counterId={counterId} initial={serialFor.serials} onClose={() => setSerialFor(null)}
          onDone={(serials) => {
            setCart((c) => c.lines.some((l) => l.key === serialFor.key) ? { ...c, lines: c.lines.map((l) => (l.key === serialFor.key ? { ...l, serials, quantity: serials.length } : l)) } : { ...c, lines: [...c.lines, { ...serialFor, serials, quantity: serials.length }] })
            setSerialFor(null)
          }} />
      )}
      {done && <DoneDialog sale={done} phone={done.phone} shareToken={done.shareToken} onPrint={() => printReceipt(done.id)} onNext={() => { setDone(null); setTimeout(() => search.current?.focus(), 50) }} />}
    </div>
  )
}
