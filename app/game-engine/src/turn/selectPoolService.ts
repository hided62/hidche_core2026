import { z } from 'zod';

import { asNumber, asRecord, JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { GamePrisma, LogCategory, LogScope } from '@sammo-ts/infra';
import {
    EventDomesticTraitLoader,
    isEventDomesticTraitKey,
    isPersonalityTraitKey,
    PERSONALITY_TRAIT_KEYS,
    simpleSerialize,
} from '@sammo-ts/logic';

import type { DatabaseClient, GamePrisma as GamePrismaTypes } from '@sammo-ts/infra';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import { buildPrestartDeleteAfter } from './prestartDeletion.js';
import type { TurnGeneral } from './types.js';

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

const SUPPORTED_POOL = 'SPoolUnderU30';
const RESERVATION_COUNT = 14;
const RESERVATION_TURN_MULTIPLIER = 2;
const RESELECTION_TURN_MULTIPLIER = 12;
const DEFAULT_MAX_GENERAL = 500;
const DEFAULT_CREW_TYPE_ID = 1100;
const MAX_GENERAL_TURNS = 30;
const DEFAULT_TURN_ACTION = '휴식';
const LEGACY_TIMEZONE_OFFSET_MS = 9 * 60 * 60 * 1000;

const zCandidateInfo = z.object({
    uniqueName: z.string().min(1),
    generalName: z.string().min(1),
    leadership: z.number().int(),
    strength: z.number().int(),
    intel: z.number().int(),
    specialDomestic: z.string().min(1),
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
    info: unknown;
}

export interface SelectPoolCandidateDto {
    uniqueName: string;
    generalName: string;
    leadership: number;
    strength: number;
    intel: number;
    specialDomestic: string;
    specialDomesticName: string;
    specialDomesticInfo: string;
    specialWar: string | null;
    ego: string | null;
    dex: [number, number, number, number, number];
    imageServer: 0 | 1;
    picture: string;
}

export interface SelectPoolReservationDto {
    poolName: typeof SUPPORTED_POOL;
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
    return asNumber(config.npcMode, 0) === 2 && resolvePoolName(worldState) === SUPPORTED_POOL;
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

const candidateWeight = (candidate: SelectPoolCandidateInfo): number =>
    candidate.dex.reduce((sum, value) => sum + value, 0);

const eventDomesticTraitLoader = new EventDomesticTraitLoader();

const toCandidateDto = async (candidate: SelectPoolCandidateInfo): Promise<SelectPoolCandidateDto> => {
    const trait = isEventDomesticTraitKey(candidate.specialDomestic)
        ? await eventDomesticTraitLoader.load(candidate.specialDomestic)
        : null;
    return {
        uniqueName: candidate.uniqueName,
        generalName: candidate.generalName,
        leadership: candidate.leadership,
        strength: candidate.strength,
        intel: candidate.intel,
        specialDomestic: candidate.specialDomestic,
        specialDomesticName: trait?.name ?? candidate.specialDomestic.replace(/^che_event_/, ''),
        specialDomesticInfo: trait?.info ?? '',
        specialWar: candidate.specialWar ?? null,
        ego: candidate.ego ?? null,
        dex: candidate.dex,
        imageServer: candidate.imgsvr,
        picture: candidate.picture,
    };
};

const toReservationDto = (
    rows: Array<Pick<SelectPoolRow, 'id' | 'uniqueName' | 'reservedUntil' | 'info'>>,
    hasGeneral: boolean
): Promise<SelectPoolReservationDto> => {
    const validUntil = rows[0]?.reservedUntil;
    if (!validUntil) {
        throw new SelectPoolError('INTERNAL_SERVER_ERROR', '장수 선택 후보의 유효기간이 없습니다.');
    }
    const expiresAt = validUntil;
    const sorted = rows
        .map((row) => ({ id: row.id, info: parseCandidate(row) }))
        .sort((left, right) => candidateWeight(left.info) - candidateWeight(right.info) || left.id - right.id);
    return Promise.all(sorted.map((entry) => toCandidateDto(entry.info))).then((candidates) => ({
        poolName: SUPPORTED_POOL,
        hasGeneral,
        validUntil: expiresAt.toISOString(),
        candidates,
    }));
};

const formatLegacySeedTime = (value: Date): string => {
    const pad = (part: number): string => String(part).padStart(2, '0');
    const koreaTime = new Date(value.getTime() + LEGACY_TIMEZONE_OFFSET_MS);
    return `${koreaTime.getUTCFullYear()}-${pad(koreaTime.getUTCMonth() + 1)}-${pad(
        koreaTime.getUTCDate()
    )} ${pad(koreaTime.getUTCHours())}:${pad(koreaTime.getUTCMinutes())}:${pad(koreaTime.getUTCSeconds())}`;
};

export const buildSelectPoolSeed = (hiddenSeed: string | number, ownerIdentity: string | number, now: Date): string =>
    simpleSerialize(hiddenSeed, 'selectPool', ownerIdentity, formatLegacySeedTime(now));

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

const lockSelectionUser = async (db: DatabaseClient, userId: string): Promise<void> => {
    await db.$executeRaw(
        GamePrisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`select_pool:${userId}`}, 903))`
    );
};

const requireSelectionToken = async (
    db: DatabaseClient,
    userId: string,
    uniqueName: string,
    now: Date
): Promise<SelectPoolRow> => {
    const token = await db.selectPoolEntry.findFirst({
        where: {
            ownerUserId: userId,
            uniqueName,
            reservedUntil: { gte: now },
            generalId: null,
        },
    });
    if (!token) {
        fail('PRECONDITION_FAILED', '유효한 장수 목록이 없습니다.');
    }
    return token as SelectPoolRow;
};

export const reserveSelectionPool = async (options: {
    db: DatabaseClient;
    worldState: WorldStateRow;
    userId: string;
    now?: Date;
    seedOwnerIdentity?: string | number;
}): Promise<SelectPoolReservationDto> => {
    const { db, worldState, userId } = options;
    requirePoolWorld(worldState);
    const now = options.now ?? new Date();
    await lockSelectionUser(db, userId);
    const general = await db.general.findFirst({
        where: { userId },
        select: { id: true, meta: true },
    });
    const nextChangeAt = general ? readNextChangeAt(general.meta) : null;
    if (nextChangeAt && nextChangeAt.getTime() > now.getTime()) {
        fail('PRECONDITION_FAILED', '아직 다시 고를 수 없습니다');
    }

    const existing = await db.selectPoolEntry.findMany({
        where: {
            ownerUserId: userId,
            reservedUntil: { gte: now },
            generalId: null,
        },
        orderBy: { id: 'asc' },
    });
    if (existing.length > 0) {
        return toReservationDto(existing as SelectPoolRow[], Boolean(general));
    }

    await db.selectPoolEntry.updateMany({
        where: {
            reservedUntil: { lt: now },
            generalId: null,
        },
        data: {
            ownerUserId: null,
            reservedUntil: null,
        },
    });

    const available = (await db.selectPoolEntry.findMany({
        where: {
            ownerUserId: null,
            reservedUntil: null,
            generalId: null,
        },
        orderBy: { id: 'asc' },
    })) as SelectPoolRow[];
    if (available.length < RESERVATION_COUNT) {
        fail('PRECONDITION_FAILED', 'pool 부족');
    }

    const rng = new RandUtil(
        new LiteHashDRBG(buildSelectPoolSeed(getWorldHiddenSeed(worldState), options.seedOwnerIdentity ?? userId, now))
    );
    const weighted = available.map((row) => [row, candidateWeight(parseCandidate(row))] as [SelectPoolRow, number]);
    const reservedUntil = new Date(
        now.getTime() + resolveTurnTermMinutes(worldState) * RESERVATION_TURN_MULTIPLIER * 60_000
    );
    const selected = await claimWeightedSelectionCandidates({
        weighted,
        rng,
        count: RESERVATION_COUNT,
        claim: async (candidate) => {
            const claimed = await db.selectPoolEntry.updateMany({
                where: {
                    id: candidate.id,
                    ownerUserId: null,
                    reservedUntil: null,
                    generalId: null,
                },
                data: {
                    ownerUserId: userId,
                    reservedUntil,
                },
            });
            return claimed.count > 0;
        },
    });
    const reserved = selected.map((candidate) => ({
        ...candidate,
        ownerUserId: userId,
        reservedUntil,
    }));
    if (reserved.length !== RESERVATION_COUNT) {
        fail('CONFLICT', '장수 선택 후보를 예약하지 못했습니다. 다시 시도해 주세요.');
    }
    return toReservationDto(reserved, Boolean(general));
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

const clearUnusedReservations = async (db: DatabaseClient, userId: string, now: Date): Promise<void> => {
    await db.selectPoolEntry.updateMany({
        where: {
            generalId: null,
            OR: [{ ownerUserId: userId }, { reservedUntil: { lt: now } }],
        },
        data: {
            ownerUserId: null,
            reservedUntil: null,
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
    await lockSelectionUser(db, userId);
    await lockSelectionMutationTables(db);
    await assertGeneralIdSnapshotMatches(db, world);
    if (
        world.listGenerals().some((general) => general.userId === userId) ||
        (await db.general.findFirst({ where: { userId }, select: { id: true } }))
    ) {
        fail('PRECONDITION_FAILED', '이미 장수를 생성했습니다.');
    }
    const token = await requireSelectionToken(db, userId, uniqueName, now);
    const info = parseCandidate(token);

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
    const cities = await db.city.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });
    if (cities.length === 0) {
        fail('PRECONDITION_FAILED', '생성 가능한 도시가 없습니다.');
    }
    const city = rng.choice(cities);
    const turnTime = buildInitialTurnTime(rng, worldState, now);
    const age = 20;
    const specialityAges = resolveSpecialityAges(worldState, age);
    const nextChangeAt = new Date(
        now.getTime() + resolveTurnTermMinutes(worldState) * RESELECTION_TURN_MULTIPLIER * 60_000
    );
    const prestartDeleteAfter = buildPrestartDeleteAfter(now, worldState.tickSeconds, config);
    const showImgLevel = asNumber(config.showImgLevel, 0);
    const useOwnerPicture =
        showImgLevel >= 1 && typeof options.ownerPicture === 'string' && options.ownerPicture !== 'default.jpg';
    const picture = useOwnerPicture ? options.ownerPicture! : showImgLevel >= 3 ? info.picture : 'default.jpg';
    const imageServer = useOwnerPicture ? (options.ownerImageServer ?? 1) : info.imgsvr;
    const defaultSpecialWar =
        typeof configConst.defaultSpecialWar === 'string' ? configConst.defaultSpecialWar : 'None';
    const personality = resolveSelectedPersonality(worldState, seedOwnerIdentity, uniqueName, options.personality);
    // 모든 사용자 입력과 DB 선조건을 검증한 뒤에만 allocator를 변경한다.
    // SelectPoolError는 정상 command 결과로 commit되므로 이보다 먼저
    // getNextGeneralId()를 호출하면 실패한 요청도 lastGeneralId를 소비한다.
    const generalId = world.getNextGeneralId();

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
            leadership: info.leadership,
            strength: info.strength,
            intelligence: info.intel,
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
            specialDomestic: info.specialDomestic,
            specialWar: info.specialWar ?? defaultSpecialWar,
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
        meta: {
            createdBy: 'select_pool',
            ownerName: ownerDisplayName,
            owner_name: ownerDisplayName,
            killturn: 5,
            specage: specialityAges.domestic,
            specage2: specialityAges.war,
            dex1: info.dex[0],
            dex2: info.dex[1],
            dex3: info.dex[2],
            dex4: info.dex[3],
            dex5: info.dex[4],
            next_change: nextChangeAt.toISOString(),
            nextChangeAt: nextChangeAt.toISOString(),
            prestart_delete_after: prestartDeleteAfter.toISOString(),
            ...(useOwnerPicture && options.ownerIconRevision
                ? { accountIconUpdatedAt: options.ownerIconRevision }
                : {}),
            npc_org: 0,
        },
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
            reservedUntil: { gte: now },
            generalId: null,
        },
        data: {
            generalId,
            ownerUserId: null,
            reservedUntil: null,
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
    await clearUnusedReservations(db, userId, now);

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
    await lockSelectionUser(db, userId);
    await lockSelectionMutationTables(db);
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
    const token = await requireSelectionToken(db, userId, uniqueName, now);
    const info = parseCandidate(token);

    const provisionalGeneralId = -general.id;
    const claimed = await db.selectPoolEntry.updateMany({
        where: {
            id: token.id,
            ownerUserId: userId,
            reservedUntil: { gte: now },
            generalId: null,
        },
        data: {
            generalId: provisionalGeneralId,
            ownerUserId: null,
            reservedUntil: null,
        },
    });
    if (claimed.count === 0) {
        throw new Error('장수 재선택 중 선택 후보 점유에 실패했습니다.');
    }
    await db.selectPoolEntry.updateMany({
        where: { generalId: general.id },
        data: { generalId: null, ownerUserId: null, reservedUntil: null },
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

    const currentMeta = asRecord(general.meta);
    const cooldown = new Date(
        now.getTime() + resolveTurnTermMinutes(worldState) * RESELECTION_TURN_MULTIPLIER * 60_000
    );
    const updatedMeta = {
        ...currentMeta,
        ownerName: ownerDisplayName,
        owner_name: ownerDisplayName,
        dex1: info.dex[0],
        dex2: info.dex[1],
        dex3: info.dex[2],
        dex4: info.dex[3],
        dex5: info.dex[4],
        next_change: cooldown.toISOString(),
        nextChangeAt: cooldown.toISOString(),
    };
    const updated = world.updateGeneral(general.id, {
        name: info.generalName,
        stats: {
            leadership: info.leadership,
            strength: info.strength,
            intelligence: info.intel,
        },
        role: {
            ...general.role,
            personality: info.ego ?? general.role.personality,
            specialDomestic: info.specialDomestic,
            specialWar: info.specialWar ?? general.role.specialWar,
        },
        picture: info.picture,
        imageServer: info.imgsvr,
        meta: updatedMeta as unknown as TurnGeneral['meta'],
    });
    if (!updated) {
        throw new Error('턴 데몬에서 장수 정보를 갱신하지 못했습니다.');
    }
    await clearUnusedReservations(db, userId, now);

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
