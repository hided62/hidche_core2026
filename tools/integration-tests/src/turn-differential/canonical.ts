import { GAME_TICKS_PER_TURN, LEGACY_RANK_DATA_TYPES, RANK_DATA_TYPES } from '@sammo-ts/common';

export type CanonicalEngine = 'ref' | 'core2026';

export interface TurnSnapshotSelector {
    generalIds: number[];
    cityIds: number[];
    nationIds: number[];
    troopIds?: number[];
    allGenerals?: boolean;
    allCities?: boolean;
    allNations?: boolean;
    allTroops?: boolean;
    includeRankMirrors?: boolean;
    logAfterId?: number;
    messageAfterId?: number;
    includeNationHistoryLogs?: boolean;
    includeGlobalHistoryLogs?: boolean;
}

export interface CanonicalTurnSnapshot {
    schemaVersion: 1;
    engine: CanonicalEngine;
    world: Record<string, unknown>;
    generals: Array<Record<string, unknown>>;
    rankData: Array<Record<string, unknown>>;
    cities: Array<Record<string, unknown>>;
    nations: Array<Record<string, unknown>>;
    troops: Array<Record<string, unknown>>;
    diplomacy: Array<Record<string, unknown>>;
    generalTurns: Array<Record<string, unknown>>;
    nationTurns: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    watermarks: {
        logId: number;
        historyLogId: number;
        messageId: number;
    };
}

export interface TurnSnapshotEntityIds {
    generalIds: number[];
    cityIds: number[];
    nationIds: number[];
    troopIds: number[];
}

const unionEntityIds = (selected: readonly number[] | undefined, created: readonly number[]): number[] =>
    [...new Set([...(selected ?? []), ...created])].sort((left, right) => left - right);

/**
 * Keep the explicit observation boundary, but extend the after snapshot over
 * entities created during the execution. Otherwise a successful create can be
 * absent from both the selector query and the resulting differential.
 */
export const closeTurnSnapshotSelectorOverCreatedEntities = (
    selector: TurnSnapshotSelector,
    before: TurnSnapshotEntityIds,
    after: TurnSnapshotEntityIds
): TurnSnapshotSelector => {
    const created = <Key extends keyof TurnSnapshotEntityIds>(key: Key): number[] => {
        const previous = new Set(before[key]);
        return after[key].filter((id) => !previous.has(id));
    };
    return {
        ...selector,
        generalIds: unionEntityIds(selector.generalIds, created('generalIds')),
        cityIds: unionEntityIds(selector.cityIds, created('cityIds')),
        nationIds: unionEntityIds(selector.nationIds, created('nationIds')),
        troopIds: unionEntityIds(selector.troopIds, created('troopIds')),
    };
};

export interface CanonicalTurnCommandTrace {
    schemaVersion: 1;
    engine: CanonicalEngine;
    execution: {
        kind: 'general' | 'nation' | 'instantNation' | 'troopJoinStaticEvent';
        actorGeneralId: number;
        action: string;
        args: unknown;
        seedDomain: 'generalCommand' | 'nationCommand' | 'none';
        outcome?: unknown;
    };
    before: CanonicalTurnSnapshot;
    after: CanonicalTurnSnapshot;
    rng: Array<{
        seq: number;
        operation: string;
        arguments: Record<string, unknown>;
        result: unknown;
    }>;
}

const legacyArgumentAliases: Readonly<Record<string, string>> = {
    destCityID: 'destCityId',
    destNationID: 'destNationId',
    destGeneralID: 'destGeneralId',
    destTroopID: 'destTroopId',
};

