-- Existing rows have no provable season identity. Preserve them without guessing.
ALTER TABLE "log_entry" ADD COLUMN "server_id" TEXT;
