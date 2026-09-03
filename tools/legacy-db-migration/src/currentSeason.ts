import { createHash } from 'node:crypto';

import type { Pool as MariaPool } from 'mariadb';
import type { Pool as PgPool, PoolClient } from 'pg';

import {
    jsonParameter,
    paginateSource,
    querySource,
    toDate,
    toFloat,
    toNullableDate,
    toNullableString,
    toNumber,
    toStringValue,
    upsertRows,
    withMigrationLock,
    type SourceRow,
    type TargetRow,
} from './db.js';
import { legacyUserId } from './identity.js';
import { parseJson, type JsonValue } from './transform.js';

const batchSize = 200;

export interface CurrentSeasonFixtureOptions {
    apply: boolean;
    profile: string;
    expectedScenario: number;
    expectedYear: number;
    expectedMonth: number;
    captureUserId: string | null;
    captureSourceOwner: number;
}

interface CurrentSeasonContract {
    scenario: number;
    year: number;
    month: number;
    turnTermMinutes: number;
}

interface CurrentSeasonSummary {
    command: 'current-season-fixture';
    apply: boolean;
    profile: string;
    sourceContract: CurrentSeasonContract;
    targetTemplateContract: CurrentSeasonContract;
    counts: Record<string, number>;
    unsupported: Record<string, string>;
}

const asObject = (value: JsonValue, context: string): Record<string, JsonValue> => {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`${context}: expected a JSON object`);
    }
    return value as Record<string, JsonValue>;
};

const jsonObject = (value: unknown, context: string): Record<string, JsonValue> =>
    asObject(parseJson(value ?? '{}', context), context);

const jsonObjectOrLegacyEmpty = (value: unknown, context: string): Record<string, JsonValue> => {
    const parsed = parseJson(value ?? '{}', context);
    if (Array.isArray(parsed) && parsed.length === 0) {
        return {};
    }
    return asObject(parsed, context);
};

const legacyMessageTarget = (value: JsonValue, context: string): Record<string, JsonValue> => {
    const target = asObject(value, context);
    return {
        generalId: toNumber(target.id ?? 0, `${context}.id`),
        generalName: toStringValue(target.name ?? '', `${context}.name`),
        nationId: toNumber(target.nation_id ?? 0, `${context}.nation_id`),
        nationName: toStringValue(target.nation ?? '', `${context}.nation`),
        color: toStringValue(target.color ?? '#000000', `${context}.color`),
        icon: toStringValue(target.icon ?? '', `${context}.icon`),
    };
};

export const transformLegacyMessagePayload = (value: unknown): Record<string, JsonValue> => {
    const payload = jsonObject(value, 'message.message');
    const option = payload.option;
    return {
        src: legacyMessageTarget(payload.src ?? {}, 'message.message.src'),
        dest: legacyMessageTarget(payload.dest ?? {}, 'message.message.dest'),
        text: toStringValue(payload.text ?? '', 'message.message.text'),
        ...(option === undefined || (Array.isArray(option) && option.length === 0) ? {} : { option }),
    };
};

const nullableJson = (value: unknown, fallback: JsonValue, context: string): JsonValue => {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    return parseJson(value, context) ?? fallback;
};

const nullableNumber = (value: unknown, context: string): number | null =>
    value === null || value === undefined ? null : toNumber(value, context);

const booleanValue = (value: unknown): boolean => {
    if (Buffer.isBuffer(value)) {
        return value.length > 0 && value[0] !== 0;
    }
    return value === true || value === 1 || value === '1' || value === '\u0001';
};

const ownerUserId = (owner: unknown, options: CurrentSeasonFixtureOptions): string | null => {
    const ownerNo = nullableNumber(owner, 'general.owner');
    if (!ownerNo || ownerNo <= 0) {
        return null;
    }
    if (options.captureUserId && ownerNo === options.captureSourceOwner) {
        return options.captureUserId;
    }
    return legacyUserId(ownerNo);
};

const readSourceContract = async (source: MariaPool): Promise<CurrentSeasonContract> => {
    const rows = await querySource(
        source,
        `SELECT \`key\`, JSON_UNQUOTE(value) AS value
           FROM storage
          WHERE namespace = 'game_env'
            AND \`key\` IN ('scenario', 'year', 'month', 'turnterm')`
    );
    const values = new Map(rows.map((row) => [String(row.key), Number(row.value)]));
    return {
        scenario: values.get('scenario') ?? Number.NaN,
        year: values.get('year') ?? Number.NaN,
        month: values.get('month') ?? Number.NaN,
        turnTermMinutes: values.get('turnterm') ?? Number.NaN,
    };
};