export const canonicalizeTurnCommandArgs = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(canonicalizeTurnCommandArgs);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .map(([key, entry]) => [legacyArgumentAliases[key] ?? key, canonicalizeTurnCommandArgs(entry)] as const)
            .sort(([left], [right]) => left.localeCompare(right))
    );
};

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readNumber = (record: Record<string, unknown>, key: string, fallback = 0): number => {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const readString = (record: Record<string, unknown>, key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' ? value : null;
};

const readNullableCode = (record: Record<string, unknown>, key: string): string | null => {
    const value = readString(record, key);
    return value && value !== 'None' ? value : null;
};

const readCommandInteger = (value: unknown, field: string, fallback: number | null): number | null => {
    if (value === null || value === undefined) {
        return fallback;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new Error(`${field} must be a safe integer`);
    }
    return value;
};

const readCommandBoolean = (value: unknown, field: string): boolean => {
    if (value === null || value === undefined || value === false || value === 0) {
        return false;
    }
    if (value === true || value === 1) {
        return true;
    }
    throw new Error(`${field} must be a boolean flag`);
};

const readCommandOptionalString = (value: unknown, field: string): string | null => {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (typeof value !== 'string') {
        throw new Error(`${field} must be a string`);
    }
    return value;
};

const readCommandValue = (
    fields: Record<string, unknown>,
    fieldKey: string,
    meta: Record<string, unknown>,
    metaKey = fieldKey
): unknown => (Object.prototype.hasOwnProperty.call(fields, fieldKey) ? fields[fieldKey] : meta[metaKey]);

const readSafeTick = (value: unknown, field: string): number | null => {
    if (value === null || value === undefined) {
        return null;
    }
    const numeric = typeof value === 'bigint' ? Number(value) : value;
    if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric)) {
        throw new Error(`${field} must be a safe integer`);
    }
    return numeric;
};

export const projectCanonicalTurnOffset = (
    turnTickValue: unknown,
    baseTurnTickValue: unknown,
    turnSecondsValue: unknown
): { turnSecond: number | null; turnFraction: number | null } => {
    const turnTick = readSafeTick(turnTickValue, 'general.turnTick');
    const baseTurnTick = readSafeTick(baseTurnTickValue, 'world.lastTurnTick');
    if (turnTick === null || baseTurnTick === null) {
        return { turnSecond: null, turnFraction: null };
    }
    const turnSeconds = readCommandInteger(turnSecondsValue, 'world.tickSeconds', null);
    if (turnSeconds === null || turnSeconds <= 0 || GAME_TICKS_PER_TURN % turnSeconds !== 0) {
        throw new Error('world.tickSeconds must divide the legacy game-turn tick domain');
    }
    const ticksPerSecond = GAME_TICKS_PER_TURN / turnSeconds;
    const offsetTicks = turnTick - baseTurnTick;
    const turnSecond = Math.floor(offsetTicks / ticksPerSecond);
    const remainingTicks = offsetTicks - turnSecond * ticksPerSecond;
    return {
        turnSecond,
        turnFraction: Math.floor((remainingTicks * 1_000_000) / ticksPerSecond),
    };
};

const projectCanonicalSpyState = (value: unknown): Array<{ cityId: number; remainingTurns: number }> => {
    if (value === null || value === undefined) {
        return [];
    }
    if (typeof value !== 'object') {
        throw new Error('nation.commandState.spy must be an object');
    }
    return Object.entries(value)
        .map(([cityIdText, remainingTurns]) => {
            const cityId = Number(cityIdText);
            if (!Number.isSafeInteger(cityId) || cityId < 1) {
                throw new Error(`nation.commandState.spy has an invalid city id: ${cityIdText}`);
            }
            const turns = readCommandInteger(remainingTurns, `nation.commandState.spy[${cityIdText}]`, null);
            if (turns === null) {
                throw new Error(`nation.commandState.spy[${cityIdText}] is missing`);
            }
            return { cityId, remainingTurns: turns };
        })
        .sort((left, right) => left.cityId - right.cityId);
};

