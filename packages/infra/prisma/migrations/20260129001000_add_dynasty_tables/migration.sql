CREATE TABLE IF NOT EXISTS "ng_old_nations" (
    "id" SERIAL PRIMARY KEY,
    "server_id" VARCHAR(20) NOT NULL DEFAULT '0',
    "nation" INT NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "date" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ng_old_nations_server_id_nation" ON "ng_old_nations" ("server_id", "nation");
CREATE INDEX IF NOT EXISTS "ng_old_nations_by_server" ON "ng_old_nations" ("server_id", "nation");

CREATE TABLE IF NOT EXISTS "ng_old_generals" (
    "id" SERIAL PRIMARY KEY,
    "server_id" VARCHAR(20) NOT NULL,
    "general_no" INT NOT NULL,
    "owner" TEXT NULL,
    "name" VARCHAR(32) NOT NULL,
    "last_yearmonth" INT NOT NULL,
    "turntime" TIMESTAMP NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS "ng_old_generals_by_no" ON "ng_old_generals" ("server_id", "general_no");
CREATE INDEX IF NOT EXISTS "ng_old_generals_by_name" ON "ng_old_generals" ("server_id", "name");
CREATE INDEX IF NOT EXISTS "ng_old_generals_owner" ON "ng_old_generals" ("owner", "server_id");

CREATE TABLE IF NOT EXISTS "emperior" (
    "no" SERIAL PRIMARY KEY,
    "server_id" VARCHAR(20) NULL DEFAULT '',
    "phase" VARCHAR(255) NULL DEFAULT '',
    "nation_count" VARCHAR(64) NULL DEFAULT '',
    "nation_name" TEXT NULL DEFAULT '',
    "nation_hist" TEXT NULL DEFAULT '',
    "gen_count" VARCHAR(64) NULL DEFAULT '',
    "personal_hist" TEXT NULL DEFAULT '',
    "special_hist" TEXT NULL DEFAULT '',
    "name" VARCHAR(64) NULL DEFAULT '',
    "type" VARCHAR(64) NULL DEFAULT '',
    "color" VARCHAR(7) NULL DEFAULT '',
    "year" INT NULL DEFAULT 0,
    "month" INT NULL DEFAULT 0,
    "power" INT NULL DEFAULT 0,
    "gennum" INT NULL DEFAULT 0,
    "citynum" INT NULL DEFAULT 0,
    "pop" VARCHAR(255) NULL DEFAULT '0',
    "poprate" VARCHAR(255) NULL DEFAULT '',
    "gold" INT NULL DEFAULT 0,
    "rice" INT NULL DEFAULT 0,
    "l12name" VARCHAR(64) NULL DEFAULT '',
    "l12pic" VARCHAR(32) NULL DEFAULT '',
    "l11name" VARCHAR(64) NULL DEFAULT '',
    "l11pic" VARCHAR(32) NULL DEFAULT '',
    "l10name" VARCHAR(64) NULL DEFAULT '',
    "l10pic" VARCHAR(32) NULL DEFAULT '',
    "l9name" VARCHAR(64) NULL DEFAULT '',
    "l9pic" VARCHAR(32) NULL DEFAULT '',
    "l8name" VARCHAR(64) NULL DEFAULT '',
    "l8pic" VARCHAR(32) NULL DEFAULT '',
    "l7name" VARCHAR(64) NULL DEFAULT '',
    "l7pic" VARCHAR(32) NULL DEFAULT '',
    "l6name" VARCHAR(64) NULL DEFAULT '',
    "l6pic" VARCHAR(32) NULL DEFAULT '',
    "l5name" VARCHAR(64) NULL DEFAULT '',
    "l5pic" VARCHAR(32) NULL DEFAULT '',
    "tiger" VARCHAR(128) NULL DEFAULT '',
    "eagle" VARCHAR(128) NULL DEFAULT '',
    "gen" TEXT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "aux" JSONB NOT NULL DEFAULT '{}'::jsonb
);
