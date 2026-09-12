import { GamePrisma, type TurnEngineGeneralUpdateInput } from '@sammo-ts/infra';

// Fixed schema identifiers only; all row values remain bound parameters.
const columns = {
    userId: 'user_id',
    name: 'name',
    nationId: 'nation_id',
    cityId: 'city_id',
    troopId: 'troop_id',
    leadership: 'leadership',
    strength: 'strength',
    intel: 'intel',
    experience: 'experience',
    dedication: 'dedication',
    officerLevel: 'officer_level',
    injury: 'injury',
    gold: 'gold',
    rice: 'rice',
    crew: 'crew',
    crewTypeId: 'crew_type_id',
    train: 'train',
    atmos: 'atmos',
    age: 'age',
    npcState: 'npc_state',
    affinity: 'affinity',
    bornYear: 'born_year',
    deadYear: 'dead_year',
    picture: 'picture',
    imageServer: 'image_server',
    startAge: 'start_age',
    horseCode: 'horse_code',
    weaponCode: 'weapon_code',
    bookCode: 'book_code',
    itemCode: 'item_code',
    personalCode: 'personal_code',
    specialCode: 'special_code',
    special2Code: 'special2_code',
    lastTurn: 'last_turn',
    penalty: 'penalty',
    meta: 'meta',
    turnTime: 'turn_time',
    turnTick: 'turn_tick',
    recentWarTime: 'recent_war_time',
    recentWarTick: 'recent_war_tick',
} satisfies Record<keyof TurnEngineGeneralUpdateInput, string>;

export const GENERAL_UPDATE_BATCH_SIZE = 500;

export const persistGeneralUpdates = async (
    database: { $executeRaw(query: GamePrisma.Sql): Promise<number> },
    updates: Array<{ id: number; data: TurnEngineGeneralUpdateInput }>
): Promise<void> => {
    if (new Set(updates.map((entry) => entry.id)).size !== updates.length) {
        throw new Error('Duplicate general IDs in persistence batch.');
    }
    const assignments = Object.entries(columns).map(([key, column]) => {
        const identifier = GamePrisma.raw(`"${column}"`);
        // Prisma omits undefined optional birth/death years instead of clearing them.
        return key === 'bornYear' || key === 'deadYear'
            ? GamePrisma.sql`${identifier} = COALESCE(source.${identifier}, target.${identifier})`
            : GamePrisma.sql`${identifier} = source.${identifier}`;
    });
    for (let offset = 0; offset < updates.length; offset += GENERAL_UPDATE_BATCH_SIZE) {
        const batch = updates.slice(offset, offset + GENERAL_UPDATE_BATCH_SIZE);
        const rows = batch.map(({ id, data }) => ({
            id,
            ...Object.fromEntries(
                (Object.keys(columns) as Array<keyof typeof columns>).map((key) => [columns[key], data[key]])
            ),
        }));
        const payload = JSON.stringify(rows, (_key, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value
        );
        const updated = await database.$executeRaw(GamePrisma.sql`
            UPDATE "general" AS target
            SET ${GamePrisma.join(assignments)}
            FROM jsonb_populate_recordset(NULL::"general", ${payload}::jsonb) AS source
            WHERE target."id" = source."id"
        `);
        // Preserve Prisma update's missing-row failure and transaction rollback.
        if (updated !== batch.length) {
            throw new Error(`General persistence batch expected ${batch.length} rows, updated ${updated}.`);
        }
    }
};

export const persistGeneralAccessScores = async (
    database: { $executeRaw(query: GamePrisma.Sql): Promise<number> },
    updates: Array<{ generalId: number; userId: string | null; refreshScoreTotal: number }>
): Promise<void> => {
    for (let offset = 0; offset < updates.length; offset += GENERAL_UPDATE_BATCH_SIZE) {
        const batch = updates.slice(offset, offset + GENERAL_UPDATE_BATCH_SIZE);
        await database.$executeRaw(GamePrisma.sql`
            INSERT INTO "general_access_log" ("general_id", "user_id", "refresh_score_total")
            VALUES ${GamePrisma.join(batch.map((row) => GamePrisma.sql`(${row.generalId}, ${row.userId}, ${row.refreshScoreTotal})`))}
            ON CONFLICT ("general_id") DO UPDATE
            SET "refresh_score_total" = EXCLUDED."refresh_score_total"
        `);
    }
};
