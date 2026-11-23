-- AHEAD ERP baseline: the whole schema in one migration (tables, indexes, row-level security
-- policies, the app_user role and its grants, functions). It replaces the 57 step-by-step
-- migrations from Oct–Dec 2026; a database built from those is the same, and is marked as
-- having this one (prisma/migrate.ts). New changes go in new migrations after this one.

-- Tenant work runs as app_user (no BYPASSRLS), so the policies below always apply
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT app_user TO CURRENT_USER;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';

CREATE TYPE public.access_link_kind AS ENUM (
    'client_owner',
    'console_member'
);

CREATE TYPE public.acquired_by_type AS ENUM (
    'self',
    'vendor',
    'sales_user',
    'partner_user'
);

CREATE TYPE public.acquisition_method AS ENUM (
    'signup',
    'referral_link',
    'referral_code',
    'manual'
);

CREATE TYPE public.activity_type AS ENUM (
    'note',
    'call',
    'meeting',
    'follow_up',
    'task',
    'email'
);

CREATE TYPE public.appointment_kind AS ENUM (
    'appointment',
    'event'
);

CREATE TYPE public.appointment_status AS ENUM (
    'scheduled',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
);

CREATE TYPE public.billing_cycle AS ENUM (
    'monthly',
    'yearly',
    'one_time'
);

CREATE TYPE public.billing_owner AS ENUM (
    'self',
    'partner'
);

CREATE TYPE public.contact_type AS ENUM (
    'lead',
    'customer',
    'supplier'
);

CREATE TYPE public.coupon_type AS ENUM (
    'percent',
    'flat'
);

CREATE TYPE public.entitlement_status AS ENUM (
    'active',
    'read_only',
    'inactive'
);

CREATE TYPE public.extension_kind AS ENUM (
    'trial',
    'grace'
);

CREATE TYPE public.field_access AS ENUM (
    'hidden',
    'read',
    'write'
);

CREATE TYPE public.field_type AS ENUM (
    'text',
    'number',
    'date',
    'dropdown',
    'multi_select',
    'checkbox',
    'attachment',
    'relation'
);

CREATE TYPE public.item_type AS ENUM (
    'product',
    'service'
);

CREATE TYPE public.lead_status AS ENUM (
    'new',
    'contacted',
    'qualified',
    'lost',
    'converted'
);

CREATE TYPE public.member_status AS ENUM (
    'invited',
    'active',
    'deactivated'
);

CREATE TYPE public.onboarding_type AS ENUM (
    'trial',
    'direct_paid'
);

CREATE TYPE public.otp_channel AS ENUM (
    'sms',
    'whatsapp',
    'email'
);

CREATE TYPE public.otp_purpose AS ENUM (
    'signup',
    'login',
    'reset',
    'vendor_signup',
    'mfa',
    'invite',
    'email_change',
    'mobile_change',
    'close_account',
    'portal'
);

CREATE TYPE public.payment_method AS ENUM (
    'cash',
    'upi',
    'card',
    'bank',
    'cheque',
    'other'
);

CREATE TYPE public.permission_action AS ENUM (
    'view',
    'create',
    'edit',
    'delete',
    'approve',
    'export'
);

CREATE TYPE public.permission_scope AS ENUM (
    'own',
    'team',
    'branch',
    'all'
);

CREATE TYPE public.platform_order_status AS ENUM (
    'pending_approval',
    'awaiting_payment',
    'paid',
    'cancelled'
);

CREATE TYPE public.platform_payment_method AS ENUM (
    'bank_transfer',
    'upi',
    'cheque',
    'cash',
    'razorpay'
);

CREATE TYPE public.price_item_type AS ENUM (
    'plan',
    'addon_module',
    'extra_user',
    'credit_pack'
);

CREATE TYPE public.record_source AS ENUM (
    'template',
    'tenant',
    'sample'
);

CREATE TYPE public.role_layer AS ENUM (
    'platform',
    'partner',
    'vendor',
    'tenant'
);

CREATE TYPE public.role_type AS ENUM (
    'admin',
    'user',
    'salesperson',
    'counter',
    'employee'
);

CREATE TYPE public.sales_doc_kind AS ENUM (
    'quotation',
    'invoice',
    'credit_note',
    'opening_balance',
    'sales_order',
    'delivery_challan',
    'debit_note'
);

CREATE TYPE public.sales_doc_status AS ENUM (
    'draft',
    'sent',
    'accepted',
    'declined',
    'converted',
    'issued',
    'partially_paid',
    'paid',
    'cancelled',
    'open',
    'part_invoiced',
    'completed'
);

CREATE TYPE public.task_priority AS ENUM (
    'low',
    'medium',
    'high',
    'urgent'
);

CREATE TYPE public.task_status AS ENUM (
    'todo',
    'in_progress',
    'done',
    'cancelled'
);

CREATE TYPE public.tenant_source AS ENUM (
    'direct',
    'vendor',
    'sales',
    'partner'
);

CREATE TYPE public.tenant_status AS ENUM (
    'incomplete',
    'trialing',
    'active',
    'past_due',
    'free',
    'closed',
    'purged'
);

CREATE TYPE public.user_status AS ENUM (
    'active',
    'locked',
    'disabled'
);

CREATE TYPE public.workspace AS ENUM (
    'tenant',
    'console'
);

CREATE FUNCTION public.app_tenant() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE public.access_links (
    id uuid NOT NULL,
    token_hash text NOT NULL,
    kind public.access_link_kind NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid,
    created_by uuid,
    expires_at timestamp with time zone NOT NULL,
    opened_at timestamp with time zone,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.activities (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    type public.activity_type NOT NULL,
    title text,
    body text,
    due_at timestamp with time zone,
    completed_at timestamp with time zone,
    assignee_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deal_id uuid
);

ALTER TABLE ONLY public.activities FORCE ROW LEVEL SECURITY;

CREATE TABLE public.advance_adjustments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    payment_id uuid,
    document_id uuid NOT NULL,
    amount_paise bigint NOT NULL,
    reverses_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    credit_note_id uuid
);

ALTER TABLE ONLY public.advance_adjustments FORCE ROW LEVEL SECURITY;

CREATE TABLE public.appointments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    kind public.appointment_kind DEFAULT 'appointment'::public.appointment_kind NOT NULL,
    title text NOT NULL,
    contact_id uuid,
    item_id uuid,
    staff_id uuid,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    status public.appointment_status DEFAULT 'scheduled'::public.appointment_status NOT NULL,
    notes text,
    invoice_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    resource_id uuid,
    source character varying(12) DEFAULT 'walk_in'::character varying NOT NULL,
    guest_name text,
    guest_phone character varying(15),
    price_paise bigint,
    cancel_reason text,
    confirmed_at timestamp with time zone,
    checked_in_at timestamp with time zone,
    reminded_at timestamp with time zone,
    attachment_url text,
    CONSTRAINT appointments_end_after_start CHECK ((end_at > start_at))
);

ALTER TABLE ONLY public.appointments FORCE ROW LEVEL SECURITY;

