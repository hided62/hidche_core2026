ALTER TABLE "app_user"
    ADD COLUMN "picture" TEXT NOT NULL DEFAULT 'default.jpg',
    ADD COLUMN "image_server" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "icon_updated_at" TIMESTAMP(3),
    ADD COLUMN "third_party_use" BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN "delete_after" TIMESTAMP(3);
