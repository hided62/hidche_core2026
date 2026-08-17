import { randomInt } from 'node:crypto';

import { asNumber, asRecord, JosaUtil, LiteHashDRBG, RandUtil, type RNG } from '@sammo-ts/common';
import {
    acquireGameSchemaAdvisoryXactLock,
    GamePrisma,
    type DatabaseClient,
    type GamePrisma as GamePrismaTypes,
} from '@sammo-ts/infra';
import {
    ActionLogger,
    DomesticTraitLoader,
    isDomesticTraitKey,
    isPersonalityTraitKey,
    isWarTraitKey,
    PersonalityTraitLoader,
    simpleSerialize,
    WarTraitLoader,
} from '@sammo-ts/logic';
import { z } from 'zod';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import { resolveLegacyPenalty } from './joinCreateGeneralService.js';

type WorldStateRow = GamePrismaTypes.WorldStateGetPayload<Record<string, never>>;

export type NpcPossessionErrorCode =
    'BAD_REQUEST' | 'NOT_FOUND' | 'PRECONDITION_FAILED' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR';

export class NpcPossessionError extends Error {
    constructor(
        readonly code: NpcPossessionErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'NpcPossessionError';
    }
}

const zTraitSnapshot = z.object({
    code: z.string(),
    name: z.string(),
    info: z.string(),
});

const zNpcPossessionCandidate = z.object({
    id: z.number().int().positive(),
    name: z.string(),
    nation: z.object({
        id: z.number().int(),
        name: z.string(),
        color: z.string(),
    }),
    stats: z.object({
        leadership: z.number().int(),
        strength: z.number().int(),
        intelligence: z.number().int(),
    }),
    picture: z.string().nullable(),
    imageServer: z.number().int(),
    personality: zTraitSnapshot,
    specialDomestic: zTraitSnapshot,
    specialWar: zTraitSnapshot,
    keepCount: z.number().int().min(0),
});

const zNpcPossessionPickResult = z.record(z.string(), zNpcPossessionCandidate);

export type NpcPossessionCandidate = z.infer<typeof zNpcPossessionCandidate>;

export interface NpcPossessionReservation {
    tokenNonce: number;
    validUntil: string;
    pickMoreFrom: string;
    pickMoreSeconds: number;
    candidates: NpcPossessionCandidate[];
}

export interface NpcPossessionSelectionObserver {
    onRandomDraw?: (value: number) => void;
    onCandidateDraw?: (selectedId: string) => void;
}

interface NpcSelectionTokenRow {
    ownerUserId: string;
    validUntil: Date;
    pickMoreFrom: Date;
    pickResult: unknown;
    nonce: number;
}

const LEGACY_TIMEZONE_OFFSET_MS = 9 * 60 * 60 * 1000;
const VALID_SECONDS = 90;
const PICK_MORE_SECONDS = 10;
const KEEP_COUNT = 3;
const MAX_PICK_COUNT = 5;
const FIRST_PICK_MORE_FROM = new Date('2000-01-01T01:00:00.000Z');
const DEFAULT_MAX_GENERAL = 500;

const fail = (code: NpcPossessionErrorCode, message: string): never => {
    throw new NpcPossessionError(code, message);
};

const truncateToSeconds = (value: Date): Date => new Date(Math.floor(value.getTime() / 1000) * 1000);

const formatLegacySeedTime = (value: Date): string => {
    const pad = (part: number): string => String(part).padStart(2, '0');
    const koreaTime = new Date(value.getTime() + LEGACY_TIMEZONE_OFFSET_MS);
    return `${koreaTime.getUTCFullYear()}-${pad(koreaTime.getUTCMonth() + 1)}-${pad(
        koreaTime.getUTCDate()
    )} ${pad(koreaTime.getUTCHours())}:${pad(koreaTime.getUTCMinutes())}:${pad(koreaTime.getUTCSeconds())}`;
};

export const buildNpcSelectionTokenSeed = (
    hiddenSeed: string | number,
    ownerIdentity: string | number,
    now: Date
): string => simpleSerialize(hiddenSeed, 'SelectNPCToken', ownerIdentity, formatLegacySeedTime(now));

