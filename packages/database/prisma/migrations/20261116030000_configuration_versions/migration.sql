CREATE TYPE "ConfigStatus" AS ENUM ('DRAFT', 'TESTING', 'ACTIVE', 'ARCHIVED');

ALTER TABLE "moderation_jobs" ADD COLUMN "pipeline_version_id" TEXT;

CREATE TABLE "model_configurations" (
    "id" TEXT NOT NULL, "key" VARCHAR(64) NOT NULL, "version" INTEGER NOT NULL, "name" VARCHAR(120) NOT NULL,
    "role" VARCHAR(64) NOT NULL, "openrouter_model_id" VARCHAR(200) NOT NULL, "status" "ConfigStatus" NOT NULL DEFAULT 'DRAFT',
    "input_modalities" TEXT[] DEFAULT ARRAY['image', 'text']::TEXT[], "structured_output" BOOLEAN NOT NULL DEFAULT false,
    "generation_params" JSONB NOT NULL DEFAULT '{}', "timeout_ms" INTEGER NOT NULL DEFAULT 90000, "max_tokens" INTEGER,
    "max_cost_usd" DECIMAL(12,6), "fallback_model_id" VARCHAR(200), "created_by" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "model_configurations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL, "key" VARCHAR(64) NOT NULL, "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL, "template_id" TEXT NOT NULL, "version" INTEGER NOT NULL, "model_role" VARCHAR(64) NOT NULL,
    "content" TEXT NOT NULL, "status" "ConfigStatus" NOT NULL DEFAULT 'DRAFT', "created_by" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "pipeline_versions" (
    "id" TEXT NOT NULL, "pipeline_key" VARCHAR(100) NOT NULL, "version" INTEGER NOT NULL, "name" VARCHAR(120) NOT NULL,
    "status" "ConfigStatus" NOT NULL DEFAULT 'DRAFT', "configuration" JSONB NOT NULL DEFAULT '{}', "created_by" VARCHAR(64),
    "published_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pipeline_versions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "rule_versions" (
    "id" TEXT NOT NULL, "key" VARCHAR(64) NOT NULL, "version" INTEGER NOT NULL, "name" VARCHAR(120) NOT NULL,
    "description" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" JSONB NOT NULL, "actions" JSONB NOT NULL, "application_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ConfigStatus" NOT NULL DEFAULT 'DRAFT', "created_by" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "rule_versions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "configuration_audit_logs" (
    "id" TEXT NOT NULL, "actor_id" VARCHAR(64), "entity_type" VARCHAR(64) NOT NULL, "entity_id" VARCHAR(100) NOT NULL,
    "action" VARCHAR(100) NOT NULL, "before" JSONB, "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "configuration_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "model_configurations_key_status_idx" ON "model_configurations"("key", "status");
CREATE UNIQUE INDEX "model_configurations_key_version_key" ON "model_configurations"("key", "version");
CREATE UNIQUE INDEX "model_configurations_one_active_per_key" ON "model_configurations"("key") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "prompt_templates_key_key" ON "prompt_templates"("key");
CREATE INDEX "prompt_versions_template_id_status_idx" ON "prompt_versions"("template_id", "status");
CREATE UNIQUE INDEX "prompt_versions_template_id_version_key" ON "prompt_versions"("template_id", "version");
CREATE UNIQUE INDEX "prompt_versions_one_active_per_template" ON "prompt_versions"("template_id") WHERE "status" = 'ACTIVE';
CREATE INDEX "pipeline_versions_pipeline_key_status_idx" ON "pipeline_versions"("pipeline_key", "status");
CREATE UNIQUE INDEX "pipeline_versions_pipeline_key_version_key" ON "pipeline_versions"("pipeline_key", "version");
CREATE UNIQUE INDEX "pipeline_versions_one_active_per_key" ON "pipeline_versions"("pipeline_key") WHERE "status" = 'ACTIVE';
CREATE INDEX "rule_versions_status_enabled_priority_idx" ON "rule_versions"("status", "enabled", "priority");
CREATE UNIQUE INDEX "rule_versions_key_version_key" ON "rule_versions"("key", "version");
CREATE UNIQUE INDEX "rule_versions_one_active_per_key" ON "rule_versions"("key") WHERE "status" = 'ACTIVE';
CREATE INDEX "configuration_audit_logs_entity_type_entity_id_created_at_idx" ON "configuration_audit_logs"("entity_type", "entity_id", "created_at");
CREATE INDEX "configuration_audit_logs_actor_id_created_at_idx" ON "configuration_audit_logs"("actor_id", "created_at");

ALTER TABLE "moderation_jobs" ADD CONSTRAINT "moderation_jobs_pipeline_version_id_fkey" FOREIGN KEY ("pipeline_version_id") REFERENCES "pipeline_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "model_configurations" ("id", "key", "version", "name", "role", "openrouter_model_id", "status", "input_modalities", "structured_output") VALUES
('cfg-nsfw-v1', 'nsfw_detection', 1, 'Primary content safety', 'INITIAL_NSFW', 'nvidia/nemotron-3.5-content-safety', 'ACTIVE', ARRAY['image','text'], false),
('cfg-scene-v1', 'initial_scene', 1, 'Initial scene classification', 'VISUAL_ANALYSIS', 'qwen/qwen3.6-flash', 'ACTIVE', ARRAY['image','text'], true),
('cfg-deep-v1', 'deep_visual', 1, 'Deep visual analysis', 'VISUAL_ANALYSIS', 'qwen/qwen3.6-flash', 'ACTIVE', ARRAY['image','text'], true),
('cfg-rel-v1', 'relationships', 1, 'Relationship analysis', 'VISUAL_ANALYSIS', 'qwen/qwen3.6-flash', 'ACTIVE', ARRAY['image','text'], true),
('cfg-context-v1', 'context', 1, 'Scene context', 'CONTEXT_ANALYSIS', 'google/gemini-3-flash-preview', 'ACTIVE', ARRAY['image','text'], true),
('cfg-crops-v1', 'crops', 1, 'Image region analysis', 'VISUAL_ANALYSIS', 'qwen/qwen3.6-flash', 'ACTIVE', ARRAY['image','text'], true),
('cfg-arbiter-v1', 'arbitration', 1, 'Independent arbitration', 'INDEPENDENT_ARBITER', 'openai/gpt-4.1-mini', 'ACTIVE', ARRAY['image','text'], true);
INSERT INTO "pipeline_versions" ("id", "pipeline_key", "version", "name", "status", "configuration", "published_at")
VALUES ('cfg-pipeline-interior-v1', 'interior-default', 1, 'Interior default', 'ACTIVE', '{"deepAnalysis":true,"maxImageCrops":4}'::jsonb, CURRENT_TIMESTAMP);