const readTargetContract = async (target: PgPool): Promise<CurrentSeasonContract> => {
    const result = await target.query<{
        scenario: string;
        year: number;
        month: number;
        turn_term_minutes: number;
    }>(
        `SELECT scenario_code AS scenario,
                current_year AS year,
                current_month AS month,
                tick_seconds / 60 AS turn_term_minutes
           FROM world_state`
    );
    if (result.rowCount !== 1) {
        throw new Error('Target template must contain exactly one world_state row');
    }
    const row = result.rows[0]!;
    return {
        scenario: Number(row.scenario),
        year: row.year,
        month: row.month,
        turnTermMinutes: row.turn_term_minutes,
    };
};

const assertContract = (contract: CurrentSeasonContract, options: CurrentSeasonFixtureOptions, label: string): void => {
    if (
        contract.scenario !== options.expectedScenario ||
        contract.year !== options.expectedYear ||
        contract.month !== options.expectedMonth
    ) {
        throw new Error(
            `${label} contract mismatch: expected ${options.expectedScenario}/${options.expectedYear}-${String(options.expectedMonth).padStart(2, '0')}, got ${contract.scenario}/${contract.year}-${String(contract.month).padStart(2, '0')}`
        );
    }
};

const insertBatches = async (
    client: PoolClient,
    table: string,
    rows: readonly TargetRow[],
    conflictColumns: readonly string[],
    counts: Record<string, number>
): Promise<void> => {
    for (let offset = 0; offset < rows.length; offset += batchSize) {
        await upsertRows(client, table, rows.slice(offset, offset + batchSize), conflictColumns);
    }
    counts[table] = (counts[table] ?? 0) + rows.length;
};

const migratePaged = async (
    source: MariaPool,
    client: PoolClient,
    sourceTable: string,
    sourceIdColumn: string,
    targetTable: string,
    conflictColumns: readonly string[],
    mapper: (row: SourceRow) => TargetRow,
    counts: Record<string, number>
): Promise<void> => {
    for await (const rows of paginateSource(source, sourceTable, sourceIdColumn, batchSize)) {
        await insertBatches(client, targetTable, rows.map(mapper), conflictColumns, counts);
    }
};

