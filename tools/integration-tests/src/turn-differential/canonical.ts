export type CanonicalEngine = 'ref' | 'core2026';

export interface TurnSnapshotSelector {
    generalIds: number[];
    cityIds: number[];
    nationIds: number[];
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

export interface CanonicalTurnCommandTrace {
    schemaVersion: 1;
    engine: CanonicalEngine;
    execution: {
        kind: 'general' | 'nation' | 'instantNation';
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

const serializeDate = (value: Date | null): string | null => value?.toISOString() ?? null;

export const projectCoreDatabaseSnapshot = (rows: {
    world: {
        currentYear: number;
        currentMonth: number;
        tickSeconds: number;
        meta: unknown;
    };
    generals: Array<Record<string, unknown>>;
    rankData: Array<Record<string, unknown>>;
    cities: Array<Record<string, unknown>>;
    nations: Array<Record<string, unknown>>;
    diplomacy: Array<Record<string, unknown>>;
    generalTurns: Array<Record<string, unknown>>;
    nationTurns: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
}): CanonicalTurnSnapshot => {
    const worldMeta = asRecord(rows.world.meta);
    const legacyRankTypes = new Set<string>(LEGACY_RANK_DATA_TYPES);
    const generals = rows.generals.map((row) => {
        const meta = asRecord(row.meta);
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
            personality: row.personality ?? null,
            specialDomestic: row.specialDomestic ?? null,
            specialWar: row.specialWar ?? null,
            itemHorse: row.itemHorse ?? null,
            itemWeapon: row.itemWeapon ?? null,
            itemBook: row.itemBook ?? null,
            itemExtra: row.itemExtra ?? null,
            injury: row.injury,
            gold: row.gold,
            rice: row.rice,
            crew: row.crew,
            crewTypeId: row.crewTypeId,
            train: row.train,
            atmos: row.atmos,
            age: row.age,
            npcState: row.npcState,
            turnTime: row.turnTime instanceof Date ? serializeDate(row.turnTime) : row.turnTime,
            recentWarTime: row.recentWarTime instanceof Date ? serializeDate(row.recentWarTime) : row.recentWarTime,
            lastTurn: row.lastTurn,
            meta,
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
        };
    });
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

    return {
        schemaVersion: 1,
        engine: 'core2026',
        world: {
            year: rows.world.currentYear,
            month: rows.world.currentMonth,
            tickMinutes: Math.max(1, Math.round(rows.world.tickSeconds / 60)),
            turnTime: readString(worldMeta, 'lastTurnTime'),
            isUnited: readNumber(worldMeta, 'isUnited', readNumber(worldMeta, 'isunited')),
        },
        generals,
        rankData: rows.rankData
            .filter((row) => typeof row.type === 'string' && legacyRankTypes.has(row.type))
            .map((row) => ({
                generalId: row.generalId,
                nationId: row.nationId,
                type: row.type,
                value: row.value,
            })),
        cities,
        nations,
        diplomacy,
        generalTurns,
        nationTurns,
        logs,
        messages: [],
        watermarks: {
            logId: logs.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
            historyLogId: logs.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
            messageId: 0,
        },
    };
};
import { LEGACY_RANK_DATA_TYPES } from '@sammo-ts/common';