/** Command-relevant General.aux fields kept outside the intentionally ignored raw meta graph. */
export const projectCanonicalGeneralCommandState = (metaValue: unknown): Record<string, unknown> => {
    const meta = asRecord(metaValue);
    return {
        recruitmentArmType: readCommandInteger(meta.armType, 'general.commandState.recruitmentArmType', null),
    };
};

/** Persisted General columns/semantics that commands mutate or initialize. */
export const projectCanonicalGeneralStoredFields = (
    metaValue: unknown,
    fieldsValue: unknown = {}
): Record<string, unknown> => {
    const meta = asRecord(metaValue);
    const fields = asRecord(fieldsValue);
    return {
        expLevel: readCommandInteger(readCommandValue(fields, 'expLevel', meta, 'explevel'), 'general.expLevel', 0),
        dedLevel: readCommandInteger(readCommandValue(fields, 'dedLevel', meta, 'dedlevel'), 'general.dedLevel', 0),
        affinity: readCommandInteger(readCommandValue(fields, 'affinity', meta), 'general.affinity', null),
        bornYear: readCommandInteger(readCommandValue(fields, 'bornYear', meta, 'birthYear'), 'general.bornYear', null),
        deadYear: readCommandInteger(readCommandValue(fields, 'deadYear', meta, 'deathYear'), 'general.deadYear', null),
        npcMessage: readCommandOptionalString(
            readCommandValue(fields, 'npcMessage', meta, 'text'),
            'general.npcMessage'
        ),
        npcOriginalState: readCommandInteger(
            readCommandValue(fields, 'npcOriginalState', meta, 'npc_org'),
            'general.npcOriginalState',
            0
        ),
        turnTick: readSafeTick(readCommandValue(fields, 'turnTick', meta), 'general.turnTick'),
        turnSecond: readCommandInteger(fields.turnSecond, 'general.turnSecond', null),
        turnFraction: readCommandInteger(fields.turnFraction, 'general.turnFraction', null),
    };
};

/** Command-relevant nation aux/spy fields kept outside the intentionally ignored raw meta graph. */
export const projectCanonicalNationCommandState = (
    metaValue: unknown,
    spyValue: unknown = asRecord(metaValue).spy,
    fieldsValue: unknown = {}
): Record<string, unknown> => {
    const meta = asRecord(metaValue);
    const fields = asRecord(fieldsValue);
    return {
        flagChangesRemaining: readCommandInteger(meta.can_국기변경, 'nation.commandState.flagChangesRemaining', 0),
        randomCapitalMovesRemaining: readCommandInteger(
            meta.can_무작위수도이전,
            'nation.commandState.randomCapitalMovesRemaining',
            0
        ),
        spy: projectCanonicalSpyState(spyValue),
        collapsed: readCommandBoolean(meta.collapsed, 'nation.commandState.collapsed'),
        rate: readCommandInteger(readCommandValue(fields, 'rate', meta), 'nation.commandState.rate', 0),
        bill: readCommandInteger(readCommandValue(fields, 'bill', meta), 'nation.commandState.bill', 0),
        secretLimit: readCommandInteger(
            readCommandValue(fields, 'secretLimit', meta, 'secretlimit'),
            'nation.commandState.secretLimit',
            3
        ),
    };
};

const serializeDate = (value: Date | null): string | null => value?.toISOString() ?? null;
const messageMailboxNationalBase = 9_000;

export const CANONICAL_MESSAGE_VALID_UNTIL_INFINITE = 'infinite' as const;

/**
 * Ref persists an unbounded message lifetime as GameClock::MAX_SAFE_TICK,
 * while Core's Date fallback persists the legacy year-9999 sentinel. Keep the
 * semantic distinction explicit instead of conflating it with null/missing.
 */
