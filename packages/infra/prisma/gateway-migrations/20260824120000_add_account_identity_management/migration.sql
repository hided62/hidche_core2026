ALTER TABLE "app_user"
    ADD COLUMN "identity_revision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "auth_revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "session_revoked_before" TIMESTAMP(3),
    ADD COLUMN "kakao_replacement_approved_until" TIMESTAMP(3),
    ADD COLUMN "kakao_replacement_approved_by_user_id" TEXT,
    ADD COLUMN "kakao_replacement_reason" TEXT;

CREATE TABLE "retired_kakao_identity" (
    "id" TEXT NOT NULL,
    "oauth_id" TEXT NOT NULL,
    "former_user_id" TEXT NOT NULL,
    "approved_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "retired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "retired_kakao_identity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retired_kakao_identity_oauth_id_key"
    ON "retired_kakao_identity"("oauth_id");

CREATE INDEX "retired_kakao_identity_former_user_id_retired_at_idx"
    ON "retired_kakao_identity"("former_user_id", "retired_at");