const readHiddenSeed = (worldState: WorldStateRow): string | number => {
    const meta = asRecord(worldState.meta);
    const value = meta.hiddenSeed ?? meta.seed;
    if (typeof value === 'string' || typeof value === 'number') {
        return value;
    }
    return fail('INTERNAL_SERVER_ERROR', 'NPC 빙의 비밀 seed가 설정되지 않았습니다.');
};

const resolveTurnTermMinutes = (worldState: WorldStateRow): number => {
    const config = asRecord(worldState.config);
    return Math.max(1, Math.abs(Math.trunc(asNumber(config.turnTermMinutes, Math.round(worldState.tickSeconds / 60)))));
};

const resolveMaxGeneral = (worldState: WorldStateRow): number => {
    const config = asRecord(worldState.config);
    const configConst = asRecord(config.const);
    return Math.max(
        0,
        Math.floor(
            asNumber(
                config.maxGeneral ?? config.maxgeneral ?? configConst.defaultMaxGeneral ?? configConst.maxGeneral,
                DEFAULT_MAX_GENERAL
            )
        )
    );
};

const requireNpcPossessionWorld = (worldState: WorldStateRow): void => {
    const config = asRecord(worldState.config);
    if (asNumber(config.npcMode ?? config.npcmode, 0) !== 1) {
        fail('PRECONDITION_FAILED', '빙의 가능한 서버가 아닙니다');
    }
};

const lockNpcPossession = async (db: DatabaseClient, userId: string): Promise<void> => {
    // Ref의 서로 다른 owner token 중복과 동일 owner 다중 빙의 race는 데이터 손상
    // 가능성이 있어, 후보 예약과 최종 점유 모두 같은 lock 순서로 직렬화한다.
    await acquireGameSchemaAdvisoryXactLock(db, 'npc-possession:global');
    await acquireGameSchemaAdvisoryXactLock(db, `npc-possession:user:${userId}`);
};

const parsePickResult = (value: unknown): Record<string, NpcPossessionCandidate> => {
    const parsed = zNpcPossessionPickResult.safeParse(value);
    if (!parsed.success) {
        return fail('INTERNAL_SERVER_ERROR', 'NPC 빙의 후보 정보가 올바르지 않습니다.');
    }
    return parsed.data;
};

const toReservation = (
    token: Pick<NpcSelectionTokenRow, 'validUntil' | 'pickMoreFrom' | 'pickResult' | 'nonce'>,
    now: Date
): NpcPossessionReservation => {
    const pickResult = parsePickResult(token.pickResult);
    return {
        tokenNonce: token.nonce,
        validUntil: token.validUntil.toISOString(),
        pickMoreFrom: token.pickMoreFrom.toISOString(),
        pickMoreSeconds: Math.max(0, Math.ceil((token.pickMoreFrom.getTime() - now.getTime()) / 1000)),
        candidates: Object.values(pickResult).sort(
            (left, right) =>
                left.stats.leadership +
                    left.stats.strength +
                    left.stats.intelligence -
                    (right.stats.leadership + right.stats.strength + right.stats.intelligence) || left.id - right.id
        ),
    };
};

const loadTraitSnapshot = async (
    code: string,
    kind: 'personality' | 'domestic' | 'war'
): Promise<z.infer<typeof zTraitSnapshot>> => {
    const fallback = { code, name: code === 'None' ? '-' : code, info: code === 'None' ? '없음' : '' };
    if (kind === 'personality' && isPersonalityTraitKey(code)) {
        const trait = await new PersonalityTraitLoader().load(code);
        return { code, name: trait.name, info: trait.info ?? '' };
    }
    if (kind === 'domestic' && isDomesticTraitKey(code)) {
        const trait = await new DomesticTraitLoader().load(code);
        return { code, name: trait.name, info: trait.info ?? '' };
    }
    if (kind === 'war' && isWarTraitKey(code)) {
        const trait = await new WarTraitLoader().load(code);
        return { code, name: trait.name, info: trait.info ?? '' };
    }
    return fallback;
};