const mapGeneral = (row: SourceRow, options: CurrentSeasonFixtureOptions): TargetRow => {
    const id = toNumber(row.no, 'general.no');
    const aux = jsonObjectOrLegacyEmpty(row.aux, `general.${id}.aux`);
    const meta: Record<string, JsonValue> = {
        ...aux,
        owner: nullableNumber(row.owner, `general.${id}.owner`) ?? 0,
        owner_name: toNullableString(row.owner_name),
        npcmsg: toNullableString(row.npcmsg) ?? '',
        npc_org: nullableNumber(row.npc_org, `general.${id}.npc_org`) ?? 0,
        newmsg: nullableNumber(row.newmsg, `general.${id}.newmsg`) ?? 0,
        leadership_exp: toNumber(row.leadership_exp, `general.${id}.leadership_exp`),
        strength_exp: toNumber(row.strength_exp, `general.${id}.strength_exp`),
        intel_exp: toNumber(row.intel_exp, `general.${id}.intel_exp`),
        dex1: toNumber(row.dex1, `general.${id}.dex1`),
        dex2: toNumber(row.dex2, `general.${id}.dex2`),
        dex3: toNumber(row.dex3, `general.${id}.dex3`),
        dex4: toNumber(row.dex4, `general.${id}.dex4`),
        dex5: toNumber(row.dex5, `general.${id}.dex5`),
        officer_city: toNumber(row.officer_city, `general.${id}.officer_city`),
        permission: toNullableString(row.permission) ?? 'normal',
        makelimit: nullableNumber(row.makelimit, `general.${id}.makelimit`) ?? 0,
        killturn: nullableNumber(row.killturn, `general.${id}.killturn`) ?? 0,
        block: nullableNumber(row.block, `general.${id}.block`) ?? 0,
        dedlevel: nullableNumber(row.dedlevel, `general.${id}.dedlevel`) ?? 0,
        explevel: nullableNumber(row.explevel, `general.${id}.explevel`) ?? 0,
        belong: nullableNumber(row.belong, `general.${id}.belong`) ?? 0,
        betray: nullableNumber(row.betray, `general.${id}.betray`) ?? 0,
        specage: nullableNumber(row.specage, `general.${id}.specage`) ?? 0,
        specage2: nullableNumber(row.specage2, `general.${id}.specage2`) ?? 0,
        defence_train: nullableNumber(row.defence_train, `general.${id}.defence_train`) ?? 0,
        tnmt: nullableNumber(row.tnmt, `general.${id}.tnmt`) ?? 0,
        myset: nullableNumber(row.myset, `general.${id}.myset`) ?? 0,
        tournament: nullableNumber(row.tournament, `general.${id}.tournament`) ?? 0,
        newvote: nullableNumber(row.newvote, `general.${id}.newvote`) ?? 0,
    };
    return {
        id,
        user_id: ownerUserId(row.owner, options),
        name: toStringValue(row.name, `general.${id}.name`),
        nation_id: toNumber(row.nation, `general.${id}.nation`),
        city_id: toNumber(row.city, `general.${id}.city`),
        troop_id: toNumber(row.troop, `general.${id}.troop`),
        npc_state: toNumber(row.npc, `general.${id}.npc`),
        affinity: nullableNumber(row.affinity, `general.${id}.affinity`),
        born_year: nullableNumber(row.bornyear, `general.${id}.bornyear`) ?? 180,
        dead_year: nullableNumber(row.deadyear, `general.${id}.deadyear`) ?? 300,
        picture: toNullableString(row.picture),
        image_server: toNumber(row.imgsvr, `general.${id}.imgsvr`),
        leadership: toNumber(row.leadership, `general.${id}.leadership`),
        strength: toNumber(row.strength, `general.${id}.strength`),
        intel: toNumber(row.intel, `general.${id}.intel`),
        injury: toNumber(row.injury, `general.${id}.injury`),
        experience: toNumber(row.experience, `general.${id}.experience`),
        dedication: toNumber(row.dedication, `general.${id}.dedication`),
        officer_level: toNumber(row.officer_level, `general.${id}.officer_level`),
        gold: toNumber(row.gold, `general.${id}.gold`),
        rice: toNumber(row.rice, `general.${id}.rice`),
        crew: toNumber(row.crew, `general.${id}.crew`),
        crew_type_id: toNumber(row.crewtype, `general.${id}.crewtype`),
        train: toNumber(row.train, `general.${id}.train`),
        atmos: toNumber(row.atmos, `general.${id}.atmos`),
        weapon_code: toStringValue(row.weapon, `general.${id}.weapon`),
        book_code: toStringValue(row.book, `general.${id}.book`),
        horse_code: toStringValue(row.horse, `general.${id}.horse`),
        item_code: toStringValue(row.item, `general.${id}.item`),
        turn_time: toDate(row.turntime, `general.${id}.turntime`),
        recent_war_time: toNullableDate(row.recent_war, `general.${id}.recent_war`),
        age: nullableNumber(row.age, `general.${id}.age`) ?? 20,
        start_age: nullableNumber(row.startage, `general.${id}.startage`) ?? 20,
        personal_code: toStringValue(row.personal, `general.${id}.personal`),
        special_code: toStringValue(row.special, `general.${id}.special`),
        special2_code: toStringValue(row.special2, `general.${id}.special2`),
        last_turn: nullableJson(row.last_turn, {}, `general.${id}.last_turn`),
        meta,
        penalty: nullableJson(row.penalty, {}, `general.${id}.penalty`),
        created_at: new Date(0),
        updated_at: new Date(0),
    };
};

const mapNation = (row: SourceRow, nationEnv: Record<string, JsonValue>): TargetRow => {
    const id = toNumber(row.nation, 'nation.nation');
    const aux = jsonObject(row.aux, `nation.${id}.aux`);
    return {
        id,
        name: toStringValue(row.name, `nation.${id}.name`),
        color: toStringValue(row.color, `nation.${id}.color`),
        capital_city_id: nullableNumber(row.capital, `nation.${id}.capital`),
        chief_general_id: null,
        gold: nullableNumber(row.gold, `nation.${id}.gold`) ?? 0,
        rice: nullableNumber(row.rice, `nation.${id}.rice`) ?? 0,
        tech: toFloat(row.tech ?? 0, `nation.${id}.tech`),
        level: nullableNumber(row.level, `nation.${id}.level`) ?? 0,
        type_code: toStringValue(row.type, `nation.${id}.type`),
        meta: {
            ...aux,
            ...nationEnv,
            capital: nullableNumber(row.capital, `nation.${id}.capital`) ?? 0,
            capset: nullableNumber(row.capset, `nation.${id}.capset`) ?? 0,
            gennum: nullableNumber(row.gennum, `nation.${id}.gennum`) ?? 0,
            bill: nullableNumber(row.bill, `nation.${id}.bill`) ?? 0,
            rate: nullableNumber(row.rate, `nation.${id}.rate`) ?? 0,
            rate_tmp: nullableNumber(row.rate_tmp, `nation.${id}.rate_tmp`) ?? 0,
            secretlimit: nullableNumber(row.secretlimit, `nation.${id}.secretlimit`) ?? 0,
            chief_set: nullableNumber(row.chief_set, `nation.${id}.chief_set`) ?? 0,
            scout: nullableNumber(row.scout, `nation.${id}.scout`) ?? 0,
            war: nullableNumber(row.war, `nation.${id}.war`) ?? 0,
            strategic_cmd_limit: nullableNumber(row.strategic_cmd_limit, `nation.${id}.strategic_cmd_limit`) ?? 0,
            surlimit: nullableNumber(row.surlimit, `nation.${id}.surlimit`) ?? 0,
            power: nullableNumber(row.power, `nation.${id}.power`) ?? 0,
            spy: nullableJson(row.spy, {}, `nation.${id}.spy`),
        },
    };
};

