CREATE TABLE "yearbook_history" (
    "id" SERIAL PRIMARY KEY,
    "profile_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "map" JSONB NOT NULL,
    "nations" JSONB NOT NULL,
    "hash" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "yearbook_history_profile_year_month_key" ON "yearbook_history"("profile_name", "year", "month");
CREATE INDEX "yearbook_history_profile_year_month_idx" ON "yearbook_history"("profile_name", "year", "month");