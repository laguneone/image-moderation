CREATE TYPE "ReviewAction" AS ENUM ('APPROVED', 'REJECTED');

ALTER TABLE "moderation_jobs"
  ADD COLUMN "effective_decision" VARCHAR(32),
  ADD COLUMN "review_assignee_id" VARCHAR(64),
  ADD COLUMN "review_claimed_at" TIMESTAMP(3),
  ADD COLUMN "review_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "review_decisions" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "actor_id" VARCHAR(64) NOT NULL,
  "action" "ReviewAction" NOT NULL,
  "rejection_reason" VARCHAR(64),
  "comment" TEXT,
  "review_version" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "job_id" TEXT,
  "actor_id" VARCHAR(64),
  "action" VARCHAR(100) NOT NULL,
  "entity_type" VARCHAR(64) NOT NULL,
  "entity_id" VARCHAR(100) NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_decisions_job_id_created_at_idx" ON "review_decisions"("job_id", "created_at");
CREATE INDEX "audit_logs_job_id_created_at_idx" ON "audit_logs"("job_id", "created_at");
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "moderation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "moderation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