const buildCandidateSnapshot = async (
    row: {
        id: number;
        name: string;
        nationId: number;
        leadership: number;
        strength: number;
        intel: number;
        picture: string | null;
        imageServer: number;
        personalCode: string;
        specialCode: string;
        special2Code: string;
    },
    nation: { id: number; name: string; color: string } | undefined
): Promise<NpcPossessionCandidate> => {
    const [personality, specialDomestic, specialWar] = await Promise.all([
        loadTraitSnapshot(row.personalCode, 'personality'),
        loadTraitSnapshot(row.specialCode, 'domestic'),
        loadTraitSnapshot(row.special2Code, 'war'),
    ]);
    return {
        id: row.id,
        name: row.name,
        nation: nation ?? { id: 0, name: '재야', color: '#666666' },
        stats: {
            leadership: row.leadership,
            strength: row.strength,
            intelligence: row.intel,
        },
        picture: row.picture,
        imageServer: row.imageServer,
        personality,
        specialDomestic,
        specialWar,
        keepCount: KEEP_COUNT,
    };
};

export const chooseNpcPossessionCandidates = (
    candidates: NpcPossessionCandidate[],
    kept: Record<string, NpcPossessionCandidate>,
    rng: RandUtil,
    onDraw?: (selectedId: string) => void
): Record<string, NpcPossessionCandidate> => {
    const picked = { ...kept };
    const weights = Object.fromEntries(
        candidates.map((candidate) => [
            String(candidate.id),
            Math.pow(candidate.stats.leadership + candidate.stats.strength + candidate.stats.intelligence, 1.5),
        ])
    );
    const byId = new Map(candidates.map((candidate) => [String(candidate.id), candidate]));
    const pickLimit = Math.min(candidates.length, MAX_PICK_COUNT);
    while (Object.keys(picked).length < pickLimit) {
        const selectedId = String(rng.choiceUsingWeight(weights));
        onDraw?.(selectedId);
        if (!Object.hasOwn(picked, selectedId)) {
            const candidate = byId.get(selectedId);
            if (!candidate) {
                throw new Error(`NPC 빙의 후보 ${selectedId}를 찾을 수 없습니다.`);
            }
            picked[selectedId] = candidate;
        }
    }
    return picked;
};

class ObservedRandUtil extends RandUtil {
    constructor(
        rng: RNG,
        private readonly onRandomDraw: (value: number) => void
    ) {
        super(rng);
    }

    public override nextFloat1(): number {
        const value = super.nextFloat1();
        this.onRandomDraw(value);
        return value;
    }
}