export const projectCanonicalMessageValidUntil = (
    value: unknown
): string | typeof CANONICAL_MESSAGE_VALID_UNTIL_INFINITE => {
    if (value === CANONICAL_MESSAGE_VALID_UNTIL_INFINITE) {
        return value;
    }
    if (value === null || value === undefined) {
        throw new Error('message.validUntil must be a finite timestamp or the infinite sentinel');
    }
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
        throw new Error(`message.validUntil must be a valid timestamp: ${String(value)}`);
    }
    if (date.getUTCFullYear() === 9999) {
        return CANONICAL_MESSAGE_VALID_UNTIL_INFINITE;
    }
    return date.toISOString();
};

export const projectCoreDatabaseSnapshot = (rows: {
    world: {
        currentYear: number;
        currentMonth: number;
        tickSeconds: number;
        meta: unknown;
        gameNow?: Date | string;
        lastTurnTick?: bigint | number | null;
    };
    generals: Array<Record<string, unknown>>;
    rankData: Array<Record<string, unknown>>;
    cities: Array<Record<string, unknown>>;
    nations: Array<Record<string, unknown>>;
    troops: Array<Record<string, unknown>>;
    diplomacy: Array<Record<string, unknown>>;
    generalTurns: Array<Record<string, unknown>>;
    nationTurns: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    messageReadStates?: Array<Record<string, unknown>>;
    messageInboxRows?: Array<Record<string, unknown>>;
    messageWatermark?: number;
    includeRankMirrors?: boolean;
}): CanonicalTurnSnapshot => {
    const worldMeta = asRecord(rows.world.meta);
    const projectedRankTypes = new Set<string>(rows.includeRankMirrors ? RANK_DATA_TYPES : LEGACY_RANK_DATA_TYPES);
    const messageReadStateByGeneralId = new Map(
        (rows.messageReadStates ?? []).map((row) => [readNumber(row, 'generalId'), row] as const)
    );
    const messageInboxRows = rows.messageInboxRows ?? [];
    const generals = rows.generals.map((row) => {
        const meta = asRecord(row.meta);
        const turnOffset = projectCanonicalTurnOffset(row.turnTick, rows.world.lastTurnTick, rows.world.tickSeconds);
        const generalId = readNumber(row, 'id');
        const nationId = readNumber(row, 'nationId');
        const readState = messageReadStateByGeneralId.get(generalId) ?? {};
        const latestReadPrivateMessageId = readNumber(readState, 'latestPrivateMessage');
        const latestReadDiplomacyMessageId = readNumber(readState, 'latestDiplomacyMessage');
        const diplomacyMailbox = messageMailboxNationalBase + nationId;
        const unreadPrivateCount = messageInboxRows.filter(
            (message) =>
                message.type === 'private' &&
                readNumber(message, 'mailbox') === generalId &&
                readNumber(message, 'src') !== generalId &&
                readNumber(message, 'id') > latestReadPrivateMessageId
        ).length;
        const unreadDiplomacyCount = messageInboxRows.filter(
            (message) =>
                message.type === 'diplomacy' &&
                readNumber(message, 'mailbox') === diplomacyMailbox &&
                readNumber(message, 'src') !== diplomacyMailbox &&
                readNumber(message, 'id') > latestReadDiplomacyMessageId
        ).length;
        return {
            id: row.id,
            name: row.name,
            nationId: row.nationId,
            cityId: row.cityId,
            troopId: row.troopId,
            leadership: row.leadership,
            strength: row.strength,
            intelligence: row.intel,
            experience: row.experience,
            dedication: row.dedication,
            officerLevel: row.officerLevel,
            officerCityId: readNumber(
                row,
                'officerCityId',
                readNumber(meta, 'officer_city', readNumber(meta, 'officerCity', readNumber(meta, 'officerCityId')))
            ),
            belong: readNumber(row, 'belong', readNumber(meta, 'belong')),
            permission: readString(row, 'permission') ?? readString(meta, 'permission') ?? 'normal',
            maxBelong: readNumber(meta, 'max_belong'),
            maxDomesticCritical: readNumber(meta, 'max_domestic_critical'),
            betray: row.betray,
            personality: readNullableCode(row, 'personality') ?? readNullableCode(row, 'personalCode'),
            specialDomestic: readNullableCode(row, 'specialDomestic') ?? readNullableCode(row, 'specialCode'),
            specialWar: readNullableCode(row, 'specialWar') ?? readNullableCode(row, 'special2Code'),
            itemHorse: readNullableCode(row, 'itemHorse') ?? readNullableCode(row, 'horseCode'),
            itemWeapon: readNullableCode(row, 'itemWeapon') ?? readNullableCode(row, 'weaponCode'),
            itemBook: readNullableCode(row, 'itemBook') ?? readNullableCode(row, 'bookCode'),
            itemExtra: readNullableCode(row, 'itemExtra') ?? readNullableCode(row, 'itemCode'),
            picture: row.picture ?? null,
            imageServer: readNumber(row, 'imageServer'),
            injury: row.injury,
            gold: row.gold,
            rice: row.rice,
            crew: row.crew,
            crewTypeId: row.crewTypeId,
            train: row.train,
            atmos: row.atmos,
            age: row.age,
            npcState: row.npcState,
            hasOwner: typeof row.userId === 'string' && row.userId.length > 0,
            ownerIdentity: typeof row.userId === 'string' && row.userId.length > 0 ? row.userId : null,
            messageReadState: {
                unreadPrivateCount,
                unreadDiplomacyCount,
                hasUnreadMessage: unreadPrivateCount + unreadDiplomacyCount > 0,
            },
            turnTime: row.turnTime instanceof Date ? serializeDate(row.turnTime) : row.turnTime,
            recentWarTime: row.recentWarTime instanceof Date ? serializeDate(row.recentWarTime) : row.recentWarTime,
            lastTurn: row.lastTurn,
            meta,
            ...projectCanonicalGeneralStoredFields(meta, {
                expLevel: meta.explevel,
                dedLevel: meta.dedlevel,
                affinity: row.affinity,
                bornYear: row.bornYear,
                deadYear: row.deadYear,
                npcOriginalState: meta.npc_org,
                turnTick: row.turnTick,
                ...turnOffset,
            }),
            commandState: projectCanonicalGeneralCommandState(meta),
            leadershipExp: readNumber(meta, 'leadership_exp'),
            strengthExp: readNumber(meta, 'strength_exp'),
            intelExp: readNumber(meta, 'intel_exp'),
            dex1: readNumber(meta, 'dex1'),
            dex2: readNumber(meta, 'dex2'),
            dex3: readNumber(meta, 'dex3'),
            dex4: readNumber(meta, 'dex4'),
            dex5: readNumber(meta, 'dex5'),
            specAge: readNumber(meta, 'specage'),
            specAge2: readNumber(meta, 'specage2'),
            inheritActiveActionPoints: readNumber(meta, 'inherit_active_action') * 3,
            makeLimit: readNumber(meta, 'makelimit'),
            penalty: asRecord(row.penalty),
            killTurn: readNumber(row, 'killTurn', readNumber(meta, 'killturn')),
            mySet: readNumber(row, 'mySet', readNumber(meta, 'myset')),
        };
    });
    const cities = rows.cities.map((row) => {
        const meta = asRecord(row.meta);
        return {
            id: row.id,
            name: row.name,
            nationId: row.nationId,
            level: row.level,
            population: row.population,
            populationMax: row.populationMax,
            agriculture: row.agriculture,
            agricultureMax: row.agricultureMax,
            commerce: row.commerce,
            commerceMax: row.commerceMax,
            security: row.security,
            securityMax: row.securityMax,
            supplyState: row.supplyState,
            frontState: row.frontState,
            defence: row.defence,
            defenceMax: row.defenceMax,
            wall: row.wall,
            wallMax: row.wallMax,
            conflict: asRecord(row.conflict),
            state: readNumber(meta, 'state'),
            term: readNumber(meta, 'term'),
            trust: row.trust,
            trade: row.trade,
            officerSet: readNumber(meta, 'officer_set'),
        };
    });
    const nations = rows.nations.map((row) => {
        const meta = asRecord(row.meta);
        return {
            id: row.id,
            name: row.name,
            color: row.color,
            capitalCityId: row.capitalCityId,
            gold: row.gold,
            rice: row.rice,
            tech: row.tech,
            level: row.level,
            typeCode: row.typeCode,
            generalCount: readNumber(meta, 'gennum'),
            power: readNumber(meta, 'power'),
            war: readNumber(meta, 'war'),
            diplomacyLimit: readNumber(meta, 'surlimit'),
            capitalRevision: readNumber(meta, 'capset'),
            strategicCommandLimit: readNumber(meta, 'strategic_cmd_limit'),
            meta,
            commandState: projectCanonicalNationCommandState(meta),
        };
    });
    const troops = rows.troops.map((row) => ({
        id: row.troopLeaderId,
        nationId: row.nationId,
        name: row.name,
    }));
    const diplomacy = rows.diplomacy.map((row) => ({
        fromNationId: row.srcNationId,
        toNationId: row.destNationId,
        state: row.stateCode,
        term: row.term,
        dead: row.isDead === true ? 1 : 0,
    }));
    const generalTurns = rows.generalTurns.map((row) => ({
        generalId: row.generalId,
        turnIndex: row.turnIdx,
        action: row.actionCode,
        args: row.arg,
    }));
    const nationTurns = rows.nationTurns.map((row) => ({
        nationId: row.nationId,
        officerLevel: row.officerLevel,
        turnIndex: row.turnIdx,
        action: row.actionCode,
        args: row.arg,
    }));
    const logs = rows.logs.map((row) => ({
        id: row.id,
        scope: readString(row, 'scope'),
        category: readString(row, 'category')?.toLowerCase() ?? null,
        generalId: row.generalId,
        nationId: row.nationId,
        year: row.year,
        month: row.month,
        text: row.text,
    }));
    const messages = rows.messages.map((row) => ({
        id: row.id,
        mailbox: row.mailbox,
        type: row.type,
        sourceId: row.src,
        destinationId: row.dest,
        createdAt: row.time instanceof Date ? serializeDate(row.time) : row.time,
        validUntil: projectCanonicalMessageValidUntil(
            Object.prototype.hasOwnProperty.call(row, 'effectiveValidUntil') ? row.effectiveValidUntil : row.validUntil
        ),
        payload: row.message,
    }));

    return {
        schemaVersion: 1,
        engine: 'core2026',
        world: {
            year: rows.world.currentYear,
            month: rows.world.currentMonth,
            tickMinutes: Math.max(1, Math.round(rows.world.tickSeconds / 60)),
            lastTurnTick: readSafeTick(rows.world.lastTurnTick, 'world.lastTurnTick'),
            turnTime: readString(worldMeta, 'lastTurnTime'),
            ...(rows.world.gameNow !== undefined
                ? {
                      gameNow:
                          rows.world.gameNow instanceof Date ? serializeDate(rows.world.gameNow) : rows.world.gameNow,
                  }
                : {}),
            isUnited: readNumber(worldMeta, 'isUnited', readNumber(worldMeta, 'isunited')),
        },
        generals,
        rankData: rows.rankData
            .filter((row) => typeof row.type === 'string' && projectedRankTypes.has(row.type))
            .map((row) => ({
                generalId: row.generalId,
                nationId: row.nationId,
                type: row.type,
                value: row.value,
            })),
        cities,
        nations,
        troops,
        diplomacy,
        generalTurns,
        nationTurns,
        logs,
        messages,
        watermarks: {
            logId: logs.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
            historyLogId: logs.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
            messageId: rows.messageWatermark ?? messages.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
        },
    };
};
