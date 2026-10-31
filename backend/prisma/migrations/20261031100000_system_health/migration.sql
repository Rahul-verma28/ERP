-- Console Phase F: System health. The worker records each scheduled job's last run, so the
-- Console can show when it ran, whether it failed and why, and run it again. Platform table.
CREATE TABLE "job_runs" (
  "name" TEXT NOT NULL,
  "last_started_at" TIMESTAMPTZ,
  "last_finished_at" TIMESTAMPTZ,
  "last_ok_at" TIMESTAMPTZ,
  "last_error" TEXT,
  "runs" INTEGER NOT NULL DEFAULT 0,
  "failures" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name")
);

-- A payment webhook that needed a person is marked handled once someone has dealt with it
ALTER TABLE "webhook_events" ADD COLUMN "resolved_at" TIMESTAMPTZ, ADD COLUMN "resolved_by" UUID;
