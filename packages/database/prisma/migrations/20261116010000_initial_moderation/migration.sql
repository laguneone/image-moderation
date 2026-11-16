CREATE TYPE "StageStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "moderation_results"
  ADD COLUMN "nsfw_risk_score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "domain_mismatch_score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "decision" VARCHAR(32) NOT NULL DEFAULT 'REVIEW',
  ADD COLUMN "critical_flags" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "reasons" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "moderation_results"
  ALTER COLUMN "nsfw_risk_score" DROP DEFAULT,
  ALTER COLUMN "domain_mismatch_score" DROP DEFAULT,
  ALTER COLUMN "decision" DROP DEFAULT;

CREATE TABLE "stage_executions" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "stage_type" VARCHAR(64) NOT NULL,
  "status" "StageStatus" NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "model_id" VARCHAR(200),
  "prompt_version_id" VARCHAR(64),
  "normalized_output" JSONB,
  "error" TEXT,
  CONSTRAINT "stage_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "model_invocations" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "stage_execution_id" TEXT,
  "model_id" VARCHAR(200) NOT NULL,
  "provider" VARCHAR(100),
  "request_id" VARCHAR(200),
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "cost_usd" DECIMAL(18,10),
  "latency_ms" INTEGER NOT NULL,
  "status" "StageStatus" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_invocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stage_executions_job_id_started_at_idx" ON "stage_executions"("job_id", "started_at");
CREATE INDEX "model_invocations_job_id_created_at_idx" ON "model_invocations"("job_id", "created_at");

ALTER TABLE "stage_executions" ADD CONSTRAINT "stage_executions_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "moderation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "model_invocations" ADD CONSTRAINT "model_invocations_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "moderation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "model_invocations" ADD CONSTRAINT "model_invocations_stage_execution_id_fkey"
  FOREIGN KEY ("stage_execution_id") REFERENCES "stage_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
