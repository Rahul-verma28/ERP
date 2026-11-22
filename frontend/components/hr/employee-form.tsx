"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Briefcase, ChevronLeft, ChevronRight, IdCard, IndianRupee, Landmark, UserRound } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell"
import { MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { FormSection } from "@/components/contact-dialog"
import { SearchSelect } from "@/components/search-select"
import { Stepper } from "@/components/stepper"
import { Avatar, Pill } from "@/components/page-parts"
import { DepartmentSelect, DesignationSelect, EmployeeSelect, ShiftSelect } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { EMPLOYMENT_LABEL, useHrLookups, type Employee, type EmploymentType } from "@/lib/hr"
import { useChanged } from "@/lib/use-dirty"
import { activeOr } from "@/lib/active"
import { AvatarField } from "@/components/file-field"

// Add or edit an employee in four short steps, with a live card on the side.

const STEPS = [
  { key: "personal", label: "Personal", icon: UserRound },
  { key: "job", label: "Job", icon: Briefcase },
  { key: "contact", label: "Contact & bank", icon: Landmark },
  { key: "pay", label: "Pay & IDs", icon: IndianRupee },
]
const STEP_FIELDS: Record<string, string[]> = {
  personal: ["photoUrl", "name", "phone", "email", "gender", "dob"],
  job: ["employmentType", "joinedOn", "probationEndsOn", "branchId", "departmentId", "designationId", "managerId", "shiftId", "memberId"],
  contact: ["address.line1", "address.line2", "address.country", "address.city", "address.state", "address.pincode", "emergency.name", "emergency.relation", "emergency.phone", "bank.holder", "bank.bankName", "bank.branch", "bank.accountNo", "bank.ifsc"],
  pay: ["payType", "basicPaise", "pf", "esi", "pt", "pan", "aadhaarLast4", "uan", "esiNo", "notes"],
}

const blank = (e?: Employee | null) => ({
  photoUrl: e?.photoUrl ?? "", name: e?.name ?? "", phone: e?.phone ?? "", email: e?.email ?? "", gender: e?.gender ?? "", dob: e?.dob?.slice(0, 10) ?? "",
  employmentType: (e?.employmentType ?? "full_time") as EmploymentType, joinedOn: e?.joinedOn.slice(0, 10) ?? todayInIndia(), probationEndsOn: e?.probationEndsOn?.slice(0, 10) ?? "",
  branchId: e?.branchId ?? "", departmentId: e?.departmentId ?? "", designationId: e?.designationId ?? "", managerId: e?.managerId ?? "", shiftId: e?.shiftId ?? "", memberId: e?.memberId ?? "",
  line1: e?.address?.line1 ?? "", line2: e?.address?.line2 ?? "", country: e?.address?.country ?? "India", city: e?.address?.city ?? "", state: e?.address?.state ?? "", pincode: e?.address?.pincode ?? "",
  emName: e?.emergency?.name ?? "", emRelation: e?.emergency?.relation ?? "", emPhone: e?.emergency?.phone ?? "",
  holder: e?.bank?.holder ?? "", bankName: e?.bank?.bankName ?? "", bankBranch: e?.bank?.branch ?? "", accountNo: e?.bank?.accountNo ?? "", ifsc: e?.bank?.ifsc ?? "",
  payType: e?.payType ?? "monthly", basicPaise: e ? e.basicPaise || null : (null as number | null), pf: e?.pf ?? false, esi: e?.esi ?? false, pt: e?.pt ?? false,
  pan: e?.pan ?? "", aadhaarLast4: e?.aadhaarLast4 ?? "", uan: e?.uan ?? "", esiNo: e?.esiNo ?? "", notes: e?.notes ?? "",
})
type Form = ReturnType<typeof blank>

export function EmployeeForm({ employee }: { employee?: Employee | null }) {
  const router = useRouter()
  const { can } = useAuth()
  const look = useHrLookups()
  const branches = useSharedApi<{ data: { id: string; name: string }[] }>("/branches")
  const members = useSharedApi<{ members: { id: string; status: string; user: { name: string; email: string; mobile: string } }[] }>(can("tenant.member.view") ? "/members" : null)
  const [f, setF] = React.useState<Form>(() => blank(employee))
  const unchanged = !useChanged(f)
  const [step, setStep] = React.useState(0)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (Object.keys(e).length ? {} : e)); setError(null) }
  const canPay = can("hr.payroll.view") || !employee
  const today = todayInIndia()

  const problems = (key: string) => {
    const p: Record<string, string> = {}
    if (key === "personal") {
      if (f.name.trim().length < 2) p.name = "Enter the full name"
      if (f.phone && !/^[6-9]\d{9}$/.test(f.phone)) p.phone = "Enter a 10-digit mobile number"
      if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) p.email = "Enter a valid email"
      if (f.dob && f.dob > today) p.dob = "Can't be in the future"
    }
    if (key === "job") {
      if (!f.joinedOn) p.joinedOn = "Choose the joining date"
      if (f.dob && f.joinedOn && f.dob > f.joinedOn) p.joinedOn = "Must be after the date of birth"
      if (f.probationEndsOn && f.probationEndsOn < f.joinedOn) p.probationEndsOn = "Must be after joining"
    }
    if (key === "contact") {
      if (f.pincode && !/^\d{6}$/.test(f.pincode)) p["address.pincode"] = "Pincode has 6 digits"
      if (f.emPhone && !/^[6-9]\d{9}$/.test(f.emPhone)) p["emergency.phone"] = "Enter a 10-digit mobile number"
      if (f.accountNo && !/^\d{9,18}$/.test(f.accountNo)) p["bank.accountNo"] = "9 to 18 digits"
      if (f.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc)) p["bank.ifsc"] = "IFSC looks like SBIN0001234"
      if (f.accountNo && !f.ifsc) p["bank.ifsc"] = "Enter the IFSC for this account"
    }
    if (key === "pay") {
      if (f.pf && !f.basicPaise) p.basicPaise = "Enter basic pay to deduct PF"
      if (f.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(f.pan)) p.pan = "PAN looks like ABCDE1234F"
      if (f.aadhaarLast4 && !/^\d{4}$/.test(f.aadhaarLast4)) p.aadhaarLast4 = "Last 4 digits only"
      if (f.uan && !/^\d{12}$/.test(f.uan)) p.uan = "UAN has 12 digits"
      if (f.esiNo && !/^\d{10,17}$/.test(f.esiNo)) p.esiNo = "10 to 17 digits"
      if (f.pf && !f.uan) p.uan = "Enter the UAN for PF"
    }
    return p
  }
  const at = Math.min(step, STEPS.length - 1)
  const last = at === STEPS.length - 1
  const next = () => {
    const p = problems(STEPS[at].key)
    setErrors(p)
    if (!Object.keys(p).length) setStep(at + 1)
  }

  async function save() {
    for (const [i, s] of STEPS.entries()) {
      const p = problems(s.key)
      if (Object.keys(p).length) { setErrors(p); return setStep(i) }
    }
    setBusy(true)
    const n = (v: string) => v.trim() || null
    const body = {
      photoUrl: f.photoUrl || null, name: f.name.trim(), phone: n(f.phone), email: n(f.email), gender: n(f.gender), dob: n(f.dob),
      employmentType: f.employmentType, joinedOn: f.joinedOn, probationEndsOn: n(f.probationEndsOn),
      branchId: n(f.branchId), departmentId: n(f.departmentId), designationId: n(f.designationId), managerId: n(f.managerId), shiftId: n(f.shiftId), memberId: n(f.memberId),
      address: { line1: n(f.line1), line2: n(f.line2), country: n(f.country), city: n(f.city), state: n(f.state), pincode: n(f.pincode) },
      emergency: { name: n(f.emName), relation: n(f.emRelation), phone: n(f.emPhone) },
      bank: { holder: n(f.holder), bankName: n(f.bankName), branch: n(f.bankBranch), accountNo: n(f.accountNo), ifsc: n(f.ifsc) },
      payType: f.payType, basicPaise: f.basicPaise ?? 0, pf: f.pf, esi: f.esi, pt: f.pt,
      pan: n(f.pan), aadhaarLast4: n(f.aadhaarLast4), uan: n(f.uan), esiNo: n(f.esiNo), notes: n(f.notes),
    }
    try {
      const saved = employee ? await api.put<Employee>(`/hr/employees/${employee.id}`, { ...body, version: employee.version }) : await api.post<Employee>("/hr/employees", body)
      toast.success(employee ? "Employee saved" : `${saved.name} added as ${saved.code}`)
      router.push(`/app/m/hr/employees/${saved.id}`)
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields)
        const i = STEPS.findIndex((s) => Object.keys(e.fields).some((k) => STEP_FIELDS[s.key].includes(k)))
        if (i >= 0) setStep(i)
      }
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const dept = look.data?.departments.find((d) => d.id === f.departmentId)?.name
  const desig = look.data?.designations.find((d) => d.id === f.designationId)?.name
  const linked = (members.data?.members ?? []).filter((m) => m.status !== "deactivated")

  return (
    <>
      <PageHeader title={employee ? `Edit ${employee.name}` : "Add employee"} description="Personal details, job, bank and pay. Only the name and joining date are needed to start." actions={<Link href={employee ? `/app/m/hr/employees/${employee.id}` : "/app/m/hr/employees"} className={buttonVariants({ variant: "outline" })}><ArrowLeft /> Back</Link>} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="ui-surface grid gap-5 p-5 sm:p-6">
          <Stepper steps={STEPS} at={at} open={(i) => !!employee || i <= at} onPick={setStep} />

          {STEPS[at].key === "personal" && (
            <FormSection icon={UserRound} title="Who they are">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Photo" error={errors.photoUrl} className="sm:col-span-2" hint="Optional: shows on their profile and ID card"><AvatarField value={f.photoUrl} onChange={(v) => set("photoUrl", v ?? "")} name={f.name} /></Field>
                <Field label="Full name" required error={errors.name} className="sm:col-span-2"><Input value={f.name} autoFocus maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="As on their ID, e.g. Asha Verma" /></Field>
                <Field label="Mobile" error={errors.phone} hint="Used to find them and for WhatsApp payslips"><Input value={f.phone} inputMode="numeric" maxLength={10} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} placeholder="10-digit mobile" /></Field>
                <Field label="Email" error={errors.email}><Input type="email" value={f.email} maxLength={160} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" /></Field>
                <Field label="Gender" error={errors.gender}><NativeSelect value={f.gender} aria-label="Gender" onChange={(e) => set("gender", e.target.value)}><option value="">Not given</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></NativeSelect></Field>
                <Field label="Date of birth" error={errors.dob} hint="Shows on the HR dashboard on their birthday"><Input type="date" value={f.dob} max={today} onChange={(e) => set("dob", e.target.value)} /></Field>
              </div>
            </FormSection>
          )}

          {STEPS[at].key === "job" && (
            <FormSection icon={Briefcase} title="Their job">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Employment type" required><NativeSelect value={f.employmentType} aria-label="Employment type" onChange={(e) => set("employmentType", e.target.value as EmploymentType)}>{(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((k) => <option key={k} value={k}>{EMPLOYMENT_LABEL[k]}</option>)}</NativeSelect></Field>
                <Field label="Joining date" required error={errors.joinedOn}><Input type="date" value={f.joinedOn} onChange={(e) => set("joinedOn", e.target.value)} /></Field>
                <Field label="Department" error={errors.departmentId}><DepartmentSelect value={f.departmentId} onChange={(v) => set("departmentId", v)} aria-label="Department" /></Field>
                <Field label="Designation" error={errors.designationId}><DesignationSelect value={f.designationId} departmentId={f.departmentId} onChange={(v) => set("designationId", v)} aria-label="Designation" /></Field>
                <Field label="Reports to" error={errors.managerId}><EmployeeSelect value={f.managerId} exclude={employee?.id} onChange={(v) => set("managerId", v)} placeholder="Their manager (optional)" aria-label="Reports to" /></Field>
                <Field label="Shift" error={errors.shiftId} hint="Leave empty for the default shift"><ShiftSelect value={f.shiftId} onChange={(v) => set("shiftId", v)} aria-label="Shift" /></Field>
                {(branches.data?.data.length ?? 0) > 1 && <Field label="Branch" error={errors.branchId}><SearchSelect value={f.branchId} onChange={(v) => set("branchId", v)} options={[{ value: "", label: "No branch" }, ...activeOr(branches.data?.data ?? [], f.branchId).map((b) => ({ value: b.id, label: b.name }))]} aria-label="Branch" /></Field>}
                <Field label="Probation ends" error={errors.probationEndsOn}><Input type="date" value={f.probationEndsOn} min={f.joinedOn} onChange={(e) => set("probationEndsOn", e.target.value)} /></Field>
                {can("tenant.member.view") && (
                  <Field label="Their login" error={errors.memberId} hint="Link a user so they can clock in, apply leave and see payslips" className="sm:col-span-2">
                    <SearchSelect value={f.memberId} onChange={(v) => set("memberId", v)} searchable options={[{ value: "", label: "No login" }, ...linked.map((m) => ({ value: m.id, label: `${m.user.name} · ${m.user.mobile || m.user.email}` }))]} aria-label="Their login" />
                  </Field>
                )}
              </div>
            </FormSection>
          )}

          {STEPS[at].key === "contact" && (
            <div className="grid gap-5">
              <FormSection icon={UserRound} title="Address">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Address line 1" className="sm:col-span-2" error={errors["address.line1"]}><Input value={f.line1} maxLength={200} onChange={(e) => set("line1", e.target.value)} placeholder="House no., street" /></Field>
                  <Field label="Address line 2" className="sm:col-span-2"><Input value={f.line2} maxLength={200} onChange={(e) => set("line2", e.target.value)} placeholder="Area, landmark" /></Field>
                  <Field label="City" error={errors["address.city"]}><Input value={f.city} maxLength={80} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Lucknow" /></Field>
                  <Field label="State" error={errors["address.state"]}><Input value={f.state} maxLength={80} onChange={(e) => set("state", e.target.value)} placeholder="e.g. Uttar Pradesh" /></Field>
                  <Field label="Country"><Input value={f.country} maxLength={60} onChange={(e) => set("country", e.target.value)} placeholder="India" /></Field>
                  <Field label="Pincode" error={errors["address.pincode"]}><Input value={f.pincode} inputMode="numeric" maxLength={6} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, ""))} placeholder="6 digits" /></Field>
                </div>
              </FormSection>
              <FormSection icon={UserRound} title="In an emergency, call">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Name" error={errors["emergency.name"]}><Input value={f.emName} maxLength={120} onChange={(e) => set("emName", e.target.value)} placeholder="e.g. Ramesh Verma" /></Field>
                  <Field label="Relation" error={errors["emergency.relation"]}><Input value={f.emRelation} maxLength={40} onChange={(e) => set("emRelation", e.target.value)} placeholder="e.g. Father" /></Field>
                  <Field label="Mobile" error={errors["emergency.phone"]}><Input value={f.emPhone} inputMode="numeric" maxLength={10} onChange={(e) => set("emPhone", e.target.value.replace(/\D/g, ""))} placeholder="10-digit mobile" /></Field>
                </div>
              </FormSection>
              <FormSection icon={Landmark} title="Bank account for salary" hint="Printed on the payslip so salaries go to the right account">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Account holder" error={errors["bank.holder"]}><Input value={f.holder} maxLength={120} onChange={(e) => set("holder", e.target.value)} placeholder={f.name || "As in the bank"} /></Field>
                  <Field label="Bank" error={errors["bank.bankName"]}><Input value={f.bankName} maxLength={80} onChange={(e) => set("bankName", e.target.value)} placeholder="e.g. State Bank of India" /></Field>
                  <Field label="Account number" error={errors["bank.accountNo"]}><Input value={f.accountNo} inputMode="numeric" maxLength={18} onChange={(e) => set("accountNo", e.target.value.replace(/\D/g, ""))} placeholder="9 to 18 digits" /></Field>
                  <Field label="Bank branch"><Input value={f.bankBranch} maxLength={80} onChange={(e) => set("bankBranch", e.target.value)} placeholder="e.g. Hazratganj" /></Field>
                  <Field label="IFSC" error={errors["bank.ifsc"]}><Input value={f.ifsc} maxLength={11} onChange={(e) => set("ifsc", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="e.g. SBIN0001234" className="font-mono uppercase" /></Field>
                </div>
              </FormSection>
            </div>
          )}

          {STEPS[at].key === "pay" && (
            <div className="grid gap-5">
              {canPay && (
                <FormSection icon={IndianRupee} title="Pay" hint="Allowances and deductions can be added on their profile under Salary">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Paid"><NativeSelect value={f.payType} aria-label="Paid" onChange={(e) => set("payType", e.target.value as "monthly" | "daily")}><option value="monthly">Monthly salary</option><option value="daily">Daily wage</option></NativeSelect></Field>
                    <Field label={f.payType === "daily" ? "Wage a day" : "Basic pay a month"} error={errors.basicPaise} hint="Can be set later"><MoneyInput value={f.basicPaise} onChange={(v) => set("basicPaise", v)} aria-label="Basic pay" /></Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {([["pf", "PF"], ["esi", "ESI"], ["pt", "Professional tax"]] as const).map(([k, label]) => (
                      <label key={k} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"><span className="font-medium">Deduct {label}</span><Switch checked={f[k]} onCheckedChange={(v) => set(k, v)} aria-label={`Deduct ${label}`} /></label>
                    ))}
                  </div>
                </FormSection>
              )}
              <FormSection icon={IdCard} title="IDs" hint="For PF, ESI and tax filings">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="PAN" error={errors.pan}><Input value={f.pan} maxLength={10} onChange={(e) => set("pan", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ABCDE1234F" className="font-mono uppercase" /></Field>
                  <Field label="Aadhaar (last 4 digits)" error={errors.aadhaarLast4} hint="Only the last 4 are kept"><Input value={f.aadhaarLast4} inputMode="numeric" maxLength={4} onChange={(e) => set("aadhaarLast4", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 4821" /></Field>
                  <Field label="UAN (PF)" error={errors.uan} required={f.pf}><Input value={f.uan} inputMode="numeric" maxLength={12} onChange={(e) => set("uan", e.target.value.replace(/\D/g, ""))} placeholder="12 digits" /></Field>
                  <Field label="ESI number" error={errors.esiNo}><Input value={f.esiNo} inputMode="numeric" maxLength={17} onChange={(e) => set("esiNo", e.target.value.replace(/\D/g, ""))} placeholder="10 to 17 digits" /></Field>
                  <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} rows={2} maxLength={1000} onChange={(e) => set("notes", e.target.value)} placeholder="Anything HR should remember" /></Field>
                </div>
              </FormSection>
            </div>
          )}

          <FormError message={error} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-5">
            {at > 0 ? <Button type="button" variant="outline" onClick={() => setStep(at - 1)}><ChevronLeft /> Previous</Button> : <span />}
            <div className="flex gap-2">
              {employee && !last && <Button type="button" variant="outline" disabled={busy || unchanged} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>}
              {!last ? <Button type="button" onClick={next}>Next <ChevronRight /></Button> : <Button type="button" disabled={busy || (!!employee && unchanged)} onClick={save}>{busy ? "Saving…" : employee ? "Save changes" : "Add employee"}</Button>}
            </div>
          </div>
        </section>

        <aside className="ui-surface grid gap-4 p-5 xl:sticky xl:top-4">
          <div className="flex items-center gap-3">
            <Avatar name={f.name || "New employee"} className="size-12 text-sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{f.name || "New employee"}</p>
              <p className="truncate text-sm text-muted-foreground">{[desig, dept].filter(Boolean).join(" · ") || "Designation and department"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5"><Pill color="blue">{EMPLOYMENT_LABEL[f.employmentType]}</Pill>{employee && <Pill color="slate">{employee.code}</Pill>}</div>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Joins</dt><dd>{f.joinedOn ? formatDate(f.joinedOn) : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Mobile</dt><dd>{f.phone || "—"}</dd></div>
            {canPay && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{f.payType === "daily" ? "Daily wage" : "Basic pay"}</dt><dd className="tabular-nums">{f.basicPaise ? formatPaise(f.basicPaise) : "—"}</dd></div>}
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Bank</dt><dd className="truncate">{f.accountNo ? `${f.bankName || "Account"} •••• ${f.accountNo.slice(-4)}` : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Deducts</dt><dd>{[f.pf && "PF", f.esi && "ESI", f.pt && "PT"].filter(Boolean).join(", ") || "None"}</dd></div>
          </dl>
          {!employee && <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">The employee ID (like EMP-0001) is given when you save.</p>}
        </aside>
      </div>
    </>
  )
}
