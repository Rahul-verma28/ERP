-- Scheduled jobs: a lease so the same job never runs twice at once (two servers, or "Run now"
-- while the hourly run is going), and what the last run did ("40 done, 2 failed").
ALTER TABLE "job_runs" ADD COLUMN "locked_until" TIMESTAMPTZ;
ALTER TABLE "job_runs" ADD COLUMN "last_summary" TEXT;

-- Background events: a claimed event is only "published" once its consumers succeed. A claim
-- is a short lease (a crash mid-way makes it claimable again), and a failure waits longer
-- before each retry instead of being retried at once.
ALTER TABLE "outbox_events" ADD COLUMN "locked_until" TIMESTAMPTZ;
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" TIMESTAMPTZ;
CREATE INDEX "outbox_events_due_idx" ON "outbox_events" ("occurred_at") WHERE "published_at" IS NULL;