const hashYearbook = (row: TargetRow): string =>
    createHash('sha256')
        .update(JSON.stringify([row.map, row.nations, row.global_history, row.global_action]))
        .digest('hex');

const migrateStorageAndWorld = async (
    source: MariaPool,
    client: PoolClient,
    options: CurrentSeasonFixtureOptions,
    counts: Record<string, number>
): Promise<void> => {
    const storage = await querySource(source, 'SELECT * FROM storage ORDER BY id');
    const gameEnv: Record<string, JsonValue> = {};
    const archives: TargetRow[] = [];
    for (const row of storage) {
        const id = toNumber(row.id, 'storage.id');
        const namespace = toStringValue(row.namespace, `storage.${id}.namespace`);
        const key = toStringValue(row.key, `storage.${id}.key`);
        const value = parseJson(row.value, `storage.${id}.value`);
        archives.push({ source_id: id, namespace, key, value: jsonParameter(value), scope: 'current-season-fixture' });
        if (namespace === 'game_env') {
            gameEnv[key] = value;
        }
    }
    await insertBatches(client, 'legacy_game_storage', archives, ['source_id'], counts);

    const latestHistory = await querySource(source, 'SELECT server_id FROM ng_history ORDER BY no DESC LIMIT 1');
    const maxRows = await querySource(
        source,
        'SELECT (SELECT COALESCE(MAX(no), 0) FROM general) AS max_general, (SELECT COALESCE(MAX(nation), 0) FROM nation) AS max_nation'
    );
    const maxRow = maxRows[0]!;
    const dynamicMeta: Record<string, JsonValue> = {
        refGameEnv: gameEnv,
        serverId: latestHistory[0]
            ? toStringValue(latestHistory[0].server_id, 'ng_history.server_id')
            : options.profile,
        lastGeneralId: toNumber(maxRow.max_general, 'general.max'),
        lastNationId: toNumber(maxRow.max_nation, 'nation.max'),
        lastBettingId: Number(gameEnv.last_betting_id ?? 0),
        opentime: String(gameEnv.opentime ?? ''),
        starttime: String(gameEnv.starttime ?? ''),
        turntime: String(gameEnv.turntime ?? ''),
        develcost: Number(gameEnv.develcost ?? 0),
        genius: Number(gameEnv.genius ?? 0),
    };
    await client.query(
        `UPDATE world_state
            SET current_year = $1,
                current_month = $2,
                tick_seconds = $3,
                config = jsonb_set(jsonb_set(config, '{npcMode}', to_jsonb($4::integer), true), '{turnTermMinutes}', to_jsonb($5::integer), true),
                meta = meta || $6::jsonb,
                updated_at = CURRENT_TIMESTAMP`,
        [
            options.expectedYear,
            options.expectedMonth,
            Number(gameEnv.turnterm) * 60,
            Number(gameEnv.npcmode),
            Number(gameEnv.turnterm),
            JSON.stringify(dynamicMeta),
        ]
    );
    counts.world_state = 1;
};

