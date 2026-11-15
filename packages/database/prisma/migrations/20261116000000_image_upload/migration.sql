-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "moderation_jobs" (
    "id" TEXT NOT NULL,
    "application_id" VARCHAR(64) NOT NULL,
    "image_asset_id" TEXT NOT NULL,
    "status" "ModerationStatus" NOT NULL DEFAULT 'QUEUED',
    "pipeline" VARCHAR(100) NOT NULL DEFAULT 'interior-default',
    "context" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(128),
    "error_code" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "moderation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_assets" (
    "id" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "original_name" VARCHAR(255),
    "size_bytes" BIGINT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "frame_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_results" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "moderation_jobs_idempotency_key_key" ON "moderation_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "moderation_jobs_application_id_created_at_idx" ON "moderation_jobs"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_jobs_status_created_at_idx" ON "moderation_jobs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "image_assets_sha256_key" ON "image_assets"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "image_assets_object_key_key" ON "image_assets"("object_key");

-- CreateIndex
CREATE INDEX "image_assets_created_at_idx" ON "image_assets"("created_at");

-- CreateIndex
CREATE INDEX "moderation_results_job_id_created_at_idx" ON "moderation_results"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "moderation_jobs" ADD CONSTRAINT "moderation_jobs_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "image_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_results" ADD CONSTRAINT "moderation_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "moderation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