export const reserveNpcPossessionCandidates = async (options: {
    db: DatabaseClient;
    worldState: WorldStateRow;
    userId: string;
    ownerIdentity: string | number;
    refresh?: boolean;
    keepIds?: number[];
    now?: Date;
    selectionObserver?: NpcPossessionSelectionObserver;
}): Promise<NpcPossessionReservation> => {
    const { db, worldState, userId } = options;
    requireNpcPossessionWorld(worldState);
    const now = truncateToSeconds(options.now ?? new Date());
    await lockNpcPossession(db, userId);

    if (await db.general.findFirst({ where: { userId }, select: { id: true } })) {
        fail('PRECONDITION_FAILED', '이미 장수가 생성되었습니다');
    }

    const inFlightPossession = await db.inputEvent.findFirst({
        where: {
            target: 'ENGINE',
            eventType: 'npcPossessGeneral',
            actorUserId: userId,
            status: { in: ['PENDING', 'PROCESSING'] },
        },
        select: { requestId: true },
    });
    let existing = (await db.npcSelectionToken.findUnique({
        where: { ownerUserId: userId },
    })) as NpcSelectionTokenRow | null;
    if (inFlightPossession) {
        const inFlightToken = existing;
        if (!inFlightToken) {
            return fail('CONFLICT', '처리 중인 NPC 빙의 요청이 있습니다.');
        }
        if (options.refresh) {
            fail('CONFLICT', 'NPC 빙의 요청 처리 중에는 후보를 다시 뽑을 수 없습니다.');
        }
        return toReservation(inFlightToken, now);
    }
    if (existing && existing.validUntil.getTime() < now.getTime()) {
        await db.npcSelectionToken.deleteMany({
            where: {
                ownerUserId: userId,
                nonce: existing.nonce,
                validUntil: { lt: now },
            },
        });
        existing = null;
    }

    const kept: Record<string, NpcPossessionCandidate> = {};
    if (existing && options.refresh) {
        if (now.getTime() < existing.pickMoreFrom.getTime()) {
            fail('PRECONDITION_FAILED', '아직 다시 뽑을 수 없습니다');
        }
        const oldPick = parsePickResult(existing.pickResult);
        for (const keepId of options.keepIds ?? []) {
            const key = String(keepId);
            const candidate = oldPick[key];
            if (candidate && candidate.keepCount > 0) {
                kept[key] = { ...candidate, keepCount: candidate.keepCount - 1 };
            }
        }
        // Ref는 모든 후보를 보관하면 refresh를 취소하며 차감도 저장하지 않는다.
        if (Object.keys(kept).length === Object.keys(oldPick).length) {
            return toReservation(existing, now);
        }
    } else if (existing) {
        return toReservation(existing, now);
    }

    const reservedRows = await db.npcSelectionToken.findMany({
        where: {
            ownerUserId: { not: userId },
            validUntil: { gte: now },
        },
        select: { pickResult: true },
    });
    const reservedIds = new Set(
        reservedRows.flatMap((row) => Object.keys(parsePickResult(row.pickResult)).map((id) => Number(id)))
    );
    const generalRows = await db.general.findMany({
        where: {
            userId: null,
            npcState: 2,
            ...(reservedIds.size > 0 ? { id: { notIn: [...reservedIds] } } : {}),
        },
        orderBy: { id: 'asc' },
        select: {
            id: true,
            name: true,
            nationId: true,
            leadership: true,
            strength: true,
            intel: true,
            picture: true,
            imageServer: true,
            personalCode: true,
            specialCode: true,
            special2Code: true,
        },
    });
    const nationRows = await db.nation.findMany({
        select: { id: true, name: true, color: true },
    });
    const nations = new Map(nationRows.map((nation) => [nation.id, nation]));
    const candidates = await Promise.all(
        generalRows.map((row) => buildCandidateSnapshot(row, nations.get(row.nationId)))
    );
    const selectionRng = new LiteHashDRBG(
        buildNpcSelectionTokenSeed(readHiddenSeed(worldState), options.ownerIdentity, now)
    );
    const rng = options.selectionObserver?.onRandomDraw
        ? new ObservedRandUtil(selectionRng, options.selectionObserver.onRandomDraw)
        : new RandUtil(selectionRng);
    const pickResult = chooseNpcPossessionCandidates(candidates, kept, rng, options.selectionObserver?.onCandidateDraw);
    const turnTermMinutes = resolveTurnTermMinutes(worldState);
    const validUntil = new Date(now.getTime() + Math.max(VALID_SECONDS, turnTermMinutes * 40) * 1000);
    const refreshedPickMoreFrom = new Date(
        now.getTime() + Math.max(PICK_MORE_SECONDS, Math.round(Math.pow(turnTermMinutes, 0.672) * 8)) * 1000
    );
    const nonce = randomInt(0, 0x10000000);

    if (existing) {
        const updated = await db.npcSelectionToken.updateMany({
            where: { ownerUserId: userId, nonce: existing.nonce },
            data: {
                validUntil,
                pickMoreFrom: refreshedPickMoreFrom,
                pickResult: pickResult as GamePrisma.InputJsonValue,
                nonce,
            },
        });
        if (updated.count === 0) {
            fail('CONFLICT', '중복 요청, 다시 랜덤 토큰을 확인해주세요');
        }
        return toReservation({ validUntil, pickMoreFrom: refreshedPickMoreFrom, pickResult, nonce }, now);
    }

    try {
        await db.npcSelectionToken.create({
            data: {
                ownerUserId: userId,
                validUntil,
                pickMoreFrom: FIRST_PICK_MORE_FROM,
                pickResult: pickResult as GamePrisma.InputJsonValue,
                nonce,
            },
        });
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
            fail('CONFLICT', '중복 요청, 다시 랜덤 토큰을 확인해주세요');
        }
        throw error;
    }
    return toReservation({ validUntil, pickMoreFrom: FIRST_PICK_MORE_FROM, pickResult, nonce }, now);
};