const replaceCurrentSeason = async (
    source: MariaPool,
    client: PoolClient,
    options: CurrentSeasonFixtureOptions,
    counts: Record<string, number>
): Promise<void> => {
    await client.query('BEGIN');
    try {
        const activeLease = await client.query(
            `SELECT 1
             FROM turn_daemon_lease
             WHERE lease_until > CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
             LIMIT 1`
        );
        if (activeLease.rowCount) {
            throw new Error('Refusing to replace a current season while a turn daemon lease is active');
        }
        const targetCityMetaRows = await client.query<{ id: number; meta: JsonValue }>(`SELECT id, meta FROM city`);
        const targetCityMeta = new Map(targetCityMetaRows.rows.map((row) => [row.id, row.meta]));
        await client.query(`
            TRUNCATE TABLE
                input_event, turn_daemon_lease,
                general_turn_revision, nation_turn_revision,
                traffic_period_general, traffic_period,
                message_read_state, general_access_log,
                general_turn, nation_turn, rank_data, message, log_entry,
                event, auction_bid, auction, nation_bet, nation_betting,
                diplomacy_letter, diplomacy, troop,
                select_npc_token, select_pool,
                board_comment, board_post, vote_comment, vote, vote_poll,
                legacy_game_storage, yearbook_history,
                general, city, nation
            RESTART IDENTITY CASCADE
        `);

        await migratePaged(
            source,
            client,
            'city',
            'city',
            'city',
            ['id'],
            (row) => {
                const id = toNumber(row.city, 'city.city');
                const staticMeta = (targetCityMeta.get(id) as Record<string, JsonValue> | undefined) ?? {};
                return {
                    id,
                    name: toStringValue(row.name, `city.${id}.name`),
                    level: toNumber(row.level, `city.${id}.level`),
                    nation_id: toNumber(row.nation, `city.${id}.nation`),
                    supply_state: toNumber(row.supply, `city.${id}.supply`),
                    front_state: toNumber(row.front, `city.${id}.front`),
                    pop: toNumber(row.pop, `city.${id}.pop`),
                    pop_max: toNumber(row.pop_max, `city.${id}.pop_max`),
                    agri: toNumber(row.agri, `city.${id}.agri`),
                    agri_max: toNumber(row.agri_max, `city.${id}.agri_max`),
                    comm: toNumber(row.comm, `city.${id}.comm`),
                    comm_max: toNumber(row.comm_max, `city.${id}.comm_max`),
                    secu: toNumber(row.secu, `city.${id}.secu`),
                    secu_max: toNumber(row.secu_max, `city.${id}.secu_max`),
                    trust: toFloat(row.trust, `city.${id}.trust`),
                    trade: nullableNumber(row.trade, `city.${id}.trade`),
                    def: toNumber(row.def, `city.${id}.def`),
                    def_max: toNumber(row.def_max, `city.${id}.def_max`),
                    wall: toNumber(row.wall, `city.${id}.wall`),
                    wall_max: toNumber(row.wall_max, `city.${id}.wall_max`),
                    region: toNumber(row.region, `city.${id}.region`),
                    conflict: nullableJson(row.conflict, {}, `city.${id}.conflict`),
                    meta: {
                        ...staticMeta,
                        officer_set: toNumber(row.officer_set, `city.${id}.officer_set`),
                        state: toNumber(row.state, `city.${id}.state`),
                        term: toNumber(row.term, `city.${id}.term`),
                        dead: toNumber(row.dead, `city.${id}.dead`),
                        trust: toFloat(row.trust, `city.${id}.trust`),
                        trade: nullableNumber(row.trade, `city.${id}.trade`),
                        region: toNumber(row.region, `city.${id}.region`),
                    },
                };
            },
            counts
        );

        const nationEnvRows = await querySource(source, 'SELECT namespace, `key`, value FROM nation_env ORDER BY id');
        const nationEnv = new Map<number, Record<string, JsonValue>>();
        for (const row of nationEnvRows) {
            const nationId = toNumber(row.namespace, 'nation_env.namespace');
            const entry = nationEnv.get(nationId) ?? {};
            entry[toStringValue(row.key, 'nation_env.key')] = parseJson(row.value, 'nation_env.value');
            nationEnv.set(nationId, entry);
        }
        await migratePaged(
            source,
            client,
            'nation',
            'nation',
            'nation',
            ['id'],
            (row) => {
                const id = toNumber(row.nation, 'nation.nation');
                return mapNation(row, nationEnv.get(id) ?? {});
            },
            counts
        );
        await migratePaged(
            source,
            client,
            'general',
            'no',
            'general',
            ['id'],
            (row) => mapGeneral(row, options),
            counts
        );
        await client.query(`
            UPDATE nation n
               SET chief_general_id = (
                   SELECT g.id
                     FROM general g
                    WHERE g.nation_id = n.id AND g.officer_level = 12
                    ORDER BY g.id
                    LIMIT 1
               )
        `);
        await migratePaged(
            source,
            client,
            'troop',
            'troop_leader',
            'troop',
            ['troop_leader'],
            (row) => ({
                troop_leader: toNumber(row.troop_leader, 'troop.troop_leader'),
                nation: toNumber(row.nation, 'troop.nation'),
                name: toStringValue(row.name, 'troop.name'),
            }),
            counts
        );
        await migratePaged(
            source,
            client,
            'diplomacy',
            'no',
            'diplomacy',
            ['src_nation_id', 'dest_nation_id'],
            (row) => ({
                src_nation_id: toNumber(row.me, 'diplomacy.me'),
                dest_nation_id: toNumber(row.you, 'diplomacy.you'),
                state_code: nullableNumber(row.state, 'diplomacy.state') ?? 0,
                term: nullableNumber(row.term, 'diplomacy.term') ?? 0,
                is_dead: (nullableNumber(row.dead, 'diplomacy.dead') ?? 0) !== 0,
                is_showing: row.showing !== null,
                meta: {
                    dead: nullableNumber(row.dead, 'diplomacy.dead') ?? 0,
                    showing: toNullableDate(row.showing, 'diplomacy.showing')?.toISOString() ?? null,
                },
                created_at: new Date(0),
            }),
            counts
        );
        await migratePaged(
            source,
            client,
            'general_turn',
            'id',
            'general_turn',
            ['general_id', 'turn_idx'],
            (row) => ({
                general_id: toNumber(row.general_id, 'general_turn.general_id'),
                turn_idx: toNumber(row.turn_idx, 'general_turn.turn_idx'),
                action_code: toStringValue(row.action, 'general_turn.action'),
                arg: nullableJson(row.arg, {}, 'general_turn.arg'),
                created_at: new Date(0),
            }),
            counts
        );
        await migratePaged(
            source,
            client,
            'nation_turn',
            'id',
            'nation_turn',
            ['nation_id', 'officer_level', 'turn_idx'],
            (row) => ({
                nation_id: toNumber(row.nation_id, 'nation_turn.nation_id'),
                officer_level: toNumber(row.officer_level, 'nation_turn.officer_level'),
                turn_idx: toNumber(row.turn_idx, 'nation_turn.turn_idx'),
                action_code: toStringValue(row.action, 'nation_turn.action'),
                arg: nullableJson(row.arg, {}, 'nation_turn.arg'),
                created_at: new Date(0),
            }),
            counts
        );
        await migratePaged(
            source,
            client,
            'rank_data',
            'id',
            'rank_data',
            ['general_id', 'type'],
            (row) => ({
                nation_id: toNumber(row.nation_id, 'rank_data.nation_id'),
                general_id: toNumber(row.general_id, 'rank_data.general_id'),
                type: toStringValue(row.type, 'rank_data.type'),
                value: toNumber(row.value, 'rank_data.value'),
            }),
            counts
        );
        await migratePaged(
            source,
            client,
            'message',
            'id',
            'message',
            ['id'],
            (row) => ({
                id: toNumber(row.id, 'message.id'),
                mailbox: toNumber(row.mailbox, 'message.mailbox'),
                type: toStringValue(row.type, 'message.type'),
                src: toNumber(row.src, 'message.src'),
                dest: toNumber(row.dest, 'message.dest'),
                time: toDate(row.time, 'message.time'),
                valid_until: toDate(row.valid_until, 'message.valid_until'),
                message: jsonParameter(transformLegacyMessagePayload(row.message)),
            }),
            counts
        );
        await migratePaged(
            source,
            client,
            'general_access_log',
            'id',
            'general_access_log',
            ['general_id'],
            (row) => ({
                general_id: toNumber(row.general_id, 'general_access_log.general_id'),
                user_id: ownerUserId(row.user_id, options),
                last_refresh: toNullableDate(row.last_refresh, 'general_access_log.last_refresh'),
                refresh: toNumber(row.refresh, 'general_access_log.refresh'),
                refresh_total: toNumber(row.refresh_total, 'general_access_log.refresh_total'),
                refresh_score: toNumber(row.refresh_score, 'general_access_log.refresh_score'),
                refresh_score_total: toNumber(row.refresh_score_total, 'general_access_log.refresh_score_total'),
            }),
            counts
        );
        await migratePaged(
            source,
            client,
            'event',
            'id',
            'event',
            ['id'],
            (row) => ({
                id: toNumber(row.id, 'event.id'),
                target_code: toStringValue(row.target, 'event.target').toLowerCase(),
                priority: toNumber(row.priority, 'event.priority'),
                condition: nullableJson(row.condition, true, 'event.condition'),
                action: nullableJson(row.action, [], 'event.action'),
                meta: {},
                created_at: new Date(0),
            }),
            counts
        );

        const bettingRows = await querySource(
            source,
            `SELECT id, value FROM storage WHERE namespace = 'betting' ORDER BY id`
        );
        const betting = bettingRows.map((row) => {
            const sourceId = toNumber(row.id, 'storage.betting.id');
            const value = jsonObject(row.value, `storage.betting.${sourceId}`);
            return {
                id: Number(value.id),
                type: String(value.type),
                name: String(value.name),
                finished: Boolean(value.finished),
                select_count: Number(value.selectCnt),
                is_exclusive: value.isExclusive === null ? null : Boolean(value.isExclusive),
                requires_inheritance_point: Boolean(value.reqInheritancePoint),
                open_year_month: Number(value.openYearMonth),
                close_year_month: Number(value.closeYearMonth),
                candidates: value.candidates ?? [],
                winner: value.winner ?? null,
                created_at: new Date(0),
                updated_at: new Date(0),
            };
        });
        await insertBatches(client, 'nation_betting', betting, ['id'], counts);
        await migratePaged(
            source,
            client,
            'ng_betting',
            'id',
            'nation_bet',
            ['id'],
            (row) => {
                const selection = nullableJson(row.betting_type, [], 'ng_betting.betting_type');
                return {
                    id: toNumber(row.id, 'ng_betting.id'),
                    betting_id: toNumber(row.betting_id, 'ng_betting.betting_id'),
                    general_id: toNumber(row.general_id, 'ng_betting.general_id'),
                    user_id: ownerUserId(row.user_id, options),
                    selection,
                    selection_key: JSON.stringify(selection),
                    amount: toFloat(row.amount, 'ng_betting.amount'),
                    created_at: new Date(0),
                    updated_at: new Date(0),
                };
            },
            counts
        );
        await migratePaged(
            source,
            client,
            'ng_auction',
            'id',
            'auction',
            ['id'],
            (row) => {
                const detail = jsonObject(row.detail, 'ng_auction.detail');
                const type = toStringValue(row.type, 'ng_auction.type');
                return {
                    id: toNumber(row.id, 'ng_auction.id'),
                    type: type === 'buyRice' ? 'BUY_RICE' : type === 'sellRice' ? 'SELL_RICE' : 'UNIQUE_ITEM',
                    target_code: toNullableString(row.target),
                    host_general_id: toNumber(row.host_general_id, 'ng_auction.host_general_id'),
                    host_name: typeof detail.hostName === 'string' ? detail.hostName : null,
                    detail,
                    status: booleanValue(row.finished) ? 'FINISHED' : 'OPEN',
                    close_at: toDate(row.close_date, 'ng_auction.close_date'),
                    latest_event_id: `ref-auction-${toNumber(row.id, 'ng_auction.id')}`,
                    latest_event_at: toDate(row.open_date, 'ng_auction.open_date'),
                    finalizing_at: null,
                    finished_at: booleanValue(row.finished) ? toDate(row.close_date, 'ng_auction.close_date') : null,
                    created_at: toDate(row.open_date, 'ng_auction.open_date'),
                    updated_at: toDate(row.open_date, 'ng_auction.open_date'),
                };
            },
            counts
        );
        await migratePaged(
            source,
            client,
            'ng_auction_bid',
            'no',
            'auction_bid',
            ['id'],
            (row) => ({
                id: toNumber(row.no, 'ng_auction_bid.no'),
                auction_id: toNumber(row.auction_id, 'ng_auction_bid.auction_id'),
                general_id: toNumber(row.general_id, 'ng_auction_bid.general_id'),
                amount: toNumber(row.amount, 'ng_auction_bid.amount'),
                event_id: `ref-auction-bid-${toNumber(row.no, 'ng_auction_bid.no')}`,
                event_at: toDate(row.date, 'ng_auction_bid.date'),
                meta: nullableJson(row.aux, {}, 'ng_auction_bid.aux'),
                created_at: toDate(row.date, 'ng_auction_bid.date'),
            }),
            counts
        );
        await migratePaged(
            source,
            client,
            'ng_history',
            'no',
            'yearbook_history',
            ['profile_name', 'year', 'month', 'source_id'],
            (row) => {
                const id = toNumber(row.no, 'ng_history.no');
                const mapped: TargetRow = {
                    profile_name: toStringValue(row.server_id, 'ng_history.server_id'),
                    source_id: id,
                    year: toNumber(row.year, 'ng_history.year'),
                    month: toNumber(row.month, 'ng_history.month'),
                    map: nullableJson(row.map, {}, 'ng_history.map'),
                    nations: nullableJson(row.nations, [], 'ng_history.nations'),
                    global_history: nullableJson(row.global_history, [], 'ng_history.global_history'),
                    global_action: nullableJson(row.global_action, [], 'ng_history.global_action'),
                    hash: '',
                    created_at: new Date(0),
                };
                mapped.hash = hashYearbook(mapped);
                return mapped;
            },
            counts
        );
        await migrateStorageAndWorld(source, client, options, counts);

        const generalRecordMaxRows = await querySource(
            source,
            'SELECT COALESCE(MAX(id), 0) AS max_id FROM general_record'
        );
        const worldOffset = toNumber(generalRecordMaxRows[0]!.max_id, 'general_record.max_id');
        await migratePaged(
            source,
            client,
            'general_record',
            'id',
            'log_entry',
            ['id'],
            (row) => {
                const type = toStringValue(row.log_type, 'general_record.log_type');
                return {
                    id: toNumber(row.id, 'general_record.id'),
                    scope: 'GENERAL',
                    category:
                        type === 'action'
                            ? 'ACTION'
                            : type === 'battle_brief'
                              ? 'BATTLE_BRIEF'
                              : type === 'battle'
                                ? 'BATTLE_DETAIL'
                                : 'HISTORY',
                    sub_type: type,
                    year: toNumber(row.year, 'general_record.year'),
                    month: toNumber(row.month, 'general_record.month'),
                    text: toStringValue(row.text, 'general_record.text'),
                    general_id: toNumber(row.general_id, 'general_record.general_id'),
                    nation_id: null,
                    user_id: null,
                    meta: { source: 'ref.general_record' },
                    created_at: new Date(0),
                };
            },
            counts
        );
        await migratePaged(
            source,
            client,
            'world_history',
            'id',
            'log_entry',
            ['id'],
            (row) => ({
                id: worldOffset + toNumber(row.id, 'world_history.id'),
                scope: 'NATION',
                category: 'HISTORY',
                sub_type: 'world_history',
                year: toNumber(row.year, 'world_history.year'),
                month: toNumber(row.month, 'world_history.month'),
                text: toStringValue(row.text, 'world_history.text'),
                general_id: null,
                nation_id: toNumber(row.nation_id, 'world_history.nation_id'),
                user_id: null,
                meta: { source: 'ref.world_history', sourceId: toNumber(row.id, 'world_history.id') },
                created_at: new Date(0),
            }),
            counts
        );

        await client.query(`
            SELECT setval(pg_get_serial_sequence('message', 'id'), COALESCE((SELECT MAX(id) FROM message), 1), true);
            SELECT setval(pg_get_serial_sequence('log_entry', 'id'), COALESCE((SELECT MAX(id) FROM log_entry), 1), true);
            SELECT setval(pg_get_serial_sequence('auction', 'id'), COALESCE((SELECT MAX(id) FROM auction), 1), true);
            SELECT setval(pg_get_serial_sequence('auction_bid', 'id'), COALESCE((SELECT MAX(id) FROM auction_bid), 1), true);
            SELECT setval(pg_get_serial_sequence('nation_bet', 'id'), COALESCE((SELECT MAX(id) FROM nation_bet), 1), true)
        `);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
};

const collectDryRunCounts = async (source: MariaPool): Promise<Record<string, number>> => {
    const tables = [
        'city',
        'nation',
        'general',
        'troop',
        'diplomacy',
        'general_turn',
        'nation_turn',
        'rank_data',
        'message',
        'general_access_log',
        'event',
        'ng_betting',
        'ng_auction',
        'ng_auction_bid',
        'ng_history',
        'general_record',
        'world_history',
        'storage',
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) {
        const rows = await querySource(source, `SELECT COUNT(*) AS count FROM \`${table}\``);
        counts[table] = toNumber(rows[0]!.count, `${table}.count`);
    }
    return counts;
};

export const migrateCurrentSeasonFixture = async (
    source: MariaPool,
    target: PgPool,
    options: CurrentSeasonFixtureOptions
): Promise<CurrentSeasonSummary> => {
    const sourceContract = await readSourceContract(source);
    const targetTemplateContract = await readTargetContract(target);
    assertContract(sourceContract, options, 'Source');
    assertContract(targetTemplateContract, options, 'Target template');
    if (sourceContract.turnTermMinutes !== targetTemplateContract.turnTermMinutes) {
        throw new Error('Source and target template turn terms differ');
    }

    const counts = options.apply ? {} : await collectDryRunCounts(source);
    if (options.apply) {
        const client = await target.connect();
        try {
            await withMigrationLock(client, `sammo-current-season-fixture-v1:${options.profile}`, async () => {
                await replaceCurrentSeason(source, client, options, counts);
            });
        } finally {
            client.release();
        }
    }

    return {
        command: 'current-season-fixture',
        apply: options.apply,
        profile: options.profile,
        sourceContract,
        targetTemplateContract,
        counts,
        unsupported: {
            plock: 'Runtime lock rows are intentionally not copied.',
            reserved_open: 'Legacy process scheduling is not a Core database concept.',
            tournament: 'Core tournament brackets are Redis-owned and require a separate fixture.',
            select_pool: 'Selection reservations are ephemeral and intentionally not copied.',
            select_npc_token: 'Selection tokens are ephemeral and intentionally not copied.',
            statistic: 'Ref annual aggregate text has no lossless current Core table; source rows remain in Ref.',
            ng_diplomacy: 'Legacy diplomatic letters need a semantic state conversion before mutation is safe.',
        },
    };
};
