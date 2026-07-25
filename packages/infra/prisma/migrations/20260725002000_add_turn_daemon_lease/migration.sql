CREATE TABLE "turn_daemon_lease" (
    "profile" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "lease_until" TIMESTAMP(3) NOT NULL,
    "fencing_epoch" BIGINT NOT NULL DEFAULT 1,
    "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_daemon_lease_pkey" PRIMARY KEY ("profile")
);