export const possessNpcGeneral = async (options: {
    db: DatabaseClient;
    world: InMemoryTurnWorld;
    worldState: WorldStateRow;
    userId: string;
    ownerDisplayName: string;
    profileId: string;
    ownerLegacyPenalty?: Record<string, unknown>;
    generalId: number;
    tokenNonce: number;
    acceptedAt: Date;
}): Promise<{ ok: true; generalId: number }> => {
    const { db, world, worldState, userId, generalId, acceptedAt } = options;
    // queue 대기 중 만료된 token도 enqueue 시점에는 유효했으므로 저장된 논리 수락 시각으로 다시 검증한다.
    const tokenAcceptedAt = truncateToSeconds(acceptedAt);
    requireNpcPossessionWorld(worldState);
    await lockNpcPossession(db, userId);
    await db.$executeRaw(GamePrisma.sql`LOCK TABLE "general" IN SHARE ROW EXCLUSIVE MODE`);

    if (
        world.listGenerals().some((general) => general.userId === userId) ||
        (await db.general.findFirst({ where: { userId }, select: { id: true } }))
    ) {
        fail('PRECONDITION_FAILED', '이미 장수가 생성되어 있습니다.');
    }

    const token = (await db.npcSelectionToken.findFirst({
        where: {
            ownerUserId: userId,
            nonce: options.tokenNonce,
            validUntil: { gte: tokenAcceptedAt },
        },
    })) as NpcSelectionTokenRow | null;
    if (!token) {
        return fail('PRECONDITION_FAILED', '유효한 장수 목록이 없습니다.');
    }
    const pickResult = parsePickResult(token.pickResult);
    const picked = pickResult[String(generalId)];
    if (!picked) {
        fail('PRECONDITION_FAILED', '선택한 장수가 목록에 없습니다.');
    }

    const activeCount = await db.general.count({ where: { npcState: { lt: 2 } } });
    if (activeCount >= resolveMaxGeneral(worldState)) {
        fail('PRECONDITION_FAILED', '더 이상 등록 할 수 없습니다.');
    }

    const row = await db.general.findUnique({
        where: { id: generalId },
        select: { userId: true, npcState: true },
    });
    const general = world.getGeneralById(generalId);
    if (!row || row.userId !== null || row.npcState !== 2 || !general || general.userId || general.npcState !== 2) {
        return fail('NOT_FOUND', '장수 등록에 실패했습니다.');
    }

    const penalty = resolveLegacyPenalty(options.ownerLegacyPenalty, options.profileId, acceptedAt);
    world.updateGeneral(generalId, {
        userId,
        npcState: 1,
        penalty,
        meta: {
            ...general.meta,
            npc_org: 2,
            ownerName: options.ownerDisplayName,
            owner_name: options.ownerDisplayName,
            pickYearMonth: worldState.currentYear * 12 + worldState.currentMonth - 1,
            killturn: 6,
            defence_train: 80,
            permission: 'normal',
        },
    });

    await db.generalAccessLog.upsert({
        where: { generalId },
        update: {
            userId,
            lastRefresh: acceptedAt,
            refresh: 0,
            refreshTotal: 0,
            refreshScore: 0,
            refreshScoreTotal: 0,
        },
        create: {
            generalId,
            userId,
            lastRefresh: acceptedAt,
        },
    });
    await db.npcSelectionToken.deleteMany({ where: { ownerUserId: userId } });

    const logger = new ActionLogger({ generalId });
    const josaYi = JosaUtil.pick(options.ownerDisplayName, '이');
    logger.pushGeneralHistoryLog(`<Y>${picked.name}</>의 육체에 <Y>${options.ownerDisplayName}</>${josaYi} 빙의되다.`);
    logger.pushGlobalActionLog(
        `<Y>${picked.name}</>의 육체에 <Y>${options.ownerDisplayName}</>${josaYi} <S>빙의</>됩니다!`
    );
    for (const log of logger.flush()) {
        world.pushLog(log);
    }
    return { ok: true, generalId };
};
