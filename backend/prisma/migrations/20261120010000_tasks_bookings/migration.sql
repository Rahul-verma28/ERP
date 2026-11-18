-- Tasks & Projects, and Appointments, made complete: projects, checklists, labels, time logs and
-- approvals; booking services, resources, staff hours, time off and an online booking page.

-- ── Tasks ──
CREATE TABLE "task_projects" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL, "code" VARCHAR(12), "description" TEXT,
  "contact_id" UUID, "owner_id" UUID, "member_ids" UUID[] NOT NULL DEFAULT '{}',
  "status" VARCHAR(12) NOT NULL DEFAULT 'active', "start_on" DATE, "due_on" DATE, "budget_paise" BIGINT,
  "billable" BOOLEAN NOT NULL DEFAULT false, "hourly_rate_paise" BIGINT, "color" VARCHAR(12) NOT NULL DEFAULT 'blue',
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "task_projects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_projects_tenant_id_name_key" ON "task_projects" ("tenant_id", "name");

ALTER TABLE "tasks" ADD COLUMN "project_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "tasks" ADD COLUMN "start_on" DATE;
ALTER TABLE "tasks" ADD COLUMN "estimate_min" INTEGER;
ALTER TABLE "tasks" ADD COLUMN "checklist" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "tasks" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN "repeat" VARCHAR(10) NOT NULL DEFAULT 'none';
CREATE INDEX "tasks_tenant_id_project_id_idx" ON "tasks" ("tenant_id", "project_id");

CREATE TABLE "task_times" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "task_id" UUID, "project_id" UUID, "user_id" UUID NOT NULL,
  "work_date" DATE NOT NULL, "minutes" INTEGER NOT NULL, "note" TEXT, "billable" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "task_times_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_times_minutes_check" CHECK ("minutes" > 0 AND "minutes" <= 1440)
);
CREATE INDEX "task_times_tenant_id_work_date_idx" ON "task_times" ("tenant_id", "work_date");
CREATE INDEX "task_times_tenant_id_task_id_idx" ON "task_times" ("tenant_id", "task_id");

CREATE TABLE "approval_requests" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "number" VARCHAR(20) NOT NULL, "title" TEXT NOT NULL,
  "kind" VARCHAR(20) NOT NULL DEFAULT 'other', "amount_paise" BIGINT, "details" TEXT, "attachment_url" TEXT,
  "requested_by" UUID NOT NULL, "approver_id" UUID NOT NULL, "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
  "need_by" DATE, "decided_at" TIMESTAMPTZ, "decision_note" TEXT, "task_id" UUID, "project_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "approval_requests_tenant_id_number_key" ON "approval_requests" ("tenant_id", "number");
CREATE INDEX "approval_requests_tenant_id_status_idx" ON "approval_requests" ("tenant_id", "status");

-- ── Appointments ──
ALTER TABLE "appointments" ADD COLUMN "resource_id" UUID;
ALTER TABLE "appointments" ADD COLUMN "source" VARCHAR(12) NOT NULL DEFAULT 'walk_in';
ALTER TABLE "appointments" ADD COLUMN "guest_name" TEXT;
ALTER TABLE "appointments" ADD COLUMN "guest_phone" VARCHAR(15);
ALTER TABLE "appointments" ADD COLUMN "price_paise" BIGINT;
ALTER TABLE "appointments" ADD COLUMN "cancel_reason" TEXT;
ALTER TABLE "appointments" ADD COLUMN "confirmed_at" TIMESTAMPTZ;
ALTER TABLE "appointments" ADD COLUMN "checked_in_at" TIMESTAMPTZ;
ALTER TABLE "appointments" ADD COLUMN "reminded_at" TIMESTAMPTZ;

-- A room, chair or machine can't be booked twice at once either (database-enforced)
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_resource
  EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, tstzrange(start_at, end_at) WITH &&)
  WHERE (resource_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show'));

CREATE TABLE "booking_services" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "item_id" UUID NOT NULL, "duration_min" INTEGER NOT NULL DEFAULT 30,
  "buffer_min" INTEGER NOT NULL DEFAULT 0, "color" VARCHAR(12) NOT NULL DEFAULT 'blue', "staff_ids" UUID[] NOT NULL DEFAULT '{}',
  "resource_kind" VARCHAR(12), "online" BOOLEAN NOT NULL DEFAULT true, "is_active" BOOLEAN NOT NULL DEFAULT true, "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "booking_services_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "booking_services_tenant_id_item_id_key" ON "booking_services" ("tenant_id", "item_id");

CREATE TABLE "booking_resources" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" TEXT NOT NULL, "kind" VARCHAR(12) NOT NULL DEFAULT 'room',
  "capacity" INTEGER NOT NULL DEFAULT 1, "color" VARCHAR(12) NOT NULL DEFAULT 'slate', "notes" TEXT, "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "booking_resources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "booking_resources_tenant_id_name_key" ON "booking_resources" ("tenant_id", "name");

-- Working hours: one row per staff, weekday (0 = Sunday) and stretch; two rows make a split shift
CREATE TABLE "staff_hours" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "user_id" UUID NOT NULL, "weekday" SMALLINT NOT NULL,
  "start_min" INTEGER NOT NULL, "end_min" INTEGER NOT NULL,
  CONSTRAINT "staff_hours_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_hours_range_check" CHECK ("weekday" BETWEEN 0 AND 6 AND "start_min" >= 0 AND "end_min" <= 1440 AND "end_min" > "start_min")
);
CREATE INDEX "staff_hours_tenant_id_user_id_idx" ON "staff_hours" ("tenant_id", "user_id");

CREATE TABLE "staff_time_off" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "user_id" UUID NOT NULL, "from_at" TIMESTAMPTZ NOT NULL, "to_at" TIMESTAMPTZ NOT NULL,
  "reason" TEXT, "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "staff_time_off_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_time_off_range_check" CHECK ("to_at" > "from_at")
);
CREATE INDEX "staff_time_off_tenant_id_from_at_idx" ON "staff_time_off" ("tenant_id", "from_at");

CREATE TABLE "booking_settings" (
  "tenant_id" UUID NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false, "slug" VARCHAR(40) NOT NULL, "title" TEXT NOT NULL,
  "intro" TEXT, "slot_step_min" INTEGER NOT NULL DEFAULT 30, "lead_min" INTEGER NOT NULL DEFAULT 60, "max_days_ahead" INTEGER NOT NULL DEFAULT 30,
  "auto_confirm" BOOLEAN NOT NULL DEFAULT false, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("tenant_id")
);
CREATE UNIQUE INDEX "booking_settings_slug_key" ON "booking_settings" ("slug");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_projects', 'task_times', 'approval_requests', 'booking_services', 'booking_resources', 'staff_hours', 'staff_time_off', 'booking_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
