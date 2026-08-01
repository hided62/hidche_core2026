ALTER TABLE "app_user"
ADD COLUMN "icon_retired_at" TIMESTAMP(3);

CREATE TABLE "user_icon" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "picture" TEXT NOT NULL,
    "image_server" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),
    CONSTRAINT "user_icon_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_icon_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_icon_picture_key" ON "user_icon"("picture");
CREATE INDEX "user_icon_user_id_retired_at_created_at_idx"
ON "user_icon"("user_id", "retired_at", "created_at");

-- 기존 전콘의 파일명과 URL을 바꾸지 않고 활성 목록의 첫 항목으로 올립니다.
INSERT INTO "user_icon" ("user_id", "picture", "image_server", "created_at")
SELECT
    "id",
    "picture",
    "image_server",
    COALESCE("icon_updated_at", "created_at")
FROM "app_user"
WHERE "picture" <> 'default.jpg' AND "image_server" > 0
ON CONFLICT ("picture") DO NOTHING;
