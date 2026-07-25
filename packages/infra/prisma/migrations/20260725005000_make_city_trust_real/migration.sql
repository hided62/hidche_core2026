ALTER TABLE "city"
    ALTER COLUMN "trust" TYPE REAL
    USING "trust"::REAL;