CREATE TABLE public.approval_requests (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    number character varying(20) NOT NULL,
    title text NOT NULL,
    kind character varying(20) DEFAULT 'other'::character varying NOT NULL,
    amount_paise bigint,
    details text,
    attachment_url text,
    requested_by uuid NOT NULL,
    approver_id uuid NOT NULL,
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    need_by date,
    decided_at timestamp with time zone,
    decision_note text,
    task_id uuid,
    project_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.approval_requests FORCE ROW LEVEL SECURITY;

CREATE TABLE public.attendance (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    date date NOT NULL,
    status character varying(10) NOT NULL,
    clock_in character varying(5),
    clock_out character varying(5),
    worked_minutes integer DEFAULT 0 NOT NULL,
    late_minutes integer DEFAULT 0 NOT NULL,
    overtime_minutes integer DEFAULT 0 NOT NULL,
    source character varying(8) DEFAULT 'manual'::character varying NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.attendance FORCE ROW LEVEL SECURITY;

CREATE TABLE public.audit_log (
    id uuid NOT NULL,
    tenant_id uuid,
    actor_kind text NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    entity text,
    entity_id text,
    before jsonb,
    after jsonb,
    ip text,
    request_id text,
    at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;

CREATE TABLE public.booking_resources (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    kind character varying(12) DEFAULT 'room'::character varying NOT NULL,
    capacity integer DEFAULT 1 NOT NULL,
    color character varying(12) DEFAULT 'slate'::character varying NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.booking_resources FORCE ROW LEVEL SECURITY;

CREATE TABLE public.booking_services (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    duration_min integer DEFAULT 30 NOT NULL,
    buffer_min integer DEFAULT 0 NOT NULL,
    color character varying(12) DEFAULT 'blue'::character varying NOT NULL,
    staff_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    resource_kind character varying(12),
    online boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.booking_services FORCE ROW LEVEL SECURITY;

CREATE TABLE public.booking_settings (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    slug character varying(40) NOT NULL,
    title text NOT NULL,
    intro text,
    slot_step_min integer DEFAULT 30 NOT NULL,
    lead_min integer DEFAULT 60 NOT NULL,
    max_days_ahead integer DEFAULT 30 NOT NULL,
    auto_confirm boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.booking_settings FORCE ROW LEVEL SECURITY;

CREATE TABLE public.branches (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    address jsonb,
    state_code character(2),
    gstin character varying(15),
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.branches FORCE ROW LEVEL SECURITY;

CREATE TABLE public.config_values (
    scope text NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.console_applications (
    id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    company text,
    email text NOT NULL,
    mobile text NOT NULL,
    city text,
    state_code character(2),
    gstin character varying(15),
    message text,
    status text DEFAULT 'new'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    result_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.console_followups (
    id uuid NOT NULL,
    prospect_id uuid,
    tenant_id uuid,
    title text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    owner_user_id uuid NOT NULL,
    done_at timestamp with time zone,
    auto_key text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.console_notes (
    id uuid NOT NULL,
    tenant_id uuid,
    prospect_id uuid,
    body text NOT NULL,
    private_to_team boolean DEFAULT false NOT NULL,
    author_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.console_prospects (
    id uuid NOT NULL,
    name text NOT NULL,
    business_name text NOT NULL,
    industry_key text,
    city text,
    mobile character varying(15),
    email text,
    source text,
    stage text DEFAULT 'new'::text NOT NULL,
    lost_reason text,
    owner_user_id uuid NOT NULL,
    tenant_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT console_prospects_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'contacted'::text, 'demo'::text, 'trial'::text, 'won'::text, 'lost'::text])))
);

CREATE TABLE public.contacts (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    type public.contact_type DEFAULT 'customer'::public.contact_type NOT NULL,
    name text NOT NULL,
    company_name text,
    phone character varying(15),
    email text,
    gstin character varying(15),
    state_code character(2),
    address jsonb,
    lead_status public.lead_status,
    lead_source text,
    owner_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    custom jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    converted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_sample boolean DEFAULT false NOT NULL,
    credit_limit_paise bigint,
    price_list_id uuid,
    last_reminded_at timestamp with time zone,
    last_reminder_via character varying(10),
    payment_days integer,
    shipping_address jsonb,
    subject text,
    pipeline_id uuid,
    stage_id uuid,
    follow_up_on date,
    value_paise bigint,
    labels text[] DEFAULT ARRAY[]::text[] NOT NULL,
    lost_reason text,
    portal_seen_at timestamp with time zone,
    portal_blocked boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.contacts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.coupons (
    code text NOT NULL,
    type public.coupon_type NOT NULL,
    value integer NOT NULL,
    applies_to text DEFAULT 'all'::text NOT NULL,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    max_redemptions integer,
    redeemed integer DEFAULT 0 NOT NULL,
    vendor_id uuid
);

CREATE TABLE public.credit_balances (
    tenant_id uuid NOT NULL,
    type text NOT NULL,
    balance bigint DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone
);

ALTER TABLE ONLY public.credit_balances FORCE ROW LEVEL SECURITY;

CREATE TABLE public.crm_options (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(12) NOT NULL,
    name text NOT NULL,
    color character varying(10),
    "position" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.crm_options FORCE ROW LEVEL SECURITY;

CREATE TABLE public.crm_pipelines (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_pipelines FORCE ROW LEVEL SECURITY;

CREATE TABLE public.crm_products (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    deal_id uuid,
    item_id uuid NOT NULL,
    quantity numeric(14,3) DEFAULT 1 NOT NULL,
    price_paise bigint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.crm_products FORCE ROW LEVEL SECURITY;

CREATE TABLE public.crm_stages (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    name text NOT NULL,
    color character varying(10) DEFAULT 'blue'::character varying NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    probability integer
);

ALTER TABLE ONLY public.crm_stages FORCE ROW LEVEL SECURITY;

CREATE TABLE public.deals (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    title text NOT NULL,
    contact_id uuid NOT NULL,
    lead_id uuid,
    pipeline_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    value_paise bigint DEFAULT 0 NOT NULL,
    status character varying(6) DEFAULT 'open'::character varying NOT NULL,
    lost_reason text,
    expected_close_on date,
    source text,
    labels text[] DEFAULT ARRAY[]::text[] NOT NULL,
    notes text,
    owner_id uuid,
    created_by uuid,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.deals FORCE ROW LEVEL SECURITY;

CREATE TABLE public.employees (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    email text,
    phone character varying(15),
    gender character varying(10),
    dob date,
    photo_url text,
    member_id uuid,
    branch_id uuid,
    department_id uuid,
    designation_id uuid,
    manager_id uuid,
    shift_id uuid,
    employment_type character varying(12) DEFAULT 'full_time'::character varying NOT NULL,
    joined_on date NOT NULL,
    probation_ends_on date,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    exit_on date,
    exit_reason text,
    address jsonb,
    emergency jsonb,
    bank jsonb,
    pan character varying(10),
    aadhaar_last4 character varying(4),
    uan character varying(12),
    esi_no character varying(17),
    basic_paise bigint DEFAULT 0 NOT NULL,
    pay_type character varying(8) DEFAULT 'monthly'::character varying NOT NULL,
    pf boolean DEFAULT false NOT NULL,
    esi boolean DEFAULT false NOT NULL,
    pt boolean DEFAULT false NOT NULL,
    notes text,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.employees FORCE ROW LEVEL SECURITY;

CREATE TABLE public.expenses (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    category text NOT NULL,
    amount_paise bigint NOT NULL,
    paid_on date NOT NULL,
    method public.payment_method DEFAULT 'cash'::public.payment_method NOT NULL,
    payee text,
    notes text,
    receipt_url text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    number text,
    account_id uuid,
    contact_id uuid,
    reference text,
    bill_no text,
    vendor_gstin character varying(15),
    taxable_paise bigint,
    gst_rate_bp integer,
    gst_paise bigint
);

ALTER TABLE ONLY public.expenses FORCE ROW LEVEL SECURITY;

CREATE TABLE public.field_definitions (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    entity text NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    type public.field_type NOT NULL,
    required boolean DEFAULT false NOT NULL,
    options jsonb,
    validation jsonb,
    relation_entity text,
    "position" integer DEFAULT 0 NOT NULL,
    source public.record_source DEFAULT 'tenant'::public.record_source NOT NULL,
    archived_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.field_definitions FORCE ROW LEVEL SECURITY;

CREATE TABLE public.files (
    id uuid NOT NULL,
    tenant_id uuid,
    entity_type character varying(32),
    entity_id uuid,
    field character varying(32) DEFAULT 'attachments'::character varying NOT NULL,
    name character varying(200) NOT NULL,
    mime character varying(100) NOT NULL,
    size_bytes integer NOT NULL,
    sha256 character(64) NOT NULL,
    storage_key character varying(300) NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.files FORCE ROW LEVEL SECURITY;

CREATE TABLE public.fin_accounts (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    kind character varying(10) NOT NULL,
    bank_name text,
    account_no character varying(30),
    ifsc character varying(11),
    upi_id text,
    opening_paise bigint DEFAULT 0 NOT NULL,
    opening_date date,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.fin_accounts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.fin_categories (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(8) NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    budget_paise bigint,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.fin_categories FORCE ROW LEVEL SECURITY;

CREATE TABLE public.fin_cleared (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    account_id uuid NOT NULL,
    entry_id character varying(80) NOT NULL,
    cleared_on date NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fin_cleared FORCE ROW LEVEL SECURITY;

CREATE TABLE public.fin_ledgers (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    "group" character varying(10) NOT NULL,
    code character varying(10),
    description text,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fin_ledgers FORCE ROW LEVEL SECURITY;

CREATE TABLE public.fin_transfers (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    number text NOT NULL,
    transfer_on date NOT NULL,
    from_account_id uuid NOT NULL,
    to_account_id uuid NOT NULL,
    amount_paise bigint NOT NULL,
    charges_paise bigint DEFAULT 0 NOT NULL,
    reference text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.fin_transfers FORCE ROW LEVEL SECURITY;

CREATE TABLE public.form_layouts (
    tenant_id uuid NOT NULL,
    entity text NOT NULL,
    layout jsonb NOT NULL
);

ALTER TABLE ONLY public.form_layouts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.grace_periods (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind public.extension_kind NOT NULL,
    days integer NOT NULL,
    reason text NOT NULL,
    previous_end_at timestamp with time zone,
    new_end_at timestamp with time zone NOT NULL,
    granted_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.holidays (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    kind character varying(60) DEFAULT 'Festival'::character varying NOT NULL,
    paid boolean DEFAULT true NOT NULL,
    optional boolean DEFAULT false NOT NULL,
    notes text
);

ALTER TABLE ONLY public.holidays FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_acks (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    post_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    acked_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_acks FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_actions (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(12) NOT NULL,
    employee_id uuid NOT NULL,
    against_id uuid,
    on_date date NOT NULL,
    effective_on date,
    type_name text,
    subject text,
    description text,
    severity character varying(8),
    from_data jsonb,
    to_data jsonb,
    status character varying(12) DEFAULT 'pending'::character varying NOT NULL,
    response text,
    document_url text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.hr_actions FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_candidates (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone character varying(15),
    source text,
    experience numeric(4,1),
    current_ctc_paise bigint,
    expected_ctc_paise bigint,
    resume_url text,
    stage character varying(10) DEFAULT 'applied'::character varying NOT NULL,
    rating integer,
    notes text,
    employee_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.hr_candidates FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_departments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    branch_id uuid,
    head_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_departments FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_designations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    department_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_designations FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_goals (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    title text NOT NULL,
    goal_type text,
    description text,
    target text,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    status character varying(12) DEFAULT 'not_started'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.hr_goals FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_interviews (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    round text NOT NULL,
    on_date date NOT NULL,
    at_time character varying(5),
    mode character varying(10) DEFAULT 'in_person'::character varying NOT NULL,
    interviewer_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    result character varying(10) DEFAULT 'scheduled'::character varying NOT NULL,
    rating integer,
    feedback text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.hr_interviews FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_jobs (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    title text NOT NULL,
    department_id uuid,
    branch_id uuid,
    location text,
    employment_type character varying(12) DEFAULT 'full_time'::character varying NOT NULL,
    positions integer DEFAULT 1 NOT NULL,
    min_exp integer,
    max_exp integer,
    min_salary_paise bigint,
    max_salary_paise bigint,
    skills text[] DEFAULT '{}'::text[] NOT NULL,
    description text,
    closes_on date,
    status character varying(8) DEFAULT 'open'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.hr_jobs FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_loans (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    title text NOT NULL,
    kind character varying(60) DEFAULT 'Salary advance'::character varying NOT NULL,
    amount_paise bigint NOT NULL,
    emi_paise bigint NOT NULL,
    given_on date NOT NULL,
    starts_month character varying(7) NOT NULL,
    account_id uuid,
    journal_id uuid,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    document_url text
);

ALTER TABLE ONLY public.hr_loans FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_overtime (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    work_on date NOT NULL,
    hours numeric(6,2) NOT NULL,
    rate_paise bigint NOT NULL,
    notes text,
    status character varying(10) DEFAULT 'approved'::character varying NOT NULL,
    payslip_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_overtime FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_posts (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(12) NOT NULL,
    title text NOT NULL,
    category text,
    body text,
    starts_on date,
    ends_on date,
    starts_at character varying(5),
    ends_at character varying(5),
    location text,
    priority character varying(8) DEFAULT 'normal'::character varying NOT NULL,
    department_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    url text,
    needs_ack boolean DEFAULT false NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    color character varying(12),
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone
);

ALTER TABLE ONLY public.hr_posts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_records (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(16) NOT NULL,
    ref_id uuid,
    status character varying(16) NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_records FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_reviews (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    reviewer_id uuid,
    cycle text NOT NULL,
    review_on date NOT NULL,
    ratings jsonb DEFAULT '{}'::jsonb NOT NULL,
    rating numeric(3,1),
    strengths text,
    improve text,
    status character varying(12) DEFAULT 'pending'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.hr_reviews FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_salary_items (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    name text NOT NULL,
    calc character varying(10) DEFAULT 'fixed'::character varying NOT NULL,
    amount bigint NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.hr_salary_items FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_settings (
    tenant_id uuid NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_settings FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_shifts (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    starts_at character varying(5) NOT NULL,
    ends_at character varying(5) NOT NULL,
    break_minutes integer DEFAULT 0 NOT NULL,
    grace_minutes integer DEFAULT 0 NOT NULL,
    is_night boolean DEFAULT false NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.hr_shifts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.hr_trainings (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    title text NOT NULL,
    training_type text,
    trainer text,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    location text,
    cost_paise bigint DEFAULT 0 NOT NULL,
    employee_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    description text,
    status character varying(10) DEFAULT 'scheduled'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.hr_trainings FORCE ROW LEVEL SECURITY;

CREATE TABLE public.incomes (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    number text NOT NULL,
    received_on date NOT NULL,
    category text NOT NULL,
    account_id uuid NOT NULL,
    amount_paise bigint NOT NULL,
    payer text,
    contact_id uuid,
    reference text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    attachment_url text
);

ALTER TABLE ONLY public.incomes FORCE ROW LEVEL SECURITY;

CREATE TABLE public.industry_templates (
    key character varying(40) NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    description text,
    definition jsonb NOT NULL,
    published_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.invitations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text,
    email text,
    mobile character varying(15),
    role_id uuid NOT NULL,
    branch_ids uuid[] DEFAULT ARRAY[]::uuid[],
    token_hash text NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    employee_id uuid
);

ALTER TABLE ONLY public.invitations FORCE ROW LEVEL SECURITY;

CREATE TABLE public.item_categories (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.item_categories FORCE ROW LEVEL SECURITY;

CREATE TABLE public.items (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    type public.item_type DEFAULT 'product'::public.item_type NOT NULL,
    name text NOT NULL,
    sku text,
    category_id uuid,
    unit text DEFAULT 'pcs'::text NOT NULL,
    price_paise bigint DEFAULT 0 NOT NULL,
    cost_price_paise bigint,
    gst_rate_bp integer DEFAULT 1800 NOT NULL,
    hsn_sac character varying(10),
    duration_min integer,
    skill text,
    description text,
    image_url text,
    is_active boolean DEFAULT true NOT NULL,
    custom jsonb DEFAULT '{}'::jsonb NOT NULL,
    source public.record_source DEFAULT 'tenant'::public.record_source NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    track_stock boolean DEFAULT false NOT NULL,
    reorder_level numeric(18,3),
    tracking character varying(10) DEFAULT 'none'::character varying NOT NULL,
    alt_unit character varying(20),
    alt_factor numeric(18,3),
    barcode character varying(48),
    variant_group character varying(160),
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    preferred_supplier_id uuid
);

ALTER TABLE ONLY public.items FORCE ROW LEVEL SECURITY;

CREATE TABLE public.job_runs (
    name text NOT NULL,
    last_started_at timestamp with time zone,
    last_finished_at timestamp with time zone,
    last_ok_at timestamp with time zone,
    last_error text,
    runs integer DEFAULT 0 NOT NULL,
    failures integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_summary text
);

CREATE TABLE public.journal_lines (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    journal_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ledger_key character varying(80) NOT NULL,
    debit_paise bigint DEFAULT 0 NOT NULL,
    credit_paise bigint DEFAULT 0 NOT NULL,
    description text
);

ALTER TABLE ONLY public.journal_lines FORCE ROW LEVEL SECURITY;

CREATE TABLE public.journals (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    number text NOT NULL,
    journal_on date NOT NULL,
    narration text NOT NULL,
    reference text,
    total_paise bigint NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.journals FORCE ROW LEVEL SECURITY;

CREATE TABLE public.kb_articles (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    category character varying(30),
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    kind character varying(8) DEFAULT 'article'::character varying NOT NULL,
    published boolean DEFAULT true NOT NULL,
    uses integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kb_articles_kind_check CHECK (((kind)::text = ANY ((ARRAY['article'::character varying, 'reply'::character varying])::text[])))
);

ALTER TABLE ONLY public.kb_articles FORCE ROW LEVEL SECURITY;

CREATE TABLE public.leave_applications (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    half_day boolean DEFAULT false NOT NULL,
    days numeric(5,1) NOT NULL,
    reason text NOT NULL,
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    comment text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    attachment_url text
);

ALTER TABLE ONLY public.leave_applications FORCE ROW LEVEL SECURITY;

CREATE TABLE public.leave_types (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    code character varying(6) NOT NULL,
    days_per_year numeric(5,1) DEFAULT 0 NOT NULL,
    paid boolean DEFAULT true NOT NULL,
    carry_forward boolean DEFAULT false NOT NULL,
    color character varying(12) DEFAULT 'blue'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    description text,
    proof_after_days numeric(5,1)
);

ALTER TABLE ONLY public.leave_types FORCE ROW LEVEL SECURITY;

CREATE TABLE public.modules (
    key text NOT NULL,
    name text NOT NULL,
    description text,
    category text NOT NULL,
    depends_on text[] DEFAULT ARRAY[]::text[],
    is_free_tier boolean DEFAULT false NOT NULL,
    is_usage_based boolean DEFAULT false NOT NULL,
    is_v1 boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.notification_log (
    id uuid NOT NULL,
    tenant_id uuid,
    template text NOT NULL,
    channel text NOT NULL,
    dedup_key text,
    target text,
    status text DEFAULT 'sent'::text NOT NULL,
    sent_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.notification_log FORCE ROW LEVEL SECURITY;

CREATE TABLE public.notifications (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;

CREATE TABLE public.otp_codes (
    id uuid NOT NULL,
    target text NOT NULL,
    channel public.otp_channel NOT NULL,
    purpose public.otp_purpose NOT NULL,
    code_hash text NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.outbox_events (
    id uuid NOT NULL,
    tenant_id uuid,
    type text NOT NULL,
    version smallint DEFAULT 1 NOT NULL,
    payload jsonb NOT NULL,
    actor jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    published_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    locked_until timestamp with time zone,
    next_attempt_at timestamp with time zone
);

ALTER TABLE ONLY public.outbox_events FORCE ROW LEVEL SECURITY;

CREATE TABLE public.partners (
    id uuid NOT NULL,
    name text NOT NULL,
    contact_name text NOT NULL,
    email text NOT NULL,
    mobile character varying(15) NOT NULL,
    gstin character varying(15),
    state_code character(2),
    discount_bp integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partners_discount_check CHECK (((discount_bp >= 0) AND (discount_bp <= 9000))),
    CONSTRAINT partners_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text])))
);

CREATE TABLE public.payments_received (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    document_id uuid,
    contact_id uuid,
    number text NOT NULL,
    amount_paise bigint NOT NULL,
    method public.payment_method NOT NULL,
    reference text,
    paid_on date NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reverses_id uuid,
    account_id uuid,
    pos_shift_id uuid,
    attachment_url text
);

ALTER TABLE ONLY public.payments_received FORCE ROW LEVEL SECURITY;

CREATE TABLE public.payroll_runs (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    number text NOT NULL,
    month character varying(7) NOT NULL,
    period_from date NOT NULL,
    period_to date NOT NULL,
    pay_date date NOT NULL,
    status character varying(10) DEFAULT 'draft'::character varying NOT NULL,
    account_id uuid,
    notes text,
    employees integer DEFAULT 0 NOT NULL,
    gross_paise bigint DEFAULT 0 NOT NULL,
    deductions_paise bigint DEFAULT 0 NOT NULL,
    net_paise bigint DEFAULT 0 NOT NULL,
    employer_paise bigint DEFAULT 0 NOT NULL,
    paid_paise bigint DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.payroll_runs FORCE ROW LEVEL SECURITY;

CREATE TABLE public.payslips (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    run_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    number text NOT NULL,
    days_in_month integer NOT NULL,
    payable_days numeric(5,1) NOT NULL,
    lop_days numeric(5,1) DEFAULT 0 NOT NULL,
    basic_paise bigint DEFAULT 0 NOT NULL,
    earnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    deductions jsonb DEFAULT '[]'::jsonb NOT NULL,
    employer jsonb DEFAULT '[]'::jsonb NOT NULL,
    gross_paise bigint DEFAULT 0 NOT NULL,
    deductions_paise bigint DEFAULT 0 NOT NULL,
    net_paise bigint DEFAULT 0 NOT NULL,
    employer_paise bigint DEFAULT 0 NOT NULL,
    status character varying(8) DEFAULT 'unpaid'::character varying NOT NULL,
    paid_on date,
    account_id uuid,
    journal_id uuid,
    snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.payslips FORCE ROW LEVEL SECURITY;

CREATE TABLE public.permissions (
    key text NOT NULL,
    module_key text NOT NULL,
    resource text NOT NULL,
    action public.permission_action NOT NULL,
    description text NOT NULL
);

CREATE TABLE public.plan_drafts (
    plan_key text NOT NULL,
    data jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.plan_modules (
    plan_id uuid NOT NULL,
    module_key text NOT NULL
);

CREATE TABLE public.plans (
    id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    tagline text,
    limits jsonb NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.platform_credit_notes (
    id uuid NOT NULL,
    number text NOT NULL,
    fy text NOT NULL,
    tenant_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    reason text NOT NULL,
    taxable_paise bigint NOT NULL,
    cgst_paise bigint NOT NULL,
    sgst_paise bigint NOT NULL,
    igst_paise bigint NOT NULL,
    total_paise bigint NOT NULL,
    created_by uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.platform_invoices (
    id uuid NOT NULL,
    number text NOT NULL,
    fy text NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    seller jsonb NOT NULL,
    bill_to jsonb NOT NULL,
    lines jsonb NOT NULL,
    taxable_paise bigint NOT NULL,
    cgst_paise bigint NOT NULL,
    sgst_paise bigint NOT NULL,
    igst_paise bigint NOT NULL,
    total_paise bigint NOT NULL,
    issued_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.platform_members (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    reports_to uuid,
    status public.member_status DEFAULT 'active'::public.member_status NOT NULL,
    created_by uuid,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deactivated_at timestamp with time zone,
    partner_id uuid,
    referral_code character varying(20)
);

CREATE TABLE public.platform_orders (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind text DEFAULT 'fresh'::text NOT NULL,
    status public.platform_order_status DEFAULT 'awaiting_payment'::public.platform_order_status NOT NULL,
    plan_id uuid NOT NULL,
    cycle public.billing_cycle NOT NULL,
    items jsonb NOT NULL,
    list_paise bigint NOT NULL,
    discount_bp integer DEFAULT 0 NOT NULL,
    coupon_code text,
    discount_paise bigint DEFAULT 0 NOT NULL,
    taxable_paise bigint NOT NULL,
    cgst_paise bigint DEFAULT 0 NOT NULL,
    sgst_paise bigint DEFAULT 0 NOT NULL,
    igst_paise bigint DEFAULT 0 NOT NULL,
    total_paise bigint NOT NULL,
    bill_to jsonb NOT NULL,
    created_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    cancelled_reason text,
    expires_at timestamp with time zone NOT NULL,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    payment_link_id text,
    payment_link_url text,
    payment_link_at timestamp with time zone
);

CREATE TABLE public.platform_payments (
    id uuid NOT NULL,
    order_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    method public.platform_payment_method NOT NULL,
    amount_paise bigint NOT NULL,
    reference text,
    gateway_payment_id text,
    received_at timestamp with time zone NOT NULL,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.platform_sequences (
    doc_type text NOT NULL,
    fy text NOT NULL,
    next_no integer DEFAULT 1 NOT NULL
);

CREATE TABLE public.portal_settings (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    slug character varying(40),
    title text DEFAULT 'Your account'::text NOT NULL,
    intro text,
    show_bills boolean DEFAULT true NOT NULL,
    show_quotes boolean DEFAULT true NOT NULL,
    allow_quote_reply boolean DEFAULT true NOT NULL,
    show_statement boolean DEFAULT true NOT NULL,
    show_requests boolean DEFAULT true NOT NULL,
    show_bookings boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.portal_settings FORCE ROW LEVEL SECURITY;

CREATE TABLE public.pos_cash_moves (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    shift_id uuid NOT NULL,
    kind character varying(4) NOT NULL,
    amount_paise bigint NOT NULL,
    reason character varying(16) NOT NULL,
    note text,
    expense_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pos_cash_moves_amount_check CHECK ((amount_paise > 0)),
    CONSTRAINT pos_cash_moves_kind_check CHECK (((kind)::text = ANY ((ARRAY['in'::character varying, 'out'::character varying])::text[])))
);

ALTER TABLE ONLY public.pos_cash_moves FORCE ROW LEVEL SECURITY;

CREATE TABLE public.pos_counters (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(60) NOT NULL,
    branch_id uuid,
    location_id uuid,
    cash_account_id uuid,
    bank_account_id uuid,
    paper character varying(4) DEFAULT '80mm'::character varying NOT NULL,
    receipt_note text,
    max_discount_bp integer,
    allow_credit boolean DEFAULT true NOT NULL,
    need_customer boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT pos_counters_discount_check CHECK (((max_discount_bp IS NULL) OR ((max_discount_bp >= 0) AND (max_discount_bp <= 10000)))),
    CONSTRAINT pos_counters_paper_check CHECK (((paper)::text = ANY ((ARRAY['80mm'::character varying, '58mm'::character varying, 'a4'::character varying])::text[])))
);

ALTER TABLE ONLY public.pos_counters FORCE ROW LEVEL SECURITY;

CREATE TABLE public.pos_held_bills (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    counter_id uuid NOT NULL,
    label character varying(60) NOT NULL,
    cart jsonb NOT NULL,
    total_paise bigint DEFAULT 0 NOT NULL,
    lines integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.pos_held_bills FORCE ROW LEVEL SECURITY;

CREATE TABLE public.pos_shifts (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    counter_id uuid NOT NULL,
    number character varying(20) NOT NULL,
    status character varying(8) DEFAULT 'open'::character varying NOT NULL,
    opened_by uuid NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_cash_paise bigint DEFAULT 0 NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    expected_cash_paise bigint,
    counted_cash_paise bigint,
    difference_paise bigint,
    denominations jsonb,
    closing_note text,
    deposit_paise bigint DEFAULT 0 NOT NULL,
    deposit_transfer_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT pos_shifts_cash_check CHECK (((opening_cash_paise >= 0) AND ((counted_cash_paise IS NULL) OR (counted_cash_paise >= 0)) AND (deposit_paise >= 0))),
    CONSTRAINT pos_shifts_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[])))
);

ALTER TABLE ONLY public.pos_shifts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.price_list_items (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    price_list_id uuid NOT NULL,
    item_id uuid NOT NULL,
    price_paise bigint NOT NULL
);

ALTER TABLE ONLY public.price_list_items FORCE ROW LEVEL SECURITY;

CREATE TABLE public.price_lists (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    discount_bp integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.price_lists FORCE ROW LEVEL SECURITY;

CREATE TABLE public.prices (
    id uuid NOT NULL,
    item_type public.price_item_type NOT NULL,
    item_ref text NOT NULL,
    cycle public.billing_cycle NOT NULL,
    amount_paise bigint NOT NULL,
    active_from timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    active_to timestamp with time zone
);

CREATE TABLE public.processed_events (
    consumer text NOT NULL,
    event_id uuid NOT NULL,
    processed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.purchase_document_lines (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    document_id uuid NOT NULL,
    item_id uuid,
    description text NOT NULL,
    hsn_sac character varying(10),
    unit text DEFAULT 'pcs'::text NOT NULL,
    quantity numeric(18,3) NOT NULL,
    unit_price_paise bigint NOT NULL,
    discount_paise bigint DEFAULT 0 NOT NULL,
    taxable_paise bigint NOT NULL,
    gst_rate_bp integer NOT NULL,
    cgst_paise bigint DEFAULT 0 NOT NULL,
    sgst_paise bigint DEFAULT 0 NOT NULL,
    igst_paise bigint DEFAULT 0 NOT NULL,
    total_paise bigint NOT NULL,
    landed_paise bigint DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    source_line_id uuid,
    batch_no character varying(40),
    mfg_date date,
    expiry_date date,
    serials text[] DEFAULT '{}'::text[] NOT NULL
);

ALTER TABLE ONLY public.purchase_document_lines FORCE ROW LEVEL SECURITY;

CREATE TABLE public.purchase_documents (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    kind character varying(16) NOT NULL,
    status character varying(16) NOT NULL,
    number text NOT NULL,
    fy text NOT NULL,
    contact_id uuid NOT NULL,
    supplier jsonb DEFAULT '{}'::jsonb NOT NULL,
    supplier_ref character varying(40),
    supplier_date date,
    issue_date date NOT NULL,
    due_date date,
    place_of_supply character(2),
    reverse_charge boolean DEFAULT false NOT NULL,
    location_id uuid,
    subtotal_paise bigint DEFAULT 0 NOT NULL,
    discount_paise bigint DEFAULT 0 NOT NULL,
    taxable_paise bigint DEFAULT 0 NOT NULL,
    cgst_paise bigint DEFAULT 0 NOT NULL,
    sgst_paise bigint DEFAULT 0 NOT NULL,
    igst_paise bigint DEFAULT 0 NOT NULL,
    charges_paise bigint DEFAULT 0 NOT NULL,
    charges_gst_bp integer DEFAULT 0 NOT NULL,
    round_off_paise bigint DEFAULT 0 NOT NULL,
    total_paise bigint DEFAULT 0 NOT NULL,
    paid_paise bigint DEFAULT 0 NOT NULL,
    returned_paise bigint DEFAULT 0 NOT NULL,
    source_type character varying(16),
    source_id uuid,
    source_number text,
    notes text,
    cancel_reason text,
    cancelled_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    return_reason character varying(40),
    attachment_url text
);

ALTER TABLE ONLY public.purchase_documents FORCE ROW LEVEL SECURITY;

CREATE TABLE public.recurring_expenses (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    every character varying(10) NOT NULL,
    next_on date NOT NULL,
    ends_on date,
    template jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_expense_id uuid,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.recurring_expenses FORCE ROW LEVEL SECURITY;

CREATE TABLE public.role_field_access (
    id uuid NOT NULL,
    role_id uuid NOT NULL,
    tenant_id uuid,
    entity text NOT NULL,
    field text NOT NULL,
    access public.field_access DEFAULT 'hidden'::public.field_access NOT NULL
);

ALTER TABLE ONLY public.role_field_access FORCE ROW LEVEL SECURITY;

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    tenant_id uuid,
    permission_key text NOT NULL,
    scope public.permission_scope DEFAULT 'all'::public.permission_scope NOT NULL
);

ALTER TABLE ONLY public.role_permissions FORCE ROW LEVEL SECURITY;

CREATE TABLE public.roles (
    id uuid NOT NULL,
    tenant_id uuid,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    layer public.role_layer NOT NULL,
    role_type public.role_type NOT NULL,
    required_modules text[] DEFAULT ARRAY[]::text[],
    is_system boolean DEFAULT false NOT NULL,
    is_predefined boolean DEFAULT false NOT NULL,
    cloned_from uuid,
    template_version integer DEFAULT 1 NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    customized_at timestamp with time zone
);

ALTER TABLE ONLY public.roles FORCE ROW LEVEL SECURITY;

CREATE TABLE public.sales_document_lines (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    document_id uuid NOT NULL,
    item_id uuid,
    description text NOT NULL,
    hsn_sac character varying(10),
    unit text DEFAULT 'pcs'::text NOT NULL,
    quantity numeric(18,3) NOT NULL,
    unit_price_paise bigint NOT NULL,
    discount_paise bigint DEFAULT 0 NOT NULL,
    taxable_paise bigint NOT NULL,
    gst_rate_bp integer NOT NULL,
    cgst_paise bigint DEFAULT 0 NOT NULL,
    sgst_paise bigint DEFAULT 0 NOT NULL,
    igst_paise bigint DEFAULT 0 NOT NULL,
    total_paise bigint NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    source_line_id uuid,
    free_quantity numeric(18,3) DEFAULT 0 NOT NULL,
    batch_id uuid,
    serials text[] DEFAULT '{}'::text[] NOT NULL,
    batches jsonb
);

ALTER TABLE ONLY public.sales_document_lines FORCE ROW LEVEL SECURITY;

CREATE TABLE public.sales_documents (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    kind public.sales_doc_kind NOT NULL,
    status public.sales_doc_status DEFAULT 'draft'::public.sales_doc_status NOT NULL,
    number text,
    fy text,
    contact_id uuid,
    buyer jsonb DEFAULT '{}'::jsonb NOT NULL,
    seller jsonb,
    place_of_supply character(2),
    issue_date date NOT NULL,
    due_date date,
    subtotal_paise bigint DEFAULT 0 NOT NULL,
    discount_paise bigint DEFAULT 0 NOT NULL,
    taxable_paise bigint DEFAULT 0 NOT NULL,
    cgst_paise bigint DEFAULT 0 NOT NULL,
    sgst_paise bigint DEFAULT 0 NOT NULL,
    igst_paise bigint DEFAULT 0 NOT NULL,
    total_paise bigint DEFAULT 0 NOT NULL,
    paid_paise bigint DEFAULT 0 NOT NULL,
    notes text,
    terms text,
    source_type text,
    source_id uuid,
    share_token text,
    custom jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    issued_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    credited_paise bigint DEFAULT 0 NOT NULL,
    note_type text,
    source_number text,
    round_off_paise bigint DEFAULT 0 NOT NULL,
    ship_to jsonb,
    eway_bill_no character varying(12),
    eway_bill_date date,
    irn character(64),
    irn_ack_no character varying(20),
    irn_ack_date date,
    source_date date,
    location_id uuid,
    note_reason text
);

ALTER TABLE ONLY public.sales_documents FORCE ROW LEVEL SECURITY;

CREATE TABLE public.scheduled_changes (
    id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    change jsonb NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    applied_at timestamp with time zone
);

CREATE TABLE public.sign_in_events (
    id uuid NOT NULL,
    user_id uuid,
    tenant_id uuid,
    identifier text,
    outcome text NOT NULL,
    method text,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.staff_hours (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    weekday smallint NOT NULL,
    start_min integer NOT NULL,
    end_min integer NOT NULL,
    CONSTRAINT staff_hours_range_check CHECK ((((weekday >= 0) AND (weekday <= 6)) AND (start_min >= 0) AND (end_min <= 1440) AND (end_min > start_min)))
);

ALTER TABLE ONLY public.staff_hours FORCE ROW LEVEL SECURITY;

CREATE TABLE public.staff_time_off (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    from_at timestamp with time zone NOT NULL,
    to_at timestamp with time zone NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_time_off_range_check CHECK ((to_at > from_at))
);

ALTER TABLE ONLY public.staff_time_off FORCE ROW LEVEL SECURITY;

CREATE TABLE public.stock_balances (
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    location_id uuid NOT NULL,
    quantity numeric(18,3) DEFAULT 0 NOT NULL,
    value_paise bigint DEFAULT 0 NOT NULL,
    last_rate_paise bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.stock_balances FORCE ROW LEVEL SECURITY;

CREATE TABLE public.stock_batch_balances (
    tenant_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    location_id uuid NOT NULL,
    quantity numeric(18,3) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.stock_batch_balances FORCE ROW LEVEL SECURITY;

CREATE TABLE public.stock_batches (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    number character varying(40) NOT NULL,
    mfg_date date,
    expiry_date date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.stock_batches FORCE ROW LEVEL SECURITY;

CREATE TABLE public.stock_entries (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    location_id uuid NOT NULL,
    to_location_id uuid,
    entry_date date NOT NULL,
    party text,
    reference text,
    reason character varying(20),
    note text,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    value_paise bigint DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status character varying(12) DEFAULT 'posted'::character varying NOT NULL,
    received_at timestamp with time zone,
    attachment_url text
);

ALTER TABLE ONLY public.stock_entries FORCE ROW LEVEL SECURITY;

CREATE TABLE public.stock_layers (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    location_id uuid NOT NULL,
    received_on date NOT NULL,
    qty_remaining numeric(18,3) NOT NULL,
    rate_paise bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.stock_layers FORCE ROW LEVEL SECURITY;

CREATE TABLE public.stock_locations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    address text,
    city text,
    zip_code character varying(10),
    phone character varying(20),
    email text,
    state_code character varying(2),
    contact_person text
);

ALTER TABLE ONLY public.stock_locations FORCE ROW LEVEL SECURITY;

CREATE TABLE public.stock_moves (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    location_id uuid NOT NULL,
    move_date date NOT NULL,
    kind character varying(20) NOT NULL,
    quantity numeric(18,3) NOT NULL,
    rate_paise bigint NOT NULL,
    value_paise bigint NOT NULL,
    balance_qty numeric(18,3) NOT NULL,
    source_type character varying(20) NOT NULL,
    source_id uuid NOT NULL,
    source_line_id uuid,
    reverses_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    batch_id uuid,
    serials text[] DEFAULT '{}'::text[] NOT NULL
);

ALTER TABLE ONLY public.stock_moves FORCE ROW LEVEL SECURITY;

CREATE TABLE public.stock_serials (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    serial character varying(40) NOT NULL,
    status character varying(12) NOT NULL,
    location_id uuid,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.stock_serials FORCE ROW LEVEL SECURITY;

CREATE TABLE public.subscription_items (
    id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    price_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_amount_paise bigint NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone
);

CREATE TABLE public.subscriptions (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    status public.tenant_status NOT NULL,
    cycle public.billing_cycle DEFAULT 'monthly'::public.billing_cycle NOT NULL,
    trial_ends_at timestamp with time zone,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    grace_ends_at timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    auto_renew boolean DEFAULT true NOT NULL,
    mandate_id uuid,
    purge_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.subscriptions FORCE ROW LEVEL SECURITY;

CREATE TABLE public.supplier_payments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    document_id uuid NOT NULL,
    number text NOT NULL,
    amount_paise bigint NOT NULL,
    method character varying(10) NOT NULL,
    reference text,
    paid_on date NOT NULL,
    reverses_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    account_id uuid,
    attachment_url text
);

ALTER TABLE ONLY public.supplier_payments FORCE ROW LEVEL SECURITY;

CREATE TABLE public.support_messages (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    ticket_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    body text,
    author_id uuid,
    author_name text,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_messages_kind_check CHECK (((kind)::text = ANY ((ARRAY['reply'::character varying, 'note'::character varying, 'customer'::character varying, 'event'::character varying])::text[])))
);

ALTER TABLE ONLY public.support_messages FORCE ROW LEVEL SECURITY;

CREATE TABLE public.support_settings (
    tenant_id uuid NOT NULL,
    form_enabled boolean DEFAULT false NOT NULL,
    slug character varying(40),
    title text DEFAULT 'Raise a request'::text NOT NULL,
    intro text,
    categories jsonb DEFAULT '[]'::jsonb NOT NULL,
    sla jsonb DEFAULT '{}'::jsonb NOT NULL,
    warranty_months integer DEFAULT 12 NOT NULL,
    auto_assign character varying(12) DEFAULT 'none'::character varying NOT NULL,
    last_assigned_id uuid,
    ask_rating boolean DEFAULT true NOT NULL,
    auto_close_days integer DEFAULT 7 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_settings_close_check CHECK (((auto_close_days >= 0) AND (auto_close_days <= 90))),
    CONSTRAINT support_settings_warranty_check CHECK (((warranty_months >= 0) AND (warranty_months <= 120)))
);

ALTER TABLE ONLY public.support_settings FORCE ROW LEVEL SECURITY;

CREATE TABLE public.support_tickets (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    number character varying(20) NOT NULL,
    subject text NOT NULL,
    description text,
    contact_id uuid,
    guest_name text,
    guest_phone character varying(15),
    guest_email text,
    channel character varying(12) DEFAULT 'phone'::character varying NOT NULL,
    category character varying(30) DEFAULT 'other'::character varying NOT NULL,
    priority character varying(8) DEFAULT 'medium'::character varying NOT NULL,
    status character varying(12) DEFAULT 'new'::character varying NOT NULL,
    assignee_id uuid,
    labels text[] DEFAULT '{}'::text[] NOT NULL,
    invoice_id uuid,
    item_id uuid,
    serial character varying(60),
    first_response_due timestamp with time zone,
    resolve_due timestamp with time zone,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    reopened integer DEFAULT 0 NOT NULL,
    rating smallint,
    feedback text,
    public_token character varying(40) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT support_tickets_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT support_tickets_rating_check CHECK (((rating IS NULL) OR ((rating >= 1) AND (rating <= 5)))),
    CONSTRAINT support_tickets_status_check CHECK (((status)::text = ANY ((ARRAY['new'::character varying, 'open'::character varying, 'pending'::character varying, 'on_hold'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[]))),
    CONSTRAINT support_tickets_who_check CHECK (((contact_id IS NOT NULL) OR (guest_name IS NOT NULL)))
);

ALTER TABLE ONLY public.support_tickets FORCE ROW LEVEL SECURITY;

CREATE TABLE public.task_events (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    actor_id uuid,
    type text NOT NULL,
    body text,
    data jsonb,
    at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.task_events FORCE ROW LEVEL SECURITY;

CREATE TABLE public.task_projects (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    code character varying(12),
    description text,
    contact_id uuid,
    owner_id uuid,
    member_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    status character varying(12) DEFAULT 'active'::character varying NOT NULL,
    start_on date,
    due_on date,
    budget_paise bigint,
    billable boolean DEFAULT false NOT NULL,
    hourly_rate_paise bigint,
    color character varying(12) DEFAULT 'blue'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.task_projects FORCE ROW LEVEL SECURITY;

CREATE TABLE public.task_times (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid,
    project_id uuid,
    user_id uuid NOT NULL,
    work_date date NOT NULL,
    minutes integer NOT NULL,
    note text,
    billable boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_times_minutes_check CHECK (((minutes > 0) AND (minutes <= 1440)))
);

ALTER TABLE ONLY public.task_times FORCE ROW LEVEL SECURITY;

CREATE TABLE public.tasks (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    parent_id uuid,
    title text NOT NULL,
    description text,
    status public.task_status DEFAULT 'todo'::public.task_status NOT NULL,
    priority public.task_priority DEFAULT 'medium'::public.task_priority NOT NULL,
    due_at timestamp with time zone,
    assignee_id uuid,
    contact_id uuid,
    created_by uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    project_id uuid,
    labels text[] DEFAULT '{}'::text[] NOT NULL,
    start_on date,
    estimate_min integer,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    repeat character varying(10) DEFAULT 'none'::character varying NOT NULL
);

ALTER TABLE ONLY public.tasks FORCE ROW LEVEL SECURITY;

CREATE TABLE public.tenant_acquisitions (
    tenant_id uuid NOT NULL,
    acquired_by_type public.acquired_by_type NOT NULL,
    acquired_by_user_id uuid,
    method public.acquisition_method NOT NULL,
    referral_code text,
    coupon_code text,
    locked_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    changed_by uuid,
    change_reason text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.tenant_entitlements (
    tenant_id uuid NOT NULL,
    module_key text NOT NULL,
    status public.entitlement_status NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    activated_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.tenant_entitlements FORCE ROW LEVEL SECURITY;

CREATE TABLE public.tenant_members (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    branch_ids uuid[] DEFAULT ARRAY[]::uuid[],
    status public.member_status DEFAULT 'invited'::public.member_status NOT NULL,
    joined_at timestamp with time zone,
    deactivated_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.tenant_members FORCE ROW LEVEL SECURITY;

CREATE TABLE public.tenant_module_overrides (
    tenant_id uuid NOT NULL,
    module_key text NOT NULL,
    state text NOT NULL,
    until timestamp with time zone,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_module_overrides_state_check CHECK ((state = ANY (ARRAY['on'::text, 'off'::text])))
);

ALTER TABLE ONLY public.tenant_module_overrides FORCE ROW LEVEL SECURITY;

CREATE TABLE public.tenant_role_settings (
    tenant_id uuid NOT NULL,
    role_id uuid NOT NULL,
    hidden boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.tenant_role_settings FORCE ROW LEVEL SECURITY;

CREATE TABLE public.tenant_sequences (
    tenant_id uuid NOT NULL,
    doc_type text NOT NULL,
    fy text NOT NULL,
    prefix text NOT NULL,
    next_no integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.tenant_sequences FORCE ROW LEVEL SECURITY;

CREATE TABLE public.tenant_terms (
    tenant_id uuid NOT NULL,
    term_key text NOT NULL,
    value text NOT NULL,
    source public.record_source DEFAULT 'template'::public.record_source NOT NULL
);

ALTER TABLE ONLY public.tenant_terms FORCE ROW LEVEL SECURITY;

CREATE TABLE public.tenants (
    id uuid NOT NULL,
    name text NOT NULL,
    legal_name text,
    industry_key text NOT NULL,
    template_version integer NOT NULL,
    status public.tenant_status DEFAULT 'trialing'::public.tenant_status NOT NULL,
    source public.tenant_source DEFAULT 'direct'::public.tenant_source NOT NULL,
    partner_id uuid,
    billing_owner public.billing_owner DEFAULT 'self'::public.billing_owner NOT NULL,
    gstin character varying(15),
    billing_state_code character(2),
    address jsonb,
    logo_url text,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    fy_start_month smallint DEFAULT 4 NOT NULL,
    owner_user_id uuid NOT NULL,
    needs_seat_choice boolean DEFAULT false NOT NULL,
    config_applied_at timestamp with time zone,
    onboarding jsonb DEFAULT '{}'::jsonb NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    onboarding_type public.onboarding_type DEFAULT 'trial'::public.onboarding_type NOT NULL,
    is_internal boolean DEFAULT false NOT NULL,
    profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.tenants FORCE ROW LEVEL SECURITY;

CREATE TABLE public.trial_registry (
    id uuid NOT NULL,
    mobile_hash text,
    email_hash text,
    gstin character varying(15),
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.usage_counters (
    tenant_id uuid NOT NULL,
    metric text NOT NULL,
    period text NOT NULL,
    used bigint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.usage_counters FORCE ROW LEVEL SECURITY;

CREATE TABLE public.user_mfa (
    user_id uuid NOT NULL,
    secret_enc text NOT NULL,
    enabled_at timestamp with time zone,
    backup_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_password_history (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    family_id uuid NOT NULL,
    refresh_token_hash text NOT NULL,
    user_agent text,
    ip text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid,
    workspace public.workspace DEFAULT 'tenant'::public.workspace NOT NULL
);

CREATE TABLE public.user_trusted_devices (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    user_agent text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    mobile character varying(15) NOT NULL,
    password_hash text,
    email_verified_at timestamp with time zone,
    mobile_verified_at timestamp with time zone,
    mfa_enabled boolean DEFAULT false NOT NULL,
    status public.user_status DEFAULT 'active'::public.user_status NOT NULL,
    failed_logins integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_tenant_id uuid,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    password_changed_at timestamp with time zone,
    avatar_url text
);

CREATE TABLE public.webhook_events (
    id uuid NOT NULL,
    gateway text NOT NULL,
    event_id text NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp with time zone,
    error text,
    resolved_at timestamp with time zone,
    resolved_by uuid
);

ALTER TABLE ONLY public.access_links
    ADD CONSTRAINT access_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.advance_adjustments
    ADD CONSTRAINT advance_adjustments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_no_double_booking EXCLUDE USING gist (tenant_id WITH =, staff_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (((staff_id IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::public.appointment_status, 'no_show'::public.appointment_status]))));

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_no_double_resource EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (((resource_id IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::public.appointment_status, 'no_show'::public.appointment_status]))));

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.booking_resources
    ADD CONSTRAINT booking_resources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_pkey PRIMARY KEY (tenant_id);

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.config_values
    ADD CONSTRAINT config_values_pkey PRIMARY KEY (scope, key);

ALTER TABLE ONLY public.console_applications
    ADD CONSTRAINT console_applications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.console_followups
    ADD CONSTRAINT console_followups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.console_notes
    ADD CONSTRAINT console_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.console_prospects
    ADD CONSTRAINT console_prospects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.credit_balances
    ADD CONSTRAINT credit_balances_pkey PRIMARY KEY (tenant_id, type);

ALTER TABLE ONLY public.crm_options
    ADD CONSTRAINT crm_options_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crm_pipelines
    ADD CONSTRAINT crm_pipelines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crm_products
    ADD CONSTRAINT crm_products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crm_stages
    ADD CONSTRAINT crm_stages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.field_definitions
    ADD CONSTRAINT field_definitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fin_accounts
    ADD CONSTRAINT fin_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fin_categories
    ADD CONSTRAINT fin_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fin_cleared
    ADD CONSTRAINT fin_cleared_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fin_ledgers
    ADD CONSTRAINT fin_ledgers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fin_transfers
    ADD CONSTRAINT fin_transfers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.form_layouts
    ADD CONSTRAINT form_layouts_pkey PRIMARY KEY (tenant_id, entity);

ALTER TABLE ONLY public.grace_periods
    ADD CONSTRAINT grace_periods_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_acks
    ADD CONSTRAINT hr_acks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_actions
    ADD CONSTRAINT hr_actions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_candidates
    ADD CONSTRAINT hr_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_departments
    ADD CONSTRAINT hr_departments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_designations
    ADD CONSTRAINT hr_designations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_goals
    ADD CONSTRAINT hr_goals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_interviews
    ADD CONSTRAINT hr_interviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_jobs
    ADD CONSTRAINT hr_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_loans
    ADD CONSTRAINT hr_loans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_overtime
    ADD CONSTRAINT hr_overtime_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_posts
    ADD CONSTRAINT hr_posts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_records
    ADD CONSTRAINT hr_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_reviews
    ADD CONSTRAINT hr_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_salary_items
    ADD CONSTRAINT hr_salary_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_settings
    ADD CONSTRAINT hr_settings_pkey PRIMARY KEY (tenant_id);

ALTER TABLE ONLY public.hr_shifts
    ADD CONSTRAINT hr_shifts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hr_trainings
    ADD CONSTRAINT hr_trainings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.incomes
    ADD CONSTRAINT incomes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.industry_templates
    ADD CONSTRAINT industry_templates_pkey PRIMARY KEY (key, version);

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.item_categories
    ADD CONSTRAINT item_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (name);

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.journals
    ADD CONSTRAINT journals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.leave_applications
    ADD CONSTRAINT leave_applications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.leave_types
    ADD CONSTRAINT leave_types_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payments_received
    ADD CONSTRAINT payments_received_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.plan_drafts
    ADD CONSTRAINT plan_drafts_pkey PRIMARY KEY (plan_key);

ALTER TABLE ONLY public.plan_modules
    ADD CONSTRAINT plan_modules_pkey PRIMARY KEY (plan_id, module_key);

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_credit_notes
    ADD CONSTRAINT platform_credit_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_members
    ADD CONSTRAINT platform_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_orders
    ADD CONSTRAINT platform_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_payments
    ADD CONSTRAINT platform_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_sequences
    ADD CONSTRAINT platform_sequences_pkey PRIMARY KEY (doc_type, fy);

ALTER TABLE ONLY public.portal_settings
    ADD CONSTRAINT portal_settings_pkey PRIMARY KEY (tenant_id);

ALTER TABLE ONLY public.pos_cash_moves
    ADD CONSTRAINT pos_cash_moves_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pos_counters
    ADD CONSTRAINT pos_counters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pos_held_bills
    ADD CONSTRAINT pos_held_bills_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.price_list_items
    ADD CONSTRAINT price_list_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.price_lists
    ADD CONSTRAINT price_lists_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prices
    ADD CONSTRAINT prices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.processed_events
    ADD CONSTRAINT processed_events_pkey PRIMARY KEY (consumer, event_id);

ALTER TABLE ONLY public.purchase_document_lines
    ADD CONSTRAINT purchase_document_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_documents
    ADD CONSTRAINT purchase_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.recurring_expenses
    ADD CONSTRAINT recurring_expenses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.role_field_access
    ADD CONSTRAINT role_field_access_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_key);

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sales_document_lines
    ADD CONSTRAINT sales_document_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sales_documents
    ADD CONSTRAINT sales_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.scheduled_changes
    ADD CONSTRAINT scheduled_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sign_in_events
    ADD CONSTRAINT sign_in_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.staff_hours
    ADD CONSTRAINT staff_hours_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.staff_time_off
    ADD CONSTRAINT staff_time_off_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_balances
    ADD CONSTRAINT stock_balances_pkey PRIMARY KEY (item_id, location_id);

ALTER TABLE ONLY public.stock_batch_balances
    ADD CONSTRAINT stock_batch_balances_pkey PRIMARY KEY (batch_id, location_id);

ALTER TABLE ONLY public.stock_batches
    ADD CONSTRAINT stock_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_entries
    ADD CONSTRAINT stock_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_layers
    ADD CONSTRAINT stock_layers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_locations
    ADD CONSTRAINT stock_locations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_moves
    ADD CONSTRAINT stock_moves_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_serials
    ADD CONSTRAINT stock_serials_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subscription_items
    ADD CONSTRAINT subscription_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.support_settings
    ADD CONSTRAINT support_settings_pkey PRIMARY KEY (tenant_id);

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_events
    ADD CONSTRAINT task_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_projects
    ADD CONSTRAINT task_projects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_times
    ADD CONSTRAINT task_times_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tenant_acquisitions
    ADD CONSTRAINT tenant_acquisitions_pkey PRIMARY KEY (tenant_id);

ALTER TABLE ONLY public.tenant_entitlements
    ADD CONSTRAINT tenant_entitlements_pkey PRIMARY KEY (tenant_id, module_key);

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tenant_module_overrides
    ADD CONSTRAINT tenant_module_overrides_pkey PRIMARY KEY (tenant_id, module_key);

ALTER TABLE ONLY public.tenant_role_settings
    ADD CONSTRAINT tenant_role_settings_pkey PRIMARY KEY (tenant_id, role_id);

ALTER TABLE ONLY public.tenant_sequences
    ADD CONSTRAINT tenant_sequences_pkey PRIMARY KEY (tenant_id, doc_type, fy);

ALTER TABLE ONLY public.tenant_terms
    ADD CONSTRAINT tenant_terms_pkey PRIMARY KEY (tenant_id, term_key);

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.trial_registry
    ADD CONSTRAINT trial_registry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.usage_counters
    ADD CONSTRAINT usage_counters_pkey PRIMARY KEY (tenant_id, metric, period);

ALTER TABLE ONLY public.user_mfa
    ADD CONSTRAINT user_mfa_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.user_password_history
    ADD CONSTRAINT user_password_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_trusted_devices
    ADD CONSTRAINT user_trusted_devices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);

CREATE INDEX access_links_tenant_idx ON public.access_links USING btree (tenant_id);

CREATE UNIQUE INDEX access_links_token_hash_key ON public.access_links USING btree (token_hash);

CREATE INDEX access_links_user_idx ON public.access_links USING btree (user_id);

CREATE INDEX activities_tenant_id_assignee_id_due_at_idx ON public.activities USING btree (tenant_id, assignee_id, due_at);

CREATE INDEX activities_tenant_id_contact_id_created_at_idx ON public.activities USING btree (tenant_id, contact_id, created_at DESC);

CREATE INDEX activities_tenant_id_deal_id_idx ON public.activities USING btree (tenant_id, deal_id);

CREATE UNIQUE INDEX advance_adjustments_reverses_id_key ON public.advance_adjustments USING btree (reverses_id);

CREATE INDEX advance_adjustments_tenant_id_credit_note_id_idx ON public.advance_adjustments USING btree (tenant_id, credit_note_id);

CREATE INDEX advance_adjustments_tenant_id_document_id_idx ON public.advance_adjustments USING btree (tenant_id, document_id);

CREATE INDEX advance_adjustments_tenant_id_payment_id_idx ON public.advance_adjustments USING btree (tenant_id, payment_id);

CREATE INDEX appointments_tenant_id_staff_id_start_at_idx ON public.appointments USING btree (tenant_id, staff_id, start_at);

CREATE INDEX appointments_tenant_id_start_at_idx ON public.appointments USING btree (tenant_id, start_at);

CREATE UNIQUE INDEX approval_requests_tenant_id_number_key ON public.approval_requests USING btree (tenant_id, number);

CREATE INDEX approval_requests_tenant_id_status_idx ON public.approval_requests USING btree (tenant_id, status);

CREATE UNIQUE INDEX attendance_employee_id_date_key ON public.attendance USING btree (employee_id, date);

CREATE INDEX attendance_tenant_id_date_idx ON public.attendance USING btree (tenant_id, date);

CREATE INDEX audit_log_tenant_id_at_idx ON public.audit_log USING btree (tenant_id, at DESC);

CREATE UNIQUE INDEX booking_resources_tenant_id_name_key ON public.booking_resources USING btree (tenant_id, name);

CREATE UNIQUE INDEX booking_services_tenant_id_item_id_key ON public.booking_services USING btree (tenant_id, item_id);

CREATE UNIQUE INDEX booking_settings_slug_key ON public.booking_settings USING btree (slug);

CREATE UNIQUE INDEX branches_tenant_id_code_key ON public.branches USING btree (tenant_id, code);

CREATE INDEX console_applications_email_idx ON public.console_applications USING btree (email);

CREATE INDEX console_applications_status_created_at_idx ON public.console_applications USING btree (status, created_at);

CREATE UNIQUE INDEX console_followups_auto_key ON public.console_followups USING btree (auto_key);

CREATE INDEX console_followups_owner_idx ON public.console_followups USING btree (owner_user_id, done_at, due_at);

CREATE INDEX console_followups_tenant_idx ON public.console_followups USING btree (tenant_id);

CREATE INDEX console_notes_tenant_idx ON public.console_notes USING btree (tenant_id, created_at DESC);

CREATE INDEX console_prospects_mobile_idx ON public.console_prospects USING btree (mobile);

CREATE INDEX console_prospects_owner_idx ON public.console_prospects USING btree (owner_user_id, stage);

CREATE INDEX console_prospects_tenant_idx ON public.console_prospects USING btree (tenant_id);

CREATE INDEX contacts_custom_gin ON public.contacts USING gin (custom jsonb_path_ops);

CREATE INDEX contacts_tenant_id_email_idx ON public.contacts USING btree (tenant_id, email);

CREATE INDEX contacts_tenant_id_phone_idx ON public.contacts USING btree (tenant_id, phone);

CREATE INDEX contacts_tenant_id_type_name_idx ON public.contacts USING btree (tenant_id, type, name);

CREATE UNIQUE INDEX crm_options_tenant_id_kind_name_key ON public.crm_options USING btree (tenant_id, kind, name);

CREATE INDEX crm_pipelines_tenant_id_idx ON public.crm_pipelines USING btree (tenant_id);

CREATE INDEX crm_products_tenant_id_contact_id_idx ON public.crm_products USING btree (tenant_id, contact_id);

CREATE INDEX crm_products_tenant_id_deal_id_idx ON public.crm_products USING btree (tenant_id, deal_id);

CREATE INDEX crm_stages_tenant_id_pipeline_id_kind_idx ON public.crm_stages USING btree (tenant_id, pipeline_id, kind);

CREATE INDEX deals_tenant_id_contact_id_idx ON public.deals USING btree (tenant_id, contact_id);

CREATE INDEX deals_tenant_id_pipeline_id_status_idx ON public.deals USING btree (tenant_id, pipeline_id, status);

CREATE INDEX employees_member_id_idx ON public.employees USING btree (member_id);

CREATE UNIQUE INDEX employees_tenant_id_code_key ON public.employees USING btree (tenant_id, code);

CREATE INDEX employees_tenant_id_status_idx ON public.employees USING btree (tenant_id, status);

CREATE INDEX expenses_tenant_id_paid_on_idx ON public.expenses USING btree (tenant_id, paid_on);

CREATE UNIQUE INDEX field_definitions_tenant_id_entity_key_key ON public.field_definitions USING btree (tenant_id, entity, key);

CREATE INDEX files_tenant_id_entity_idx ON public.files USING btree (tenant_id, entity_type, entity_id);

CREATE INDEX fin_accounts_tenant_id_idx ON public.fin_accounts USING btree (tenant_id);

CREATE UNIQUE INDEX fin_categories_tenant_id_kind_name_key ON public.fin_categories USING btree (tenant_id, kind, name);

CREATE UNIQUE INDEX fin_cleared_tenant_id_entry_id_key ON public.fin_cleared USING btree (tenant_id, entry_id);

CREATE UNIQUE INDEX fin_ledgers_tenant_id_name_key ON public.fin_ledgers USING btree (tenant_id, name);

CREATE INDEX fin_transfers_tenant_id_transfer_on_idx ON public.fin_transfers USING btree (tenant_id, transfer_on);

CREATE INDEX grace_periods_tenant_id_created_at_idx ON public.grace_periods USING btree (tenant_id, created_at);

CREATE INDEX holidays_tenant_id_from_date_idx ON public.holidays USING btree (tenant_id, from_date);

CREATE UNIQUE INDEX hr_acks_post_id_employee_id_key ON public.hr_acks USING btree (post_id, employee_id);

CREATE INDEX hr_actions_employee_id_idx ON public.hr_actions USING btree (employee_id);

CREATE INDEX hr_actions_tenant_id_kind_idx ON public.hr_actions USING btree (tenant_id, kind);

CREATE INDEX hr_candidates_tenant_id_job_id_idx ON public.hr_candidates USING btree (tenant_id, job_id);

CREATE UNIQUE INDEX hr_departments_tenant_id_name_key ON public.hr_departments USING btree (tenant_id, name);

CREATE UNIQUE INDEX hr_designations_tenant_id_name_key ON public.hr_designations USING btree (tenant_id, name);

CREATE INDEX hr_goals_tenant_id_idx ON public.hr_goals USING btree (tenant_id);

CREATE INDEX hr_interviews_tenant_id_on_date_idx ON public.hr_interviews USING btree (tenant_id, on_date);

CREATE INDEX hr_jobs_tenant_id_idx ON public.hr_jobs USING btree (tenant_id);

CREATE INDEX hr_loans_employee_id_idx ON public.hr_loans USING btree (employee_id);

CREATE INDEX hr_overtime_tenant_id_work_on_idx ON public.hr_overtime USING btree (tenant_id, work_on);

CREATE INDEX hr_posts_tenant_id_kind_idx ON public.hr_posts USING btree (tenant_id, kind);

CREATE INDEX hr_records_ref_id_idx ON public.hr_records USING btree (ref_id);

CREATE INDEX hr_records_tenant_id_kind_idx ON public.hr_records USING btree (tenant_id, kind);

CREATE INDEX hr_reviews_tenant_id_idx ON public.hr_reviews USING btree (tenant_id);

CREATE INDEX hr_salary_items_employee_id_idx ON public.hr_salary_items USING btree (employee_id);

CREATE INDEX hr_trainings_tenant_id_idx ON public.hr_trainings USING btree (tenant_id);

CREATE INDEX incomes_tenant_id_received_on_idx ON public.incomes USING btree (tenant_id, received_on);

CREATE INDEX invitations_tenant_id_idx ON public.invitations USING btree (tenant_id);

CREATE UNIQUE INDEX invitations_token_hash_key ON public.invitations USING btree (token_hash);

CREATE UNIQUE INDEX item_categories_tenant_id_name_key ON public.item_categories USING btree (tenant_id, name);

CREATE INDEX items_custom_gin ON public.items USING gin (custom jsonb_path_ops);

CREATE UNIQUE INDEX items_tenant_id_barcode_key ON public.items USING btree (tenant_id, barcode) WHERE (barcode IS NOT NULL);

CREATE INDEX items_tenant_id_name_idx ON public.items USING btree (tenant_id, name);

CREATE UNIQUE INDEX items_tenant_sku_uq ON public.items USING btree (tenant_id, lower(sku)) WHERE (sku IS NOT NULL);

CREATE INDEX journal_lines_journal_id_idx ON public.journal_lines USING btree (journal_id);

CREATE INDEX journal_lines_tenant_id_ledger_key_idx ON public.journal_lines USING btree (tenant_id, ledger_key);

CREATE INDEX journals_tenant_id_journal_on_idx ON public.journals USING btree (tenant_id, journal_on);

CREATE INDEX kb_articles_tenant_id_kind_idx ON public.kb_articles USING btree (tenant_id, kind);

CREATE INDEX leave_applications_employee_id_idx ON public.leave_applications USING btree (employee_id);

CREATE INDEX leave_applications_tenant_id_from_date_idx ON public.leave_applications USING btree (tenant_id, from_date);

CREATE UNIQUE INDEX leave_types_tenant_id_name_key ON public.leave_types USING btree (tenant_id, name);

CREATE UNIQUE INDEX notification_log_dedup_key_key ON public.notification_log USING btree (dedup_key);

CREATE INDEX notification_log_tenant_id_idx ON public.notification_log USING btree (tenant_id);

CREATE INDEX notifications_tenant_id_user_id_created_at_idx ON public.notifications USING btree (tenant_id, user_id, created_at DESC);

CREATE INDEX otp_codes_target_purpose_created_at_idx ON public.otp_codes USING btree (target, purpose, created_at DESC);

CREATE INDEX outbox_events_due_idx ON public.outbox_events USING btree (occurred_at) WHERE (published_at IS NULL);

CREATE INDEX outbox_events_published_at_occurred_at_idx ON public.outbox_events USING btree (published_at, occurred_at);

CREATE UNIQUE INDEX partners_name_key ON public.partners USING btree (lower(name));

CREATE INDEX payments_received_pos_shift_id_idx ON public.payments_received USING btree (pos_shift_id);

CREATE UNIQUE INDEX payments_received_reverses_id_key ON public.payments_received USING btree (reverses_id);

CREATE INDEX payments_received_tenant_id_contact_id_idx ON public.payments_received USING btree (tenant_id, contact_id);

CREATE INDEX payments_received_tenant_id_document_id_idx ON public.payments_received USING btree (tenant_id, document_id);

CREATE INDEX payments_received_tenant_id_paid_on_idx ON public.payments_received USING btree (tenant_id, paid_on);

CREATE UNIQUE INDEX payroll_runs_tenant_id_month_key ON public.payroll_runs USING btree (tenant_id, month);

CREATE INDEX payslips_employee_id_idx ON public.payslips USING btree (employee_id);

CREATE UNIQUE INDEX payslips_run_id_employee_id_key ON public.payslips USING btree (run_id, employee_id);

CREATE UNIQUE INDEX plans_key_key ON public.plans USING btree (key);

CREATE UNIQUE INDEX platform_credit_notes_invoice_id_key ON public.platform_credit_notes USING btree (invoice_id);

CREATE UNIQUE INDEX platform_credit_notes_number_key ON public.platform_credit_notes USING btree (number);

CREATE INDEX platform_credit_notes_tenant_id_idx ON public.platform_credit_notes USING btree (tenant_id);

CREATE UNIQUE INDEX platform_invoices_number_key ON public.platform_invoices USING btree (number);

CREATE UNIQUE INDEX platform_invoices_order_id_key ON public.platform_invoices USING btree (order_id);

CREATE INDEX platform_invoices_tenant_id_idx ON public.platform_invoices USING btree (tenant_id);

CREATE INDEX platform_members_partner_idx ON public.platform_members USING btree (partner_id);

CREATE UNIQUE INDEX platform_members_referral_code_key ON public.platform_members USING btree (referral_code);

CREATE INDEX platform_members_reports_to_idx ON public.platform_members USING btree (reports_to);

CREATE UNIQUE INDEX platform_members_user_id_key ON public.platform_members USING btree (user_id);

CREATE UNIQUE INDEX platform_orders_payment_link_id_key ON public.platform_orders USING btree (payment_link_id);

CREATE INDEX platform_orders_status_idx ON public.platform_orders USING btree (status);

CREATE INDEX platform_orders_tenant_id_created_at_idx ON public.platform_orders USING btree (tenant_id, created_at);

CREATE UNIQUE INDEX platform_payments_gateway_payment_id_key ON public.platform_payments USING btree (gateway_payment_id);

CREATE INDEX platform_payments_tenant_id_idx ON public.platform_payments USING btree (tenant_id);

CREATE UNIQUE INDEX portal_settings_slug_key ON public.portal_settings USING btree (slug);

CREATE INDEX pos_cash_moves_shift_id_idx ON public.pos_cash_moves USING btree (shift_id);

CREATE UNIQUE INDEX pos_counters_tenant_id_name_key ON public.pos_counters USING btree (tenant_id, name);

CREATE INDEX pos_held_bills_counter_id_idx ON public.pos_held_bills USING btree (counter_id);

CREATE UNIQUE INDEX pos_shifts_open_counter_key ON public.pos_shifts USING btree (counter_id) WHERE ((status)::text = 'open'::text);

CREATE UNIQUE INDEX pos_shifts_open_person_key ON public.pos_shifts USING btree (tenant_id, opened_by) WHERE ((status)::text = 'open'::text);

CREATE UNIQUE INDEX pos_shifts_tenant_id_number_key ON public.pos_shifts USING btree (tenant_id, number);

CREATE INDEX pos_shifts_tenant_id_opened_at_idx ON public.pos_shifts USING btree (tenant_id, opened_at);

CREATE UNIQUE INDEX price_list_items_price_list_id_item_id_key ON public.price_list_items USING btree (price_list_id, item_id);

CREATE INDEX price_list_items_tenant_id_item_id_idx ON public.price_list_items USING btree (tenant_id, item_id);

CREATE UNIQUE INDEX price_lists_tenant_id_name_key ON public.price_lists USING btree (tenant_id, name);

CREATE INDEX prices_item_type_item_ref_cycle_idx ON public.prices USING btree (item_type, item_ref, cycle);

CREATE INDEX purchase_document_lines_tenant_id_document_id_idx ON public.purchase_document_lines USING btree (tenant_id, document_id);

CREATE INDEX purchase_document_lines_tenant_id_source_line_id_idx ON public.purchase_document_lines USING btree (tenant_id, source_line_id);

CREATE INDEX purchase_documents_tenant_id_contact_id_idx ON public.purchase_documents USING btree (tenant_id, contact_id);

CREATE UNIQUE INDEX purchase_documents_tenant_id_kind_number_key ON public.purchase_documents USING btree (tenant_id, kind, number);

CREATE INDEX purchase_documents_tenant_id_kind_status_issue_date_idx ON public.purchase_documents USING btree (tenant_id, kind, status, issue_date);

CREATE INDEX purchase_documents_tenant_id_source_id_idx ON public.purchase_documents USING btree (tenant_id, source_id);

CREATE INDEX recurring_expenses_tenant_id_next_on_idx ON public.recurring_expenses USING btree (tenant_id, next_on);

CREATE UNIQUE INDEX role_field_access_role_id_entity_field_key ON public.role_field_access USING btree (role_id, entity, field);

CREATE INDEX roles_tenant_id_idx ON public.roles USING btree (tenant_id);

CREATE UNIQUE INDEX roles_tenant_key_uq ON public.roles USING btree (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

CREATE INDEX sales_document_lines_tenant_id_document_id_idx ON public.sales_document_lines USING btree (tenant_id, document_id);

CREATE INDEX sales_document_lines_tenant_id_source_line_id_idx ON public.sales_document_lines USING btree (tenant_id, source_line_id);

CREATE UNIQUE INDEX sales_documents_one_opening_balance ON public.sales_documents USING btree (tenant_id, contact_id) WHERE ((note_type = 'opening'::text) AND (status <> 'cancelled'::public.sales_doc_status));

CREATE UNIQUE INDEX sales_documents_share_token_key ON public.sales_documents USING btree (share_token);

CREATE INDEX sales_documents_tenant_id_contact_id_idx ON public.sales_documents USING btree (tenant_id, contact_id);

CREATE UNIQUE INDEX sales_documents_tenant_id_kind_number_key ON public.sales_documents USING btree (tenant_id, kind, number);

CREATE INDEX sales_documents_tenant_id_kind_status_issue_date_idx ON public.sales_documents USING btree (tenant_id, kind, status, issue_date);

CREATE INDEX sales_documents_tenant_id_location_id_idx ON public.sales_documents USING btree (tenant_id, location_id);

CREATE INDEX sales_documents_tenant_id_source_id_idx ON public.sales_documents USING btree (tenant_id, source_id);

CREATE INDEX sign_in_events_created_at_idx ON public.sign_in_events USING btree (created_at);

CREATE INDEX sign_in_events_user_id_idx ON public.sign_in_events USING btree (user_id, created_at);

CREATE INDEX staff_hours_tenant_id_user_id_idx ON public.staff_hours USING btree (tenant_id, user_id);

CREATE INDEX staff_time_off_tenant_id_from_at_idx ON public.staff_time_off USING btree (tenant_id, from_at);

CREATE INDEX stock_balances_tenant_id_idx ON public.stock_balances USING btree (tenant_id);

CREATE INDEX stock_batch_balances_tenant_id_idx ON public.stock_batch_balances USING btree (tenant_id);

CREATE UNIQUE INDEX stock_batches_item_id_number_key ON public.stock_batches USING btree (item_id, number);

CREATE INDEX stock_batches_tenant_id_expiry_date_idx ON public.stock_batches USING btree (tenant_id, expiry_date);

CREATE INDEX stock_entries_tenant_id_entry_date_idx ON public.stock_entries USING btree (tenant_id, entry_date);

CREATE INDEX stock_layers_item_id_location_id_received_on_idx ON public.stock_layers USING btree (item_id, location_id, received_on);

CREATE INDEX stock_layers_tenant_id_idx ON public.stock_layers USING btree (tenant_id);

CREATE UNIQUE INDEX stock_locations_tenant_id_name_key ON public.stock_locations USING btree (tenant_id, name);

CREATE UNIQUE INDEX stock_moves_reverses_id_key ON public.stock_moves USING btree (reverses_id);

CREATE INDEX stock_moves_tenant_id_item_id_location_id_created_at_idx ON public.stock_moves USING btree (tenant_id, item_id, location_id, created_at);

CREATE INDEX stock_moves_tenant_id_source_id_idx ON public.stock_moves USING btree (tenant_id, source_id);

CREATE UNIQUE INDEX stock_serials_item_id_serial_key ON public.stock_serials USING btree (item_id, serial);

CREATE INDEX stock_serials_tenant_id_serial_idx ON public.stock_serials USING btree (tenant_id, serial);

CREATE INDEX subscriptions_status_trial_ends_at_idx ON public.subscriptions USING btree (status, trial_ends_at);

CREATE UNIQUE INDEX subscriptions_tenant_id_key ON public.subscriptions USING btree (tenant_id);

CREATE UNIQUE INDEX supplier_payments_reverses_id_key ON public.supplier_payments USING btree (reverses_id);

CREATE INDEX supplier_payments_tenant_id_contact_id_idx ON public.supplier_payments USING btree (tenant_id, contact_id);

CREATE INDEX supplier_payments_tenant_id_document_id_idx ON public.supplier_payments USING btree (tenant_id, document_id);

CREATE INDEX support_messages_ticket_id_created_at_idx ON public.support_messages USING btree (ticket_id, created_at);

CREATE UNIQUE INDEX support_settings_slug_key ON public.support_settings USING btree (slug);

CREATE UNIQUE INDEX support_tickets_public_token_key ON public.support_tickets USING btree (public_token);

CREATE INDEX support_tickets_tenant_id_contact_id_idx ON public.support_tickets USING btree (tenant_id, contact_id);

CREATE UNIQUE INDEX support_tickets_tenant_id_number_key ON public.support_tickets USING btree (tenant_id, number);

CREATE INDEX support_tickets_tenant_id_status_idx ON public.support_tickets USING btree (tenant_id, status);

CREATE INDEX task_events_tenant_id_task_id_at_idx ON public.task_events USING btree (tenant_id, task_id, at);

CREATE UNIQUE INDEX task_projects_tenant_id_name_key ON public.task_projects USING btree (tenant_id, name);

CREATE INDEX task_times_tenant_id_task_id_idx ON public.task_times USING btree (tenant_id, task_id);

CREATE INDEX task_times_tenant_id_work_date_idx ON public.task_times USING btree (tenant_id, work_date);

CREATE INDEX tasks_tenant_id_assignee_id_idx ON public.tasks USING btree (tenant_id, assignee_id);

CREATE INDEX tasks_tenant_id_parent_id_idx ON public.tasks USING btree (tenant_id, parent_id);

CREATE INDEX tasks_tenant_id_project_id_idx ON public.tasks USING btree (tenant_id, project_id);

CREATE INDEX tasks_tenant_id_status_due_at_idx ON public.tasks USING btree (tenant_id, status, due_at);

CREATE INDEX tenant_acquisitions_acquired_by_user_id_idx ON public.tenant_acquisitions USING btree (acquired_by_user_id);

CREATE INDEX tenant_members_tenant_id_role_id_idx ON public.tenant_members USING btree (tenant_id, role_id);

CREATE UNIQUE INDEX tenant_members_tenant_id_user_id_key ON public.tenant_members USING btree (tenant_id, user_id);

CREATE INDEX tenant_members_user_id_idx ON public.tenant_members USING btree (user_id);

CREATE INDEX tenants_partner_id_idx ON public.tenants USING btree (partner_id);

CREATE INDEX tenants_source_idx ON public.tenants USING btree (source);

CREATE INDEX tenants_status_idx ON public.tenants USING btree (status);

CREATE INDEX trial_registry_email_hash_idx ON public.trial_registry USING btree (email_hash);

CREATE INDEX trial_registry_gstin_idx ON public.trial_registry USING btree (gstin);

CREATE INDEX trial_registry_mobile_hash_idx ON public.trial_registry USING btree (mobile_hash);

CREATE INDEX user_password_history_user_id_idx ON public.user_password_history USING btree (user_id, created_at);

CREATE INDEX user_sessions_family_id_idx ON public.user_sessions USING btree (family_id);

CREATE UNIQUE INDEX user_sessions_refresh_token_hash_key ON public.user_sessions USING btree (refresh_token_hash);

CREATE INDEX user_sessions_user_id_revoked_at_idx ON public.user_sessions USING btree (user_id, revoked_at);

CREATE UNIQUE INDEX user_trusted_devices_token_hash_key ON public.user_trusted_devices USING btree (token_hash);

CREATE INDEX user_trusted_devices_user_id_idx ON public.user_trusted_devices USING btree (user_id);

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

CREATE UNIQUE INDEX users_mobile_key ON public.users USING btree (mobile);

CREATE UNIQUE INDEX webhook_events_event_id_key ON public.webhook_events USING btree (event_id);

ALTER TABLE ONLY public.access_links
    ADD CONSTRAINT access_links_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.access_links
    ADD CONSTRAINT access_links_user_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.advance_adjustments
    ADD CONSTRAINT advance_adjustments_credit_note_id_fkey FOREIGN KEY (credit_note_id) REFERENCES public.sales_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.advance_adjustments
    ADD CONSTRAINT advance_adjustments_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.sales_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.advance_adjustments
    ADD CONSTRAINT advance_adjustments_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments_received(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.advance_adjustments
    ADD CONSTRAINT advance_adjustments_reverses_id_fkey FOREIGN KEY (reverses_id) REFERENCES public.advance_adjustments(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.console_followups
    ADD CONSTRAINT console_followups_prospect_fkey FOREIGN KEY (prospect_id) REFERENCES public.console_prospects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.console_notes
    ADD CONSTRAINT console_notes_prospect_fkey FOREIGN KEY (prospect_id) REFERENCES public.console_prospects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES public.price_lists(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.payments_received
    ADD CONSTRAINT payments_received_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.sales_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.payments_received
    ADD CONSTRAINT payments_received_reverses_id_fkey FOREIGN KEY (reverses_id) REFERENCES public.payments_received(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.payroll_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_drafts
    ADD CONSTRAINT plan_drafts_plan_fkey FOREIGN KEY (plan_key) REFERENCES public.plans(key) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_modules
    ADD CONSTRAINT plan_modules_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.platform_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.platform_members
    ADD CONSTRAINT platform_members_partner_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id);

ALTER TABLE ONLY public.platform_members
    ADD CONSTRAINT platform_members_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.platform_members
    ADD CONSTRAINT platform_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.platform_payments
    ADD CONSTRAINT platform_payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.platform_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.pos_cash_moves
    ADD CONSTRAINT pos_cash_moves_shift_fkey FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id);

ALTER TABLE ONLY public.pos_held_bills
    ADD CONSTRAINT pos_held_bills_counter_fkey FOREIGN KEY (counter_id) REFERENCES public.pos_counters(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_counter_fkey FOREIGN KEY (counter_id) REFERENCES public.pos_counters(id);

ALTER TABLE ONLY public.price_list_items
    ADD CONSTRAINT price_list_items_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES public.price_lists(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_document_lines
    ADD CONSTRAINT purchase_document_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.purchase_documents(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.role_field_access
    ADD CONSTRAINT role_field_access_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.sales_document_lines
    ADD CONSTRAINT sales_document_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.sales_documents(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.scheduled_changes
    ADD CONSTRAINT scheduled_changes_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.subscription_items
    ADD CONSTRAINT subscription_items_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_ticket_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tenant_acquisitions
    ADD CONSTRAINT tenant_acquisitions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.tenant_module_overrides
    ADD CONSTRAINT tenant_module_overrides_module_fkey FOREIGN KEY (module_key) REFERENCES public.modules(key);

ALTER TABLE ONLY public.tenant_module_overrides
    ADD CONSTRAINT tenant_module_overrides_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_partner_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id);

ALTER TABLE ONLY public.user_mfa
    ADD CONSTRAINT user_mfa_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_password_history
    ADD CONSTRAINT user_password_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_trusted_devices
    ADD CONSTRAINT user_trusted_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.advance_adjustments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_resources ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_services ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.credit_balances ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_options ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_pipelines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_stages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.field_definitions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fin_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fin_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fin_cleared ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fin_ledgers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fin_transfers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.form_layouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_acks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_actions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_candidates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_departments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_designations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_goals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_interviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_loans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_overtime ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_posts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_reviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_salary_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_shifts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hr_trainings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.incomes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.item_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.journals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.leave_applications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payments_received ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.portal_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pos_cash_moves ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pos_counters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pos_held_bills ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.price_list_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_document_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.purchase_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_field_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_read ON public.role_field_access FOR SELECT USING (((tenant_id IS NULL) OR (tenant_id = public.app_tenant())));

CREATE POLICY role_read ON public.role_permissions FOR SELECT USING (((tenant_id IS NULL) OR (tenant_id = public.app_tenant())));

CREATE POLICY role_read ON public.roles FOR SELECT USING (((tenant_id IS NULL) OR (tenant_id = public.app_tenant())));

CREATE POLICY role_write ON public.role_field_access USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY role_write ON public.role_permissions USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY role_write ON public.roles USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales_document_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.staff_hours ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.staff_time_off ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_batch_balances ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_layers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_serials ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.support_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_times ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.activities USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.advance_adjustments USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.appointments USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.approval_requests USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.attendance USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.audit_log USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.booking_resources USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.booking_services USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.booking_settings USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.branches USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.contacts USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.credit_balances USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.crm_options USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.crm_pipelines USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.crm_products USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.crm_stages USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.deals USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.employees USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.expenses USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.field_definitions USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.files USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.fin_accounts USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.fin_categories USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.fin_cleared USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.fin_ledgers USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.fin_transfers USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.form_layouts USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.holidays USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_acks USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_actions USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_candidates USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_departments USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_designations USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_goals USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_interviews USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_jobs USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_loans USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_overtime USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_posts USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_records USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_reviews USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_salary_items USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_settings USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_shifts USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.hr_trainings USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.incomes USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.invitations USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.item_categories USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.items USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.journal_lines USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.journals USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.kb_articles USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.leave_applications USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.leave_types USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.notification_log USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.notifications USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.outbox_events USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.payments_received USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.payroll_runs USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.payslips USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.portal_settings USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.pos_cash_moves USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.pos_counters USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.pos_held_bills USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.pos_shifts USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.price_list_items USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.price_lists USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.purchase_document_lines USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.purchase_documents USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.recurring_expenses USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.sales_document_lines USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.sales_documents USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.staff_hours USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.staff_time_off USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.stock_balances USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.stock_batch_balances USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.stock_batches USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.stock_entries USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.stock_layers USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.stock_locations USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.stock_moves USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.stock_serials USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.subscriptions USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.supplier_payments USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.support_messages USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.support_settings USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.support_tickets USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.task_events USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.task_projects USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.task_times USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.tasks USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.tenant_entitlements USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.tenant_members USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.tenant_module_overrides USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.tenant_role_settings USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.tenant_sequences USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.tenant_terms USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

CREATE POLICY tenant_isolation ON public.usage_counters USING ((tenant_id = public.app_tenant())) WITH CHECK ((tenant_id = public.app_tenant()));

ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_module_overrides ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_role_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_self ON public.tenants USING ((id = public.app_tenant())) WITH CHECK ((id = public.app_tenant()));

ALTER TABLE public.tenant_sequences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_terms ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.activities TO app_user;

GRANT SELECT,INSERT ON TABLE public.advance_adjustments TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.appointments TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.approval_requests TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.attendance TO app_user;

GRANT SELECT,INSERT ON TABLE public.audit_log TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booking_resources TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booking_services TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.booking_settings TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.branches TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.contacts TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.credit_balances TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_options TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_pipelines TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_products TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_stages TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.deals TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.employees TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.expenses TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.field_definitions TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.files TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_accounts TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_categories TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_cleared TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_ledgers TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fin_transfers TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.form_layouts TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.holidays TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_acks TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_actions TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_candidates TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_departments TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_designations TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_goals TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_interviews TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_jobs TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_loans TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_overtime TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_posts TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_records TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_reviews TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_salary_items TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_settings TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_shifts TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hr_trainings TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.incomes TO app_user;

GRANT SELECT ON TABLE public.industry_templates TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitations TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.item_categories TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.items TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.journal_lines TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.journals TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kb_articles TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leave_applications TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leave_types TO app_user;

GRANT SELECT ON TABLE public.modules TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_log TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.outbox_events TO app_user;

GRANT SELECT,INSERT ON TABLE public.payments_received TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payroll_runs TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payslips TO app_user;

GRANT SELECT ON TABLE public.permissions TO app_user;

GRANT SELECT ON TABLE public.plan_modules TO app_user;

GRANT SELECT ON TABLE public.plans TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_settings TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_cash_moves TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_counters TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_held_bills TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pos_shifts TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.price_list_items TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.price_lists TO app_user;

GRANT SELECT ON TABLE public.prices TO app_user;

GRANT SELECT,INSERT ON TABLE public.processed_events TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.purchase_document_lines TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.purchase_documents TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recurring_expenses TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_field_access TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_permissions TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roles TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sales_document_lines TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sales_documents TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.staff_hours TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.staff_time_off TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_balances TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_batch_balances TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_batches TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_entries TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_layers TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_locations TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_moves TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_serials TO app_user;

GRANT SELECT ON TABLE public.subscriptions TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.supplier_payments TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_messages TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_settings TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_tickets TO app_user;

GRANT SELECT,INSERT ON TABLE public.task_events TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_projects TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_times TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tasks TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_entitlements TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_members TO app_user;

GRANT SELECT ON TABLE public.tenant_module_overrides TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_role_settings TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_sequences TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_terms TO app_user;

GRANT SELECT,UPDATE ON TABLE public.tenants TO app_user;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.usage_counters TO app_user;

GRANT SELECT ON TABLE public.users TO app_user;
