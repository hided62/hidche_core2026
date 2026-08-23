CREATE TABLE "web_push_subscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "expiration_time" TIMESTAMP(3),
    "user_agent" TEXT,
    "disabled_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_push_subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "web_push_preference" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "target_year" INTEGER,
    "target_month" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_push_preference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "web_push_event_receipt" (
    "event_id" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_push_event_receipt_pkey" PRIMARY KEY ("event_id")
);

CREATE TABLE "web_push_notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dedupe_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_push_notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "web_push_delivery" (
    "id" BIGSERIAL NOT NULL,
    "notification_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "lock_owner" TEXT,
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_push_delivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "web_push_profile_cursor" (
    "profile_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "preopen_at" TIMESTAMP(3),
    "open_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_push_profile_cursor_pkey" PRIMARY KEY ("profile_name")
);

CREATE UNIQUE INDEX "web_push_subscription_endpoint_key" ON "web_push_subscription"("endpoint");
CREATE INDEX "web_push_subscription_user_id_disabled_at_updated_at_idx"
    ON "web_push_subscription"("user_id", "disabled_at", "updated_at");
CREATE UNIQUE INDEX "web_push_preference_user_id_profile_name_event_type_key"
    ON "web_push_preference"("user_id", "profile_name", "event_type");
CREATE INDEX "web_push_preference_profile_name_event_type_enabled_idx"
    ON "web_push_preference"("profile_name", "event_type", "enabled");
CREATE INDEX "web_push_event_receipt_created_at_idx" ON "web_push_event_receipt"("created_at");
CREATE UNIQUE INDEX "web_push_notification_dedupe_key_key" ON "web_push_notification"("dedupe_key");
CREATE INDEX "web_push_notification_user_id_created_at_idx" ON "web_push_notification"("user_id", "created_at");
CREATE UNIQUE INDEX "web_push_delivery_notification_id_subscription_id_key"
    ON "web_push_delivery"("notification_id", "subscription_id");
CREATE INDEX "web_push_delivery_status_available_at_id_idx" ON "web_push_delivery"("status", "available_at", "id");

ALTER TABLE "web_push_subscription"
    ADD CONSTRAINT "web_push_subscription_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_push_preference"
    ADD CONSTRAINT "web_push_preference_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_push_notification"
    ADD CONSTRAINT "web_push_notification_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_push_delivery"
    ADD CONSTRAINT "web_push_delivery_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "web_push_notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_push_delivery"
    ADD CONSTRAINT "web_push_delivery_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "web_push_subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
