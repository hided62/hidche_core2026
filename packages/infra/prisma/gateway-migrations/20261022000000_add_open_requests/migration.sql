CREATE TABLE "gateway_open_request" (
    "id" TEXT PRIMARY KEY,
    "profile_name" TEXT NOT NULL REFERENCES "gateway_profile"("profile_name") ON DELETE CASCADE,
    "requested_by" TEXT NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "install" JSONB NOT NULL,
    "announcement" JSONB NOT NULL,
    "season_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "preopen_at" TIMESTAMP(3) NOT NULL,
    "open_at" TIMESTAMP(3) NOT NULL,
    "operation_id" TEXT UNIQUE REFERENCES "gateway_operation"("id") ON DELETE RESTRICT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gateway_open_request_status_check" CHECK ("status" IN ('PENDING','RESERVED','EXPIRED','WITHDRAWN','REJECTED','SUPERSEDED')),
    CONSTRAINT "gateway_open_request_dates_check" CHECK ("created_at" < "expires_at" AND "expires_at" <= "preopen_at" AND "preopen_at" < "open_at"),
    CONSTRAINT "gateway_open_request_decision_check" CHECK (("status" = 'RESERVED') = ("operation_id" IS NOT NULL))
);
CREATE INDEX "gateway_open_request_profile_name_status_expires_at_idx" ON "gateway_open_request"("profile_name", "status", "expires_at");
CREATE UNIQUE INDEX "gateway_open_request_one_pending_per_user" ON "gateway_open_request"("profile_name", "requested_by") WHERE "status" = 'PENDING';
CREATE TABLE "gateway_open_endorsement" (
    "request_id" TEXT NOT NULL REFERENCES "gateway_open_request"("id") ON DELETE CASCADE,
    "user_id" TEXT NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("request_id", "user_id")
);
