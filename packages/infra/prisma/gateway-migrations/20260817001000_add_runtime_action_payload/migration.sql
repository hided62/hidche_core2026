ALTER TABLE "gateway_runtime_action"
    ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}'::jsonb;
