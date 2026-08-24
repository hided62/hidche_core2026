import { z } from 'zod';

import { asNumber, asRecord, GAME_TICKS_PER_TURN, JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { acquireGameSchemaAdvisoryXactLock, GamePrisma } from '@sammo-ts/infra';
import {
    EventDomesticTraitLoader,
    isEventDomesticTraitKey,
    isPersonalityTraitKey,
    isWarTraitKey,
    LogCategory,
    LogScope,
    PERSONALITY_TRAIT_KEYS,
    CENTENNIAL_ALL_STAR_AUX_KEY,
    CENTENNIAL_ALL_STAR_DEFAULT_DEX_LIMIT,
    CENTENNIAL_ALL_STAR_POOL,
    applyCentennialAllStarTarget,
    calculateCentennialUserCurrentTargetStats,
    calculateCentennialUserInitialStats,
    buildScenarioGeneralPoolClaimMeta,
    initialCentennialAllStarAux,
    parseScenarioGeneralPoolCandidate,
    prepareCentennialLegacyUserReselection,
    simpleSerialize,
    WarTraitLoader,
} from '@sammo-ts/logic';
import type { CentennialAllStarEnvironment, CentennialAllStarRules, CentennialAllStarTarget } from '@sammo-ts/logic';

import type { DatabaseClient, GamePrisma as GamePrismaTypes } from '@sammo-ts/infra';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import { buildPrestartDeleteAfter } from './prestartDeletion.js';
import type { TurnGeneral, TurnGeneralPoolEntry } from './types.js';

type WorldStateRow = GamePrismaTypes.WorldStateGetPayload<Record<string, never>>;

export type SelectPoolErrorCode = 'BAD_REQUEST' | 'PRECONDITION_FAILED' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR';

export class SelectPoolError extends Error {
    constructor(
        readonly code: SelectPoolErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'SelectPoolError';
    }
}

const LEGACY_SELECTION_POOL = 'SPoolUnderU30';
const SUPPORTED_POOLS = new Set([LEGACY_SELECTION_POOL, CENTENNIAL_ALL_STAR_POOL]);
const RESERVATION_COUNT = 14;
const RESERVATION_TURN_MULTIPLIER = 2;
const RESELECTION_TURN_MULTIPLIER = 12;
const DEFAULT_MAX_GENERAL = 500;
const DEFAULT_CREW_TYPE_ID = 1100;
const MAX_GENERAL_TURNS = 30;
const DEFAULT_TURN_ACTION = '휴식';

export const resolveSelectionPoolUserIcon = (options: {
    showImgLevel: number;
    ownerPicture?: string;
    ownerImageServer?: number;
}): { picture: string; imageServer: number } => {
    const useOwnerPicture =
        options.showImgLevel >= 1 && typeof options.ownerPicture === 'string' && options.ownerPicture !== 'default.jpg';
    return useOwnerPicture
        ? { picture: options.ownerPicture!, imageServer: options.ownerImageServer ?? 1 }
        : { picture: 'default.jpg', imageServer: 0 };
};

const zCandidateInfo = z.object({
    uniqueName: z.string().min(1),
    generalName: z.string().min(1),
    leadership: z.number().int(),
    strength: z.number().int(),
    intel: z.number().int(),
    specialDomestic: z.string().min(1).nullable(),
    specialWar: z.string().min(1).optional(),
    ego: z.string().min(1).optional(),
    experience: z.number().int().optional(),
    dedication: z.number().int().optional(),
    dex: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
    imgsvr: z.union([z.literal(0), z.literal(1)]),
    picture: z.string(),
});

export type SelectPoolCandidateInfo = z.infer<typeof zCandidateInfo>;

interface SelectPoolRow {
    id: number;
    uniqueName: string;
    ownerUserId: string | null;
    generalId: number | null;
    reservedUntil: Date | null;
    reservedUntilTick: bigint | null;
    info: unknown;
}

export interface SelectPoolCandidateDto {
    uniqueName: string;
    generalName: string;
    leadership: number;
    strength: number;
    intel: number;
    specialDomestic: string | null;
    specialDomesticName: string | null;
    specialDomesticInfo: string;
    specialWar: string | null;
    specialWarName: string | null;
    specialWarInfo: string;
    ego: string | null;
    dex: [number, number, number, number, number];
    imageServer: 0 | 1;
    picture: string;
}

export interface SelectPoolReservationDto {
    poolName: string;
    hasGeneral: boolean;
    validUntil: string;
    candidates: SelectPoolCandidateDto[];
}

const fail = (code: SelectPoolErrorCode, message: string): never => {
    throw new SelectPoolError(code, message);
};

const resolvePoolName = (worldState: WorldStateRow): string | null => {
    const config = asRecord(worldState.config);
    const map = asRecord(config.map);
    return typeof map.targetGeneralPool === 'string' ? map.targetGeneralPool : null;
};

const resolvePoolAllowOptions = (worldState: WorldStateRow): string[] => {
    const map = asRecord(asRecord(worldState.config).map);
    return Array.isArray(map.generalPoolAllowOption)
        ? map.generalPoolAllowOption.filter((value): value is string => typeof value === 'string')
        : [];
};

const resolveTurnTermMinutes = (worldState: WorldStateRow): number => {
    const config = asRecord(worldState.config);
    const configured = asNumber(config.turnTermMinutes, Math.round(worldState.tickSeconds / 60));
    return Math.max(1, Math.abs(Math.trunc(configured)));
};

export const isSelectionPoolWorld = (worldState: WorldStateRow): boolean => {
    const config = asRecord(worldState.config);
    const poolName = resolvePoolName(worldState);
    return asNumber(config.npcMode, 0) === 2 && poolName !== null && SUPPORTED_POOLS.has(poolName);
};

export const resolveSelectionMaxGeneral = (worldState: WorldStateRow): number => {
    const config = asRecord(worldState.config);
    const configConst = asRecord(config.const);
    return Math.max(
        0,
        Math.floor(
            asNumber(config.maxGeneral ?? configConst.defaultMaxGeneral ?? configConst.maxGeneral, DEFAULT_MAX_GENERAL)
        )
    );
};

const requirePoolWorld = (worldState: WorldStateRow): void => {
    if (!isSelectionPoolWorld(worldState)) {
        fail('PRECONDITION_FAILED', '선택 가능한 서버가 아닙니다');
    }
};

const parseCandidate = (row: Pick<SelectPoolRow, 'uniqueName' | 'info'>): SelectPoolCandidateInfo => {
    const info = zCandidateInfo.safeParse(row.info);
    if (!info.success || !info.data) {
        throw new SelectPoolError(
            'INTERNAL_SERVER_ERROR',
            `장수 선택 후보 정보가 올바르지 않습니다: ${row.uniqueName}`
        );
    }
    const candidate = info.data;
    if (candidate.uniqueName !== row.uniqueName) {
        throw new SelectPoolError(
            'INTERNAL_SERVER_ERROR',
            `장수 선택 후보 정보가 올바르지 않습니다: ${row.uniqueName}`
        );
    }
    return candidate;
};

export const calculateSelectionCandidateWeight = (
    poolName: string,
    candidate: SelectPoolCandidateInfo,
    ownerIsUser: boolean
): number => {
    const dexWeight = candidate.dex.reduce((sum, value) => sum + value, 0);
    if (poolName !== CENTENNIAL_ALL_STAR_POOL) {
        return dexWeight;
    }
    const eligibleDexWeight = Math.max(100_000, dexWeight);
    if (!ownerIsUser) {
        return eligibleDexWeight;
    }
    const statTotal = candidate.leadership + candidate.strength + candidate.intel;
    const normalizedStat = Math.min(1, Math.max(0, (statTotal - 160) / 30));
    return eligibleDexWeight * (1 + 0.5 * normalizedStat);
};

const resolveCentennialEnvironment = (worldState: WorldStateRow): CentennialAllStarEnvironment => {
    const scenarioMeta = asRecord(asRecord(worldState.meta).scenarioMeta);
    return {
        startYear: Math.trunc(asNumber(scenarioMeta.startYear, worldState.currentYear)),
        year: worldState.currentYear,
        month: worldState.currentMonth,
    };
};

const resolveCentennialRules = (worldState: WorldStateRow): CentennialAllStarRules => {
    const config = asRecord(worldState.config);
    const stat = asRecord(config.stat);
    const configConst = asRecord(config.const);
    const defaultSpecialDomestic = configConst.defaultSpecialDomestic;
    return {
        defaultStatMin: asNumber(stat.min, 15),
        defaultStatMax: asNumber(stat.max, 80),
        defaultStatTotal: asNumber(stat.total, 165),
        maxStatLevel: asNumber(configConst.maxLevel, 255),
        defaultSpecialDomestic: typeof defaultSpecialDomestic === 'string' ? defaultSpecialDomestic : 'None',
        dexLimit: asNumber(configConst.dexLimit, CENTENNIAL_ALL_STAR_DEFAULT_DEX_LIMIT),
    };
};

const asCentennialTarget = (candidate: SelectPoolCandidateInfo): CentennialAllStarTarget => ({
    ...candidate,
    specialDomestic: candidate.specialDomestic,
});

const eventDomesticTraitLoader = new EventDomesticTraitLoader();
const warTraitLoader = new WarTraitLoader();

const toCandidateDto = async (candidate: SelectPoolCandidateInfo): Promise<SelectPoolCandidateDto> => {
    const trait =
        candidate.specialDomestic && isEventDomesticTraitKey(candidate.specialDomestic)
            ? await eventDomesticTraitLoader.load(candidate.specialDomestic)
            : null;
    const warTrait =
        candidate.specialWar && isWarTraitKey(candidate.specialWar)
            ? await warTraitLoader.load(candidate.specialWar)
            : null;
    return {
        uniqueName: candidate.uniqueName,
        generalName: candidate.generalName,
        leadership: candidate.leadership,
        strength: candidate.strength,
        intel: candidate.intel,
        specialDomestic: candidate.specialDomestic,
        specialDomesticName: trait?.name ?? candidate.specialDomestic?.replace(/^che_event_/, '') ?? null,
        specialDomesticInfo: trait?.info ?? '',
        specialWar: candidate.specialWar ?? null,
        specialWarName: warTrait?.name ?? candidate.specialWar?.replace(/^che_(?:event_)?/u, '') ?? null,
        specialWarInfo: warTrait?.info ?? '',
        ego: candidate.ego ?? null,
        dex: candidate.dex,
        imageServer: candidate.imgsvr,
        picture: candidate.picture,
    };
};

const toReservationDto = (
    rows: Array<Pick<SelectPoolRow, 'id' | 'uniqueName' | 'reservedUntil' | 'reservedUntilTick' | 'info'>>,
    hasGeneral: boolean,
    worldState: WorldStateRow,
    world: InMemoryTurnWorld
): Promise<SelectPoolReservationDto> => {
    const first = rows[0];
    if (!first || (first.reservedUntilTick === null && first.reservedUntil === null)) {
        throw new SelectPoolError('INTERNAL_SERVER_ERROR', '장수 선택 후보의 유효기간이 없습니다.');
    }
    const expiresAt =
        first.reservedUntilTick === null
            ? first.reservedUntil!
            : world.gameTickToDate(toSafeReservationTick(first.reservedUntilTick, first.uniqueName));
    const poolName = resolvePoolName(worldState);
    if (!poolName || !SUPPORTED_POOLS.has(poolName)) {
        throw new SelectPoolError('PRECONDITION_FAILED', '선택 가능한 서버가 아닙니다');
    }
    const centennialEnvironment = resolveCentennialEnvironment(worldState);
    const centennialRules = resolveCentennialRules(worldState);
    const sorted = rows
        .map((row) => {
            const raw = parseCandidate(row);
            if (poolName !== CENTENNIAL_ALL_STAR_POOL) {
                return { id: row.id, info: raw };
            }
            const target = asCentennialTarget(raw);
            const display = hasGeneral
                ? calculateCentennialUserCurrentTargetStats(target, centennialEnvironment, centennialRules)
                : calculateCentennialUserInitialStats(target, centennialRules);
            return {
                id: row.id,
                info: {
                    ...raw,
                    leadership: display.leadership,
                    strength: display.strength,
                    intel: display.intel,
                },
            };
        })
        .sort(
            (left, right) =>
                left.info.dex.reduce((sum, value) => sum + value, 0) -
                    right.info.dex.reduce((sum, value) => sum + value, 0) || left.id - right.id
        );
    return Promise.all(sorted.map((entry) => toCandidateDto(entry.info))).then((candidates) => ({
        poolName,
        hasGeneral,
        validUntil: expiresAt.toISOString(),
        candidates,
    }));
};

export const buildSelectPoolSeed = (
    hiddenSeed: string | number,
    ownerIdentity: string | number,
    nowTick: number
): string => simpleSerialize(hiddenSeed, 'selectPool', ownerIdentity, nowTick);

export const claimWeightedSelectionCandidates = async <T extends { id: number }>(options: {
    weighted: [T, number][];
    rng: RandUtil;
    count: number;
    claim(candidate: T): Promise<boolean>;
    onDraw?(candidate: T): void;
    maxAttempts?: number;
}): Promise<T[]> => {
    const claimed: T[] = [];
    const claimedIds = new Set<number>();
    const maxAttempts = options.maxAttempts ?? Math.max(options.weighted.length * 8, 1000);
    let attempts = 0;
    while (claimed.length < options.count && attempts < maxAttempts) {
        attempts += 1;
        const candidate = options.rng.choiceUsingWeightPair(options.weighted);
        options.onDraw?.(candidate);
        if (claimedIds.has(candidate.id) || !(await options.claim(candidate))) {
            continue;
        }
        claimedIds.add(candidate.id);
        claimed.push(candidate);
    }
    return claimed;
};

const readNextChangeAt = (generalMeta: unknown): Date | null => {
    const meta = asRecord(generalMeta);
    const raw = meta.next_change ?? meta.nextChangeAt;
    if (typeof raw !== 'string') {
        return null;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getWorldHiddenSeed = (worldState: WorldStateRow): string | number => {
    const meta = asRecord(worldState.meta);
    const value = meta.hiddenSeed ?? meta.seed;
    return typeof value === 'string' || typeof value === 'number'
        ? value
        : fail('INTERNAL_SERVER_ERROR', '장수 선택 비밀 seed가 설정되지 않았습니다.');
};

const toSafeReservationTick = (value: bigint | number, uniqueName: string): number => {
    const tick = Number(value);
    if (!Number.isSafeInteger(tick)) {
        fail('INTERNAL_SERVER_ERROR', `장수 선택 후보 ${uniqueName}의 예약 tick이 안전한 정수 범위를 벗어났습니다.`);
    }
    return tick;
};

const resolveAcceptedGameTick = (world: InMemoryTurnWorld, now: Date): number => {
    const tick = world.dateToGameTick(now);
    if (!Number.isSafeInteger(tick)) {
        fail('INTERNAL_SERVER_ERROR', '장수 선택 예약 tick이 안전한 정수 범위를 벗어났습니다.');
    }
    return tick;
};

const isReservationActive = (row: SelectPoolRow, now: Date, nowTick: number): boolean =>
    row.reservedUntilTick !== null
        ? toSafeReservationTick(row.reservedUntilTick, row.uniqueName) >= nowTick
        : row.reservedUntil !== null && row.reservedUntil.getTime() >= now.getTime();

const lockSelectionUser = async (db: DatabaseClient, userId: string): Promise<void> => {
    await acquireGameSchemaAdvisoryXactLock(db, `select-pool:user:${userId}`);
};

const requireSelectionToken = async (
    db: DatabaseClient,
    userId: string,
    uniqueName: string,
    now: Date,
    nowTick: number
): Promise<SelectPoolRow> => {
    const token = await db.selectPoolEntry.findFirst({
        where: {
            ownerUserId: userId,
            uniqueName,
            generalId: null,
            OR: [
                { reservedUntilTick: { gte: BigInt(nowTick) } },
                { reservedUntilTick: null, reservedUntil: { gte: now } },
            ],
        },
    });
    if (!token) {
        fail('PRECONDITION_FAILED', '유효한 장수 목록이 없습니다.');
    }
    return token as SelectPoolRow;
};

const mapSelectionPoolRow = (row: SelectPoolRow): TurnGeneralPoolEntry => ({
    id: row.id,
    uniqueName: row.uniqueName,
    ownerUserId: row.ownerUserId,
    generalId: row.generalId,
    reservedUntil: row.reservedUntil ? new Date(row.reservedUntil.getTime()) : null,
    reservedUntilTick:
        row.reservedUntilTick === null ? null : toSafeReservationTick(row.reservedUntilTick, row.uniqueName),
    candidate: parseScenarioGeneralPoolCandidate({ id: row.id, uniqueName: row.uniqueName, info: row.info }),
});

const synchronizeSelectionPoolWorld = async (
    db: DatabaseClient,
    world: InMemoryTurnWorld
): Promise<SelectPoolRow[]> => {
    const rows = (await db.selectPoolEntry.findMany({ orderBy: { id: 'asc' } })) as SelectPoolRow[];
    world.replaceGeneralPoolEntries(rows.map(mapSelectionPoolRow));
    return rows;
};

export const reserveSelectionPool = async (options: {
    db: DatabaseClient;
    world: InMemoryTurnWorld;
    worldState: WorldStateRow;
    userId: string;
    now?: Date;
    acceptedGameTick?: number;
    seedOwnerIdentity?: string | number;
}): Promise<SelectPoolReservationDto> => {
    const { db, world, worldState, userId } = options;
    requirePoolWorld(worldState);
    const now = options.now ?? new Date();
    const acceptedGameTick = options.acceptedGameTick ?? resolveAcceptedGameTick(world, now);
    if (!Number.isSafeInteger(acceptedGameTick)) {
        fail('INTERNAL_SERVER_ERROR', '장수 선택 예약 tick이 안전한 정수 범위를 벗어났습니다.');
    }
    await lockSelectionUser(db, userId);
    await lockSelectionMutationTables(db);
    const general = await db.general.findFirst({
        where: { userId },
        select: { id: true, meta: true },
    });
    const nextChangeAt = general ? readNextChangeAt(general.meta) : null;
    if (nextChangeAt && nextChangeAt.getTime() > now.getTime()) {
        fail('PRECONDITION_FAILED', '아직 다시 고를 수 없습니다');
    }

    let currentRows = await synchronizeSelectionPoolWorld(db, world);
    const existing = currentRows.filter(
        (row) => row.ownerUserId === userId && row.generalId === null && isReservationActive(row, now, acceptedGameTick)
    );
    if (existing.length > 0) {
        return toReservationDto(existing, Boolean(general), worldState, world);
    }

    await db.selectPoolEntry.updateMany({
        where: {
            generalId: null,
            OR: [
                { reservedUntilTick: { lt: BigInt(acceptedGameTick) } },
                { reservedUntilTick: null, reservedUntil: { lt: now } },
            ],
        },
        data: {
            ownerUserId: null,
            reservedUntil: null,
            reservedUntilTick: null,
        },
    });
    currentRows = await synchronizeSelectionPoolWorld(db, world);
    const availableIds = new Set(
        world.listGeneralPoolCandidates(now, acceptedGameTick)?.map((candidate) => candidate.poolEntryId) ?? []
    );
    const available = currentRows.filter(
        (row) =>
            availableIds.has(row.id) &&
            row.ownerUserId === null &&
            row.reservedUntil === null &&
            row.reservedUntilTick === null &&
            row.generalId === null
    );
    if (available.length < RESERVATION_COUNT) {
        fail('PRECONDITION_FAILED', 'pool 부족');
    }

    const rng = new RandUtil(
        new LiteHashDRBG(
            buildSelectPoolSeed(getWorldHiddenSeed(worldState), options.seedOwnerIdentity ?? userId, acceptedGameTick)
        )
    );
    const poolName = resolvePoolName(worldState)!;
    const weighted = available.map(
        (row) =>
            [row, calculateSelectionCandidateWeight(poolName, parseCandidate(row), true)] as [SelectPoolRow, number]
    );
    const reservedUntilTick = acceptedGameTick + RESERVATION_TURN_MULTIPLIER * GAME_TICKS_PER_TURN;
    if (!Number.isSafeInteger(reservedUntilTick)) {
        fail('INTERNAL_SERVER_ERROR', '장수 선택 예약 tick이 안전한 정수 범위를 벗어났습니다.');
    }
    const reservedUntil = world.gameTickToDate(reservedUntilTick);
    const selected = await claimWeightedSelectionCandidates({
        weighted,
        rng,
        count: RESERVATION_COUNT,
        claim: async () => true,
    });
    const reserved = selected.map((candidate) => ({
        ...candidate,
        ownerUserId: userId,
        reservedUntil,
        reservedUntilTick: BigInt(reservedUntilTick),
    }));
    if (reserved.length !== RESERVATION_COUNT) {
        fail('CONFLICT', '장수 선택 후보를 예약하지 못했습니다. 다시 시도해 주세요.');
    }
    const reservation = await toReservationDto(reserved, Boolean(general), worldState, world);
    const claimed = await db.selectPoolEntry.updateMany({
        where: {
            id: { in: selected.map((candidate) => candidate.id) },
            ownerUserId: null,
            reservedUntil: null,
            reservedUntilTick: null,
            generalId: null,
        },
        data: {
            ownerUserId: userId,
            reservedUntil,
            reservedUntilTick: BigInt(reservedUntilTick),
        },
    });
    if (claimed.count !== RESERVATION_COUNT) {
        throw new Error('장수 선택 후보의 DB 점유 수가 턴 데몬 선택 결과와 일치하지 않습니다.');
    }
    await synchronizeSelectionPoolWorld(db, world);
    return reservation;
};

const lockSelectionMutationTables = async (db: DatabaseClient): Promise<void> => {
    await db.$executeRaw(GamePrisma.sql`LOCK TABLE "general" IN SHARE ROW EXCLUSIVE MODE`);
    await db.$executeRaw(GamePrisma.sql`LOCK TABLE "select_pool" IN SHARE ROW EXCLUSIVE MODE`);
};

const assertGeneralIdSnapshotMatches = async (db: DatabaseClient, world: InMemoryTurnWorld): Promise<void> => {
    const persistedIds = (
        await db.general.findMany({
            select: { id: true },
            orderBy: { id: 'asc' },
        })
    ).map(({ id }) => id);
    const runtimeIds = world
        .listGenerals()
        .map(({ id }) => id)
        .sort((left, right) => left - right);
    if (persistedIds.length !== runtimeIds.length || persistedIds.some((id, index) => id !== runtimeIds[index])) {
        throw new Error('DB와 턴 데몬의 장수 번호 목록이 일치하지 않아 장수를 생성할 수 없습니다.');
    }
};

const clearUnusedReservations = async (
    db: DatabaseClient,
    userId: string,
    now: Date,
    nowTick: number
): Promise<void> => {
    await db.selectPoolEntry.updateMany({
        where: {
            generalId: null,
            OR: [
                { ownerUserId: userId },
                { reservedUntilTick: { lt: BigInt(nowTick) } },
                { reservedUntilTick: null, reservedUntil: { lt: now } },
            ],
        },
        data: {
            ownerUserId: null,
            reservedUntil: null,
            reservedUntilTick: null,
        },
    });
};

const resolveSpecialityAges = (worldState: WorldStateRow, age: number): { domestic: number; war: number } => {
    const configConst = asRecord(asRecord(worldState.config).const);
    const retirementYear = asNumber(configConst.retirementYear, 80);
    const scenarioMeta = asRecord(asRecord(worldState.meta).scenarioMeta);
    const startYear = asNumber(scenarioMeta.startYear, worldState.currentYear);
    const relativeYear = Math.max(worldState.currentYear - startYear, 0);
    const build = (divisor: number): number =>
        Math.max(Math.round((retirementYear - age) / divisor - relativeYear / 2), 3) + age;
    return { domestic: build(12), war: build(6) };
};

const resolveRandomPersonality = (
    worldState: WorldStateRow,
    ownerIdentity: string | number,
    uniqueName: string
): string =>
    new RandUtil(
        new LiteHashDRBG(
            simpleSerialize(getWorldHiddenSeed(worldState), 'selectPickedGeneralPersonality', ownerIdentity, uniqueName)
        )
    ).choice([...PERSONALITY_TRAIT_KEYS]);

const resolveSelectedPersonality = (
    worldState: WorldStateRow,
    ownerIdentity: string | number,
    uniqueName: string,
    requested: string
): string => {
    if (!resolvePoolAllowOptions(worldState).includes('ego')) {
        return 'None';
    }
    if (requested === 'Random') {
        return resolveRandomPersonality(worldState, ownerIdentity, uniqueName);
    }
    if (!isPersonalityTraitKey(requested)) {
        fail('BAD_REQUEST', '올바르지 않은 성격입니다.');
    }
    return requested;
};

const resolvePoolRng = (worldState: WorldStateRow, ownerIdentity: string | number, uniqueName: string): RandUtil =>
    new RandUtil(
        new LiteHashDRBG(
            simpleSerialize(getWorldHiddenSeed(worldState), 'selectPickedGeneral', ownerIdentity, uniqueName)
        )
    );

const resolveTurnTimeBase = (worldState: WorldStateRow, now: Date): Date => {
    const raw = asRecord(worldState.meta).turntime;
    if (typeof raw === 'string') {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return now;
};

const buildInitialTurnTime = (rng: RandUtil, worldState: WorldStateRow, now: Date): Date => {
    const termSeconds = resolveTurnTermMinutes(worldState) * 60;
    const seconds = rng.nextRangeInt(0, termSeconds - 1);
    const microseconds = rng.nextRangeInt(0, 999_999);
    return new Date(resolveTurnTimeBase(worldState, now).getTime() + seconds * 1000 + microseconds / 1000);
};

const appendSelectionLogs = async (options: {
    db: DatabaseClient;
    worldState: WorldStateRow;
    generalId: number;
    ownerUserId: string;
    generalText: string;
    globalText: string;
}): Promise<void> => {
    const common = {
        year: options.worldState.currentYear,
        month: options.worldState.currentMonth,
        nationId: null,
        userId: null,
        meta: { ownerUserId: options.ownerUserId },
    };
    await options.db.logEntry.createMany({
        data: [
            {
                ...common,
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: options.generalId,
                text: options.generalText,
            },
            {
                ...common,
                scope: LogScope.SYSTEM,
                category: LogCategory.ACTION,
                generalId: null,
                text: options.globalText,
            },
        ],
    });
};

export const createGeneralFromSelectionPool = async (options: {
    db: DatabaseClient;
    world: InMemoryTurnWorld;
    worldState: WorldStateRow;
    userId: string;
    ownerDisplayName: string;
    uniqueName: string;
    personality: string;
    now?: Date;
    seedOwnerIdentity?: string | number;
    ownerPicture?: string;
    ownerImageServer?: number;
    ownerIconRevision?: string;
}): Promise<{ ok: true; generalId: number }> => {
    const { db, world, worldState, userId, ownerDisplayName, uniqueName } = options;
    requirePoolWorld(worldState);
    const now = options.now ?? new Date();
    const nowTick = resolveAcceptedGameTick(world, now);
    await lockSelectionUser(db, userId);
    await lockSelectionMutationTables(db);
    await synchronizeSelectionPoolWorld(db, world);
    await assertGeneralIdSnapshotMatches(db, world);
    if (
        world.listGenerals().some((general) => general.userId === userId) ||
        (await db.general.findFirst({ where: { userId }, select: { id: true } }))
    ) {
        fail('PRECONDITION_FAILED', '이미 장수를 생성했습니다.');
    }
    const token = await requireSelectionToken(db, userId, uniqueName, now, nowTick);
    const info = parseCandidate(token);
    const poolName = resolvePoolName(worldState)!;
    const isCentennial = poolName === CENTENNIAL_ALL_STAR_POOL;
    const centennialTarget = isCentennial ? asCentennialTarget(info) : null;
    const centennialRules = resolveCentennialRules(worldState);
    const centennialInitialStats = centennialTarget
        ? calculateCentennialUserInitialStats(centennialTarget, centennialRules)
        : null;

    const config = asRecord(worldState.config);
    const configConst = asRecord(config.const);
    const maxGeneral = resolveSelectionMaxGeneral(worldState);
    const activeCount = await db.general.count({ where: { npcState: { lt: 2 } } });
    if (activeCount >= maxGeneral) {
        fail('PRECONDITION_FAILED', '더 이상 등록 할 수 없습니다.');
    }

    const seedOwnerIdentity = options.seedOwnerIdentity ?? userId;
    const rng = resolvePoolRng(worldState, seedOwnerIdentity, uniqueName);
    const affinity = rng.nextRangeInt(1, 150);
    const allCities = await db.city.findMany({
        select: { id: true, name: true, level: true, nationId: true },
        orderBy: { id: 'asc' },
    });
    const centennialCities = allCities.filter((city) => city.level >= 5 && city.level <= 6);
    const neutralCentennialCities = centennialCities.filter((city) => city.nationId === 0);
    const cities = isCentennial
        ? neutralCentennialCities.length > 0
            ? neutralCentennialCities
            : centennialCities
        : allCities;
    if (cities.length === 0) {
        fail(
            'PRECONDITION_FAILED',
            isCentennial ? '장수를 생성할 소·중성이 없습니다.' : '생성 가능한 도시가 없습니다.'
        );
    }
    const city = rng.choice(cities);
    const turnTime = buildInitialTurnTime(rng, worldState, now);
    const age = 20;
    const specialityAges = resolveSpecialityAges(worldState, age);
    const nextChangeAt = new Date(
        now.getTime() + resolveTurnTermMinutes(worldState) * RESELECTION_TURN_MULTIPLIER * 60_000
    );
    const prestartDeleteAfter = buildPrestartDeleteAfter(now, worldState.tickSeconds, config);
    // 후보 picture는 NPC용 preset이다. 후보가 사람 장수(npcState=0)가 되는
    // 순간부터는 명시적으로 선택한 계정 전용 아이콘 또는 기본 아이콘만 허용한다.
    const { picture, imageServer } = resolveSelectionPoolUserIcon({
        showImgLevel: asNumber(config.showImgLevel, 0),
        ownerPicture: options.ownerPicture,
        ownerImageServer: options.ownerImageServer,
    });
    const useOwnerPicture = picture !== 'default.jpg';
    const defaultSpecialWar =
        typeof configConst.defaultSpecialWar === 'string' ? configConst.defaultSpecialWar : 'None';
    const defaultSpecialDomestic =
        typeof configConst.defaultSpecialDomestic === 'string' ? configConst.defaultSpecialDomestic : 'None';
    const personality = resolveSelectedPersonality(worldState, seedOwnerIdentity, uniqueName, options.personality);
    // 모든 사용자 입력과 DB 선조건을 검증한 뒤에만 allocator를 변경한다.
    // SelectPoolError는 정상 command 결과로 commit되므로 이보다 먼저
    // getNextGeneralId()를 호출하면 실패한 요청도 lastGeneralId를 소비한다.
    const generalId = world.getNextGeneralId();

    const generalMeta: TurnGeneral['meta'] = {
        createdBy: 'select_pool',
        ownerName: ownerDisplayName,
        owner_name: ownerDisplayName,
        killturn: 5,
        specage: specialityAges.domestic,
        specage2: specialityAges.war,
        dex1: isCentennial ? 0 : info.dex[0],
        dex2: isCentennial ? 0 : info.dex[1],
        dex3: isCentennial ? 0 : info.dex[2],
        dex4: isCentennial ? 0 : info.dex[3],
        dex5: isCentennial ? 0 : info.dex[4],
        next_change: nextChangeAt.toISOString(),
        nextChangeAt: nextChangeAt.toISOString(),
        prestart_delete_after: prestartDeleteAfter.toISOString(),
        ...(useOwnerPicture && options.ownerIconRevision ? { accountIconUpdatedAt: options.ownerIconRevision } : {}),
        npc_org: 0,
        ...buildScenarioGeneralPoolClaimMeta(
            parseScenarioGeneralPoolCandidate({ id: token.id, uniqueName: token.uniqueName, info: token.info }),
            now
        ),
    };
    if (centennialTarget && centennialInitialStats) {
        const mutableMeta: Record<string, unknown> = generalMeta;
        mutableMeta[CENTENNIAL_ALL_STAR_AUX_KEY] = initialCentennialAllStarAux(
            centennialTarget,
            centennialRules,
            centennialInitialStats
        );
    }

    const general: TurnGeneral = {
        id: generalId,
        userId,
        name: info.generalName,
        nationId: 0,
        cityId: city.id,
        troopId: 0,
        npcState: 0,
        affinity,
        bornYear: worldState.currentYear - age,
        deadYear: worldState.currentYear + 60,
        picture,
        imageServer,
        stats: {
            leadership: centennialInitialStats?.leadership ?? info.leadership,
            strength: centennialInitialStats?.strength ?? info.strength,
            intelligence: centennialInitialStats?.intel ?? info.intel,
        },
        experience: info.experience ?? age * 100,
        dedication: info.dedication ?? age * 100,
        officerLevel: 0,
        injury: 0,
        gold: 1000,
        rice: 1000,
        crew: 0,
        crewTypeId: DEFAULT_CREW_TYPE_ID,
        train: 0,
        atmos: 0,
        turnTime,
        age,
        startAge: age,
        role: {
            personality,
            specialDomestic: isCentennial ? defaultSpecialDomestic : info.specialDomestic,
            specialWar: isCentennial ? defaultSpecialWar : (info.specialWar ?? defaultSpecialWar),
            items: {
                horse: null,
                weapon: null,
                book: null,
                item: null,
            },
        },
        triggerState: {
            flags: {},
            counters: {},
            modifiers: {},
            meta: {},
        },
        lastTurn: { command: DEFAULT_TURN_ACTION },
        penalty: {},
        refreshScoreTotal: 0,
        meta: generalMeta,
    };
    if (!world.addGeneral(general)) {
        throw new Error(`장수 번호 ${generalId}를 할당할 수 없습니다.`);
    }
    await db.generalTurn.createMany({
        data: Array.from({ length: MAX_GENERAL_TURNS }, (_, turnIdx) => ({
            generalId,
            turnIdx,
            actionCode: DEFAULT_TURN_ACTION,
            arg: {},
        })),
    });
    await db.generalTurnRevision.create({
        data: {
            generalId,
            revision: 0,
        },
    });
    const occupied = await db.selectPoolEntry.updateMany({
        where: {
            id: token.id,
            ownerUserId: userId,
            generalId: null,
            OR: [
                { reservedUntilTick: { gte: BigInt(nowTick) } },
                { reservedUntilTick: null, reservedUntil: { gte: now } },
            ],
        },
        data: {
            generalId,
            ownerUserId: null,
            reservedUntil: null,
            reservedUntilTick: null,
        },
    });
    if (occupied.count === 0) {
        throw new Error('장수 등록 중 선택 후보 점유에 실패했습니다.');
    }
    await db.generalAccessLog.upsert({
        where: { generalId },
        update: { userId, lastRefresh: now },
        create: { generalId, userId, lastRefresh: now },
    });
    await clearUnusedReservations(db, userId, now, nowTick);
    await synchronizeSelectionPoolWorld(db, world);

    const ownerJosaYi = JosaUtil.pick(ownerDisplayName, '이');
    const generalJosaRo = JosaUtil.pick(info.generalName, '로');
    await appendSelectionLogs({
        db,
        worldState,
        generalId,
        ownerUserId: userId,
        generalText: `<Y>${info.generalName}</>, <G>${city.name}</>에서 등장`,
        globalText: `<G><b>${city.name}</b></>에서 <Y>${ownerDisplayName}</>${ownerJosaYi} <Y>${info.generalName}</>${generalJosaRo} 등장합니다.`,
    });
    return { ok: true, generalId };
};

export const reselectGeneralFromSelectionPool = async (options: {
    db: DatabaseClient;
    world: InMemoryTurnWorld;
    worldState: WorldStateRow;
    userId: string;
    ownerDisplayName: string;
    uniqueName: string;
    now?: Date;
}): Promise<{ ok: true; generalId: number }> => {
    const { db, world, worldState, userId, ownerDisplayName, uniqueName } = options;
    requirePoolWorld(worldState);
    const now = options.now ?? new Date();
    const nowTick = resolveAcceptedGameTick(world, now);
    await lockSelectionUser(db, userId);
    await lockSelectionMutationTables(db);
    await synchronizeSelectionPoolWorld(db, world);
    const persistedGeneral = await db.general.findFirst({ where: { userId } });
    const general = world.listGenerals().find((candidate) => candidate.userId === userId);
    if (!persistedGeneral || !general) {
        throw new SelectPoolError(
            'PRECONDITION_FAILED',
            '장수가 생성하지 않았습니다. 이미 사망하지 않았는지 확인해보세요.'
        );
    }
    if (persistedGeneral.id !== general.id) {
        fail('INTERNAL_SERVER_ERROR', 'DB와 턴 데몬의 장수 소유 정보가 일치하지 않습니다.');
    }
    const nextChangeAt = readNextChangeAt(general.meta);
    if (nextChangeAt && nextChangeAt.getTime() > now.getTime()) {
        fail('PRECONDITION_FAILED', '아직 다시 고를 수 없습니다');
    }
    const token = await requireSelectionToken(db, userId, uniqueName, now, nowTick);
    const info = parseCandidate(token);
    const isCentennial = resolvePoolName(worldState) === CENTENNIAL_ALL_STAR_POOL;

    const provisionalGeneralId = -general.id;
    const claimed = await db.selectPoolEntry.updateMany({
        where: {
            id: token.id,
            ownerUserId: userId,
            generalId: null,
            OR: [
                { reservedUntilTick: { gte: BigInt(nowTick) } },
                { reservedUntilTick: null, reservedUntil: { gte: now } },
            ],
        },
        data: {
            generalId: provisionalGeneralId,
            ownerUserId: null,
            reservedUntil: null,
            reservedUntilTick: null,
        },
    });
    if (claimed.count === 0) {
        throw new Error('장수 재선택 중 선택 후보 점유에 실패했습니다.');
    }
    await db.selectPoolEntry.updateMany({
        where: { generalId: general.id },
        data: { generalId: null, ownerUserId: null, reservedUntil: null, reservedUntilTick: null },
    });
    const finalized = await db.selectPoolEntry.updateMany({
        where: {
            id: token.id,
            generalId: provisionalGeneralId,
        },
        data: {
            generalId: general.id,
        },
    });
    if (finalized.count === 0) {
        throw new Error('장수 재선택 중 선택 후보 확정에 실패했습니다.');
    }

    const cooldown = new Date(
        now.getTime() + resolveTurnTermMinutes(worldState) * RESELECTION_TURN_MULTIPLIER * 60_000
    );
    const centennialBaseGeneral = isCentennial
        ? {
              ...general,
              meta: prepareCentennialLegacyUserReselection(general, resolveCentennialRules(worldState)),
          }
        : general;
    const centennialGrowth = isCentennial
        ? applyCentennialAllStarTarget(
              centennialBaseGeneral,
              asCentennialTarget(info),
              resolveCentennialEnvironment(worldState),
              resolveCentennialRules(worldState)
          )
        : null;
    const updatedMeta: TurnGeneral['meta'] = {
        ...(centennialGrowth?.meta ?? general.meta),
        ownerName: ownerDisplayName,
        owner_name: ownerDisplayName,
        ...(!isCentennial
            ? {
                  dex1: info.dex[0],
                  dex2: info.dex[1],
                  dex3: info.dex[2],
                  dex4: info.dex[3],
                  dex5: info.dex[4],
              }
            : {}),
        next_change: cooldown.toISOString(),
        nextChangeAt: cooldown.toISOString(),
        ...buildScenarioGeneralPoolClaimMeta(
            parseScenarioGeneralPoolCandidate({ id: token.id, uniqueName: token.uniqueName, info: token.info }),
            now
        ),
    };
    const reselectionIcon = resolveSelectionPoolUserIcon({ showImgLevel: 0 });
    const updated = world.updateGeneral(general.id, {
        name: info.generalName,
        stats: centennialGrowth?.stats ?? {
            leadership: info.leadership,
            strength: info.strength,
            intelligence: info.intel,
        },
        role: centennialGrowth?.role ?? {
            ...general.role,
            personality: info.ego ?? general.role.personality,
            specialDomestic: info.specialDomestic,
            specialWar: info.specialWar ?? general.role.specialWar,
        },
        // 재선택 후보의 preset은 유저 장수에 이어 붙이지 않는다. 전용 아이콘을
        // 다시 고르는 UI가 없는 현재 경로는 안전한 기본 아이콘으로 되돌린다.
        picture: reselectionIcon.picture,
        imageServer: reselectionIcon.imageServer,
        meta: updatedMeta,
    });
    if (!updated) {
        throw new Error('턴 데몬에서 장수 정보를 갱신하지 못했습니다.');
    }
    await clearUnusedReservations(db, userId, now, nowTick);
    await synchronizeSelectionPoolWorld(db, world);

    const ownerJosaYi = JosaUtil.pick(ownerDisplayName, '이');
    const generalJosaRo = JosaUtil.pick(info.generalName, '로');
    await appendSelectionLogs({
        db,
        worldState,
        generalId: general.id,
        ownerUserId: userId,
        generalText: `장수를 <Y>${general.name}</>에서 <Y>${info.generalName}</>${generalJosaRo} 변경`,
        globalText: `<Y>${ownerDisplayName}</>${ownerJosaYi} 장수를 <Y>${general.name}</>에서 <Y>${info.generalName}</>${generalJosaRo} 변경합니다.`,
    });
    return { ok: true, generalId: general.id };
};

export const getSelectionPoolStatus = async (
    db: DatabaseClient,
    worldState: WorldStateRow,
    userId: string
): Promise<{
    enabled: boolean;
    poolName: string | null;
    allowOptions: string[];
    hasGeneral: boolean;
    nextChangeAt: string | null;
}> => {
    const poolName = resolvePoolName(worldState);
    const enabled = isSelectionPoolWorld(worldState);
    const general = await db.general.findFirst({ where: { userId }, select: { meta: true } });
    return {
        enabled,
        poolName,
        allowOptions: resolvePoolAllowOptions(worldState),
        hasGeneral: Boolean(general),
        nextChangeAt: general ? (readNextChangeAt(general.meta)?.toISOString() ?? null) : null,
    };
};
