CREATE TABLE "kakao_identity_link_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "previous_oauth_id" TEXT NOT NULL,
    "next_oauth_id" TEXT NOT NULL,
    "authorization" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kakao_identity_link_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kakao_identity_link_history_previous_oauth_id_created_at_idx" ON "kakao_identity_link_history"("previous_oauth_id", "created_at");
CREATE INDEX "kakao_identity_link_history_user_id_created_at_idx" ON "kakao_identity_link_history"("user_id", "created_at");
