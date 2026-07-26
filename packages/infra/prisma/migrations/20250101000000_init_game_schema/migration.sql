-- Baseline tables that predate the incremental Prisma migration history.
--
-- IF NOT EXISTS is intentional: existing installations were originally
-- provisioned with `prisma db push` and already own these objects. This
-- migration must be safe both for those databases and for a genuinely empty
-- database running the full migration chain.

DO $$
BEGIN
    CREATE TYPE "LogScope" AS ENUM ('SYSTEM', 'NATION', 'GENERAL', 'USER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE "LogCategory" AS ENUM (
        'HISTORY',
        'SUMMARY',
        'ACTION',
        'BATTLE_BRIEF',
        'BATTLE_DETAIL',
        'USER'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "world_state" (
    "id" SERIAL NOT NULL,
    "scenario_code" TEXT NOT NULL,
    "current_year" INTEGER NOT NULL,
    "current_month" INTEGER NOT NULL,
    "tick_seconds" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "nation" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "capital_city_id" INTEGER,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "rice" INTEGER NOT NULL DEFAULT 0,
    "tech" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "type_code" TEXT NOT NULL DEFAULT 'che_중립',
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT "nation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "city" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "nation_id" INTEGER NOT NULL DEFAULT 0,
    "supply_state" INTEGER NOT NULL DEFAULT 1,
    "front_state" INTEGER NOT NULL DEFAULT 0,
    "pop" INTEGER NOT NULL,
    "pop_max" INTEGER NOT NULL,
    "agri" INTEGER NOT NULL,
    "agri_max" INTEGER NOT NULL,
    "comm" INTEGER NOT NULL,
    "comm_max" INTEGER NOT NULL,
    "secu" INTEGER NOT NULL,
    "secu_max" INTEGER NOT NULL,
    "trust" INTEGER NOT NULL DEFAULT 0,
    "trade" INTEGER NOT NULL DEFAULT 100,
    "def" INTEGER NOT NULL,
    "def_max" INTEGER NOT NULL,
    "wall" INTEGER NOT NULL,
    "wall_max" INTEGER NOT NULL,
    "region" INTEGER NOT NULL,
    "conflict" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT "city_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "general" (
    "id" INTEGER NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "nation_id" INTEGER NOT NULL DEFAULT 0,
    "city_id" INTEGER NOT NULL DEFAULT 0,
    "troop_id" INTEGER NOT NULL DEFAULT 0,
    "npc_state" INTEGER NOT NULL DEFAULT 0,
    "affinity" INTEGER,
    "born_year" INTEGER NOT NULL DEFAULT 180,
    "dead_year" INTEGER NOT NULL DEFAULT 300,
    "picture" TEXT,
    "image_server" INTEGER NOT NULL DEFAULT 0,
    "leadership" INTEGER NOT NULL DEFAULT 50,
    "strength" INTEGER NOT NULL DEFAULT 50,
    "intel" INTEGER NOT NULL DEFAULT 50,
    "injury" INTEGER NOT NULL DEFAULT 0,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "dedication" INTEGER NOT NULL DEFAULT 0,
    "officer_level" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 1000,
    "rice" INTEGER NOT NULL DEFAULT 1000,
    "crew" INTEGER NOT NULL DEFAULT 0,
    "crew_type_id" INTEGER NOT NULL DEFAULT 0,
    "train" INTEGER NOT NULL DEFAULT 0,
    "atmos" INTEGER NOT NULL DEFAULT 0,
    "weapon_code" TEXT NOT NULL DEFAULT 'None',
    "book_code" TEXT NOT NULL DEFAULT 'None',
    "horse_code" TEXT NOT NULL DEFAULT 'None',
    "item_code" TEXT NOT NULL DEFAULT 'None',
    "turn_time" TIMESTAMP(3) NOT NULL,
    "recent_war_time" TIMESTAMP(3),
    "age" INTEGER NOT NULL DEFAULT 20,
    "start_age" INTEGER NOT NULL DEFAULT 20,
    "personal_code" TEXT NOT NULL DEFAULT 'None',
    "special_code" TEXT NOT NULL DEFAULT 'None',
    "special2_code" TEXT NOT NULL DEFAULT 'None',
    "last_turn" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "penalty" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "message" (
    "id" SERIAL NOT NULL,
    "mailbox" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "src" INTEGER NOT NULL,
    "dest" INTEGER NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "message" JSONB NOT NULL,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "troop" (
    "troop_leader" INTEGER NOT NULL,
    "nation" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "troop_pkey" PRIMARY KEY ("troop_leader")
);

CREATE TABLE IF NOT EXISTS "general_turn" (
    "id" SERIAL NOT NULL,
    "general_id" INTEGER NOT NULL,
    "turn_idx" INTEGER NOT NULL,
    "action_code" TEXT NOT NULL,
    "arg" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_turn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "general_turn_general_id_turn_idx_key"
    ON "general_turn"("general_id", "turn_idx");

CREATE TABLE IF NOT EXISTS "nation_turn" (
    "id" SERIAL NOT NULL,
    "nation_id" INTEGER NOT NULL,
    "officer_level" INTEGER NOT NULL,
    "turn_idx" INTEGER NOT NULL,
    "action_code" TEXT NOT NULL,
    "arg" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nation_turn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "nation_turn_nation_id_officer_level_turn_idx_key"
    ON "nation_turn"("nation_id", "officer_level", "turn_idx");

CREATE TABLE IF NOT EXISTS "diplomacy" (
    "id" SERIAL NOT NULL,
    "src_nation_id" INTEGER NOT NULL,
    "dest_nation_id" INTEGER NOT NULL,
    "state_code" INTEGER NOT NULL,
    "term" INTEGER NOT NULL DEFAULT 0,
    "is_dead" BOOLEAN NOT NULL DEFAULT false,
    "is_showing" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diplomacy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "diplomacy_src_nation_id_dest_nation_id_key"
    ON "diplomacy"("src_nation_id", "dest_nation_id");

CREATE TABLE IF NOT EXISTS "event" (
    "id" SERIAL NOT NULL,
    "target_code" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "condition" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "action" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "log_entry" (
    "id" SERIAL NOT NULL,
    "scope" "LogScope" NOT NULL,
    "category" "LogCategory" NOT NULL,
    "sub_type" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "general_id" INTEGER,
    "nation_id" INTEGER,
    "user_id" INTEGER,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_entry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "log_entry_scope_category_id_idx"
    ON "log_entry"("scope", "category", "id");
CREATE INDEX IF NOT EXISTS "log_entry_general_id_category_id_idx"
    ON "log_entry"("general_id", "category", "id");
CREATE INDEX IF NOT EXISTS "log_entry_nation_id_category_id_idx"
    ON "log_entry"("nation_id", "category", "id");
CREATE INDEX IF NOT EXISTS "log_entry_user_id_category_id_idx"
    ON "log_entry"("user_id", "category", "id");

CREATE TABLE IF NOT EXISTS "error_log" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT,
    "message" TEXT NOT NULL,
    "trace" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "error_log_category_id_idx"
    ON "error_log"("category", "id");
