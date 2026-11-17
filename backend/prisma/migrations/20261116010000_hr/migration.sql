-- HR & Payroll: employees, attendance, leave, payroll with Indian statutory deductions,
-- career records, workplace (announcements, events, documents), performance, training, recruitment.

CREATE TABLE "hr_settings" (
  "tenant_id" UUID NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "hr_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "hr_departments" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL, "branch_id" UUID, "head_id" UUID,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "hr_departments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_departments_tenant_id_name_key" ON "hr_departments" ("tenant_id", "name");

CREATE TABLE "hr_designations" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL, "department_id" UUID,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "hr_designations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_designations_tenant_id_name_key" ON "hr_designations" ("tenant_id", "name");

CREATE TABLE "hr_shifts" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL,
  "starts_at" VARCHAR(5) NOT NULL, "ends_at" VARCHAR(5) NOT NULL, "break_minutes" INTEGER NOT NULL DEFAULT 0,
  "grace_minutes" INTEGER NOT NULL DEFAULT 0, "is_night" BOOLEAN NOT NULL DEFAULT false, "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "hr_shifts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employees" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "code" TEXT NOT NULL,
  "name" TEXT NOT NULL, "email" TEXT, "phone" VARCHAR(15), "gender" VARCHAR(10), "dob" DATE, "photo_url" TEXT,
  "member_id" UUID, "branch_id" UUID, "department_id" UUID, "designation_id" UUID, "manager_id" UUID, "shift_id" UUID,
  "employment_type" VARCHAR(12) NOT NULL DEFAULT 'full_time', "joined_on" DATE NOT NULL, "probation_ends_on" DATE,
  "status" VARCHAR(10) NOT NULL DEFAULT 'active', "exit_on" DATE, "exit_reason" TEXT,
  "address" JSONB, "emergency" JSONB, "bank" JSONB,
  "pan" VARCHAR(10), "aadhaar_last4" VARCHAR(4), "uan" VARCHAR(12), "esi_no" VARCHAR(17),
  "basic_paise" BIGINT NOT NULL DEFAULT 0, "pay_type" VARCHAR(8) NOT NULL DEFAULT 'monthly',
  "pf" BOOLEAN NOT NULL DEFAULT false, "esi" BOOLEAN NOT NULL DEFAULT false, "pt" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT, "version" INTEGER NOT NULL DEFAULT 1, "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employees_tenant_id_code_key" ON "employees" ("tenant_id", "code");
CREATE INDEX "employees_tenant_id_status_idx" ON "employees" ("tenant_id", "status");
CREATE INDEX "employees_member_id_idx" ON "employees" ("member_id");

CREATE TABLE "hr_salary_items" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "employee_id" UUID NOT NULL,
  "kind" VARCHAR(10) NOT NULL, "name" TEXT NOT NULL, "calc" VARCHAR(10) NOT NULL DEFAULT 'fixed',
  "amount" BIGINT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "hr_salary_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_salary_items_employee_id_idx" ON "hr_salary_items" ("employee_id");

CREATE TABLE "hr_loans" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "title" TEXT NOT NULL,
  "kind" VARCHAR(10) NOT NULL DEFAULT 'advance', "amount_paise" BIGINT NOT NULL, "emi_paise" BIGINT NOT NULL,
  "given_on" DATE NOT NULL, "starts_month" VARCHAR(7) NOT NULL, "account_id" UUID, "journal_id" UUID,
  "status" VARCHAR(10) NOT NULL DEFAULT 'active', "reason" TEXT, "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "hr_loans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_loans_employee_id_idx" ON "hr_loans" ("employee_id");

CREATE TABLE "hr_overtime" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "work_on" DATE NOT NULL,
  "hours" DECIMAL(6,2) NOT NULL, "rate_paise" BIGINT NOT NULL, "notes" TEXT,
  "status" VARCHAR(10) NOT NULL DEFAULT 'approved', "payslip_id" UUID, "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "hr_overtime_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_overtime_tenant_id_work_on_idx" ON "hr_overtime" ("tenant_id", "work_on");

CREATE TABLE "attendance" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "date" DATE NOT NULL,
  "status" VARCHAR(10) NOT NULL, "clock_in" VARCHAR(5), "clock_out" VARCHAR(5),
  "worked_minutes" INTEGER NOT NULL DEFAULT 0, "late_minutes" INTEGER NOT NULL DEFAULT 0, "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
  "source" VARCHAR(8) NOT NULL DEFAULT 'manual', "notes" TEXT, "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_employee_id_date_key" ON "attendance" ("employee_id", "date");
CREATE INDEX "attendance_tenant_id_date_idx" ON "attendance" ("tenant_id", "date");

CREATE TABLE "leave_types" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL, "code" VARCHAR(6) NOT NULL,
  "days_per_year" DECIMAL(5,1) NOT NULL DEFAULT 0, "paid" BOOLEAN NOT NULL DEFAULT true, "carry_forward" BOOLEAN NOT NULL DEFAULT false,
  "color" VARCHAR(12) NOT NULL DEFAULT 'blue', "is_active" BOOLEAN NOT NULL DEFAULT true, "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "leave_types_tenant_id_name_key" ON "leave_types" ("tenant_id", "name");

CREATE TABLE "leave_applications" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "leave_type_id" UUID NOT NULL,
  "from_date" DATE NOT NULL, "to_date" DATE NOT NULL, "half_day" BOOLEAN NOT NULL DEFAULT false, "days" DECIMAL(5,1) NOT NULL,
  "reason" TEXT NOT NULL, "status" VARCHAR(10) NOT NULL DEFAULT 'pending', "comment" TEXT,
  "decided_by" UUID, "decided_at" TIMESTAMPTZ, "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "leave_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leave_applications_tenant_id_from_date_idx" ON "leave_applications" ("tenant_id", "from_date");
CREATE INDEX "leave_applications_employee_id_idx" ON "leave_applications" ("employee_id");

CREATE TABLE "holidays" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL, "from_date" DATE NOT NULL, "to_date" DATE NOT NULL,
  "kind" VARCHAR(12) NOT NULL DEFAULT 'festival', "paid" BOOLEAN NOT NULL DEFAULT true, "optional" BOOLEAN NOT NULL DEFAULT false, "notes" TEXT,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "holidays_tenant_id_from_date_idx" ON "holidays" ("tenant_id", "from_date");

CREATE TABLE "payroll_runs" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "number" TEXT NOT NULL, "month" VARCHAR(7) NOT NULL,
  "period_from" DATE NOT NULL, "period_to" DATE NOT NULL, "pay_date" DATE NOT NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'draft', "account_id" UUID, "notes" TEXT,
  "employees" INTEGER NOT NULL DEFAULT 0, "gross_paise" BIGINT NOT NULL DEFAULT 0, "deductions_paise" BIGINT NOT NULL DEFAULT 0,
  "net_paise" BIGINT NOT NULL DEFAULT 0, "employer_paise" BIGINT NOT NULL DEFAULT 0, "paid_paise" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1, "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_runs_tenant_id_month_key" ON "payroll_runs" ("tenant_id", "month");

CREATE TABLE "payslips" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "run_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "number" TEXT NOT NULL,
  "days_in_month" INTEGER NOT NULL, "payable_days" DECIMAL(5,1) NOT NULL, "lop_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
  "basic_paise" BIGINT NOT NULL DEFAULT 0, "earnings" JSONB NOT NULL DEFAULT '[]', "deductions" JSONB NOT NULL DEFAULT '[]', "employer" JSONB NOT NULL DEFAULT '[]',
  "gross_paise" BIGINT NOT NULL DEFAULT 0, "deductions_paise" BIGINT NOT NULL DEFAULT 0, "net_paise" BIGINT NOT NULL DEFAULT 0, "employer_paise" BIGINT NOT NULL DEFAULT 0,
  "status" VARCHAR(8) NOT NULL DEFAULT 'unpaid', "paid_on" DATE, "account_id" UUID, "journal_id" UUID, "snapshot" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "payslips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payslips_run_id_employee_id_key" ON "payslips" ("run_id", "employee_id");
CREATE INDEX "payslips_employee_id_idx" ON "payslips" ("employee_id");

CREATE TABLE "hr_actions" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "kind" VARCHAR(12) NOT NULL, "employee_id" UUID NOT NULL, "against_id" UUID,
  "on_date" DATE NOT NULL, "effective_on" DATE, "type_name" TEXT, "subject" TEXT, "description" TEXT, "severity" VARCHAR(8),
  "from_data" JSONB, "to_data" JSONB, "status" VARCHAR(12) NOT NULL DEFAULT 'pending', "response" TEXT, "document_url" TEXT,
  "decided_by" UUID, "decided_at" TIMESTAMPTZ, "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "hr_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_actions_tenant_id_kind_idx" ON "hr_actions" ("tenant_id", "kind");
CREATE INDEX "hr_actions_employee_id_idx" ON "hr_actions" ("employee_id");

CREATE TABLE "hr_posts" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "kind" VARCHAR(12) NOT NULL, "title" TEXT NOT NULL, "category" TEXT,
  "body" TEXT, "starts_on" DATE, "ends_on" DATE, "starts_at" VARCHAR(5), "ends_at" VARCHAR(5), "location" TEXT,
  "priority" VARCHAR(8) NOT NULL DEFAULT 'normal', "department_ids" UUID[] NOT NULL DEFAULT '{}', "url" TEXT,
  "needs_ack" BOOLEAN NOT NULL DEFAULT false, "status" VARCHAR(10) NOT NULL DEFAULT 'active', "color" VARCHAR(12),
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "hr_posts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_posts_tenant_id_kind_idx" ON "hr_posts" ("tenant_id", "kind");

CREATE TABLE "hr_acks" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "post_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "acked_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "hr_acks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_acks_post_id_employee_id_key" ON "hr_acks" ("post_id", "employee_id");

CREATE TABLE "hr_goals" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "title" TEXT NOT NULL, "goal_type" TEXT,
  "description" TEXT, "target" TEXT, "starts_on" DATE NOT NULL, "ends_on" DATE NOT NULL, "progress" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(12) NOT NULL DEFAULT 'not_started', "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "hr_goals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_goals_tenant_id_idx" ON "hr_goals" ("tenant_id");

CREATE TABLE "hr_reviews" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "reviewer_id" UUID, "cycle" TEXT NOT NULL,
  "review_on" DATE NOT NULL, "ratings" JSONB NOT NULL DEFAULT '{}', "rating" DECIMAL(3,1), "strengths" TEXT, "improve" TEXT,
  "status" VARCHAR(12) NOT NULL DEFAULT 'pending', "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "hr_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_reviews_tenant_id_idx" ON "hr_reviews" ("tenant_id");

CREATE TABLE "hr_trainings" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "title" TEXT NOT NULL, "training_type" TEXT, "trainer" TEXT,
  "starts_on" DATE NOT NULL, "ends_on" DATE NOT NULL, "location" TEXT, "cost_paise" BIGINT NOT NULL DEFAULT 0,
  "employee_ids" UUID[] NOT NULL DEFAULT '{}', "description" TEXT, "status" VARCHAR(10) NOT NULL DEFAULT 'scheduled',
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "hr_trainings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_trainings_tenant_id_idx" ON "hr_trainings" ("tenant_id");

CREATE TABLE "hr_jobs" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "title" TEXT NOT NULL, "department_id" UUID, "branch_id" UUID, "location" TEXT,
  "employment_type" VARCHAR(12) NOT NULL DEFAULT 'full_time', "positions" INTEGER NOT NULL DEFAULT 1,
  "min_exp" INTEGER, "max_exp" INTEGER, "min_salary_paise" BIGINT, "max_salary_paise" BIGINT, "skills" TEXT[] NOT NULL DEFAULT '{}',
  "description" TEXT, "closes_on" DATE, "status" VARCHAR(8) NOT NULL DEFAULT 'open',
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "hr_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_jobs_tenant_id_idx" ON "hr_jobs" ("tenant_id");

CREATE TABLE "hr_candidates" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "job_id" UUID NOT NULL, "name" TEXT NOT NULL, "email" TEXT, "phone" VARCHAR(15),
  "source" TEXT, "experience" DECIMAL(4,1), "current_ctc_paise" BIGINT, "expected_ctc_paise" BIGINT, "resume_url" TEXT,
  "stage" VARCHAR(10) NOT NULL DEFAULT 'applied', "rating" INTEGER, "notes" TEXT, "employee_id" UUID,
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "hr_candidates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_candidates_tenant_id_job_id_idx" ON "hr_candidates" ("tenant_id", "job_id");

CREATE TABLE "hr_interviews" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "candidate_id" UUID NOT NULL, "round" TEXT NOT NULL,
  "on_date" DATE NOT NULL, "at_time" VARCHAR(5), "mode" VARCHAR(10) NOT NULL DEFAULT 'in_person', "interviewer_ids" UUID[] NOT NULL DEFAULT '{}',
  "result" VARCHAR(10) NOT NULL DEFAULT 'scheduled', "rating" INTEGER, "feedback" TEXT,
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "hr_interviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_interviews_tenant_id_on_date_idx" ON "hr_interviews" ("tenant_id", "on_date");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr_settings', 'hr_departments', 'hr_designations', 'hr_shifts', 'employees', 'hr_salary_items', 'hr_loans', 'hr_overtime',
    'attendance', 'leave_types', 'leave_applications', 'holidays', 'payroll_runs', 'payslips', 'hr_actions', 'hr_posts', 'hr_acks',
    'hr_goals', 'hr_reviews', 'hr_trainings', 'hr_jobs', 'hr_candidates', 'hr_interviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
