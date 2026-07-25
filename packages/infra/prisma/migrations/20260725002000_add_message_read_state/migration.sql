CREATE TABLE "message_read_state" (
    "general_id" INTEGER PRIMARY KEY,
    "latest_private_message" INTEGER NOT NULL DEFAULT 0,
    "latest_diplomacy_message" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
