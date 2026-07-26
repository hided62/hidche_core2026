CREATE TABLE "general_turn_revision" (
    "general_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "general_turn_revision_pkey" PRIMARY KEY ("general_id")
);

CREATE TABLE "nation_turn_revision" (
    "nation_id" INTEGER NOT NULL,
    "officer_level" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nation_turn_revision_pkey" PRIMARY KEY ("nation_id", "officer_level")
);
