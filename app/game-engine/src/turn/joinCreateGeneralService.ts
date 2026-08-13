import { asNumber, asRecord, JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';
import {
    ActionLogger,
    buildAuctionAlias,
    buildAuctionAliasPool,
    getLegacyStringWidth,
    isPersonalityTraitKey,
    isWarTraitKey,
    JOIN_PERSONALITY_TRAIT_KEYS,
    loadWarTraitModules,
    LogFormat,
    normalizeTroopName,
    simpleSerialize,
    TraitSelector,
    WarTraitLoader,
    WAR_TRAIT_KEYS,
} from '@sammo-ts/logic';
import type { WarTraitKey } from '@sammo-ts/logic';

import type { DatabaseClient, GamePrisma as GamePrismaTypes } from '@sammo-ts/infra';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import { buildPrestartDeleteAfter } from './prestartDeletion.js';
import type { TurnGeneral } from './types.js';

type WorldStateRow = GamePrismaTypes.WorldStateGetPayload<Record<string, never>>;

export type JoinCreateGeneralErrorCode =
    'BAD_REQUEST' | 'FORBIDDEN' | 'PRECONDITION_FAILED' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR';

export class JoinCreateGeneralError extends Error {
    constructor(
        readonly code: JoinCreateGeneralErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'JoinCreateGeneralError';
    }
}

export interface JoinCreateGeneralInput {
    userId: string;
    ownerDisplayName: string;
    seedOwnerIdentity: string | number;
    name: string;
    leadership: number;
    strength: number;
    intel: number;
    pic: boolean;
    character: string;
    profileId: string;
    ownerPicture?: string;
    ownerImageServer?: number;
    ownerIconRevision?: string;
    ownerCanUsePicture?: boolean;
    ownerLegacyPenalty?: Record<string, unknown>;
    inheritSpecial?: string;
    inheritTurntimeZone?: number;
    inheritCity?: number;
    inheritBonusStat?: [number, number, number];
}

interface InheritConstants {
    inheritBornSpecialPoint: number;
    inheritBornTurntimePoint: number;
    inheritBornCityPoint: number;
    inheritBornStatPoint: number;
}

const DEFAULT_JOIN_STAT = {
    total: 165,
    min: 15,
    max: 80,
};
const DEFAULT_MAX_GENERAL = 500;
const DEFAULT_MAX_GENIUS = 5;
const DEFAULT_GENERAL_GOLD = 1000;
const DEFAULT_GENERAL_RICE = 1000;
const DEFAULT_CREW_TYPE_ID = 1100;
const MAX_GENERAL_TURNS = 30;
const DEFAULT_TURN_ACTION = '휴식';
export const JOIN_WELCOME_MESSAGE = '삼국지 모의전투 HiDCHe의 세계에 오신 것을 환영합니다 ^o^';
const LEGACY_TIMEZONE_OFFSET_MS = 9 * 60 * 60 * 1000;
const LEGACY_JOIN_REMOVED_CHARACTERS = /[ⓝⓜⓖⓞⓧ㉥\\/`#|-]/gu;

const fail = (code: JoinCreateGeneralErrorCode, message: string): never => {
    throw new JoinCreateGeneralError(code, message);
};

const normalizeJoinName = (value: string): string =>
    normalizeTroopName(value).replace(LEGACY_JOIN_REMOVED_CHARACTERS, '');

export const resolveLegacyPenalty = (
    rawPenalty: Record<string, unknown> | undefined,
    profileId: string,
    acceptedAt: Date
): Record<string, unknown> => {
    if (!rawPenalty) {
        return {};
    }
    const merged = {
        ...asRecord(rawPenalty.any),
        ...asRecord(rawPenalty[profileId]),
    };
    const acceptedAtSeconds = acceptedAt.getTime() / 1000;
    const result: Record<string, unknown> = {};
    for (const [key, rawEntry] of Object.entries(merged)) {
        const entry = asRecord(rawEntry);
        if (asNumber(entry.expire, 0) > acceptedAtSeconds && Object.hasOwn(entry, 'value')) {
            result[key] = entry.value;
        }
    }
    return result;
};

const resolveStatRule = (worldState: WorldStateRow) => {
    const stat = asRecord(asRecord(worldState.config).stat);
    return {
        total: asNumber(stat.total, DEFAULT_JOIN_STAT.total),
        min: asNumber(stat.min, DEFAULT_JOIN_STAT.min),
        max: asNumber(stat.max, DEFAULT_JOIN_STAT.max),
    };
};

const resolveInheritConstants = (worldState: WorldStateRow): InheritConstants => {
    const configConst = asRecord(asRecord(worldState.config).const);
    return {
        inheritBornSpecialPoint: asNumber(configConst.inheritBornSpecialPoint, 6000),
        inheritBornTurntimePoint: asNumber(configConst.inheritBornTurntimePoint, 2500),
        inheritBornCityPoint: asNumber(configConst.inheritBornCityPoint, 1000),
        inheritBornStatPoint: asNumber(configConst.inheritBornStatPoint, 1000),
    };
};

const isSelectionPoolWorld = (worldState: WorldStateRow): boolean => {
    const config = asRecord(worldState.config);
    const map = asRecord(config.map);
    return asNumber(config.npcMode, 0) === 2 && map.targetGeneralPool === 'SPoolUnderU30';
};

const resolveMaxGeneral = (worldState: WorldStateRow): number => {
    const config = asRecord(worldState.config);
    const configConst = asRecord(config.const);
    return Math.max(
        0,
        Math.floor(
            asNumber(config.maxGeneral ?? configConst.defaultMaxGeneral ?? configConst.maxGeneral, DEFAULT_MAX_GENERAL)
        )
    );
};

const readHiddenSeed = (worldState: WorldStateRow): string | number => {
    const meta = asRecord(worldState.meta);
    const value = meta.hiddenSeed ?? meta.seed;
    if (typeof value === 'string' || typeof value === 'number') {
        return value;
    }
    return fail('INTERNAL_SERVER_ERROR', '장수 생성 비밀 seed가 설정되지 않았습니다.');
};

export const buildJoinCreateGeneralSeed = (
    hiddenSeed: string | number,
    ownerIdentity: string | number,
    acceptedTick: number
): string => simpleSerialize(hiddenSeed, 'MakeGeneral', ownerIdentity, acceptedTick);

const lockJoinMutation = async (db: DatabaseClient, userId: string): Promise<void> => {
    await db.$executeRaw(GamePrisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`join-create:${userId}`}, 0))`);
    await db.$executeRaw(GamePrisma.sql`LOCK TABLE "general" IN SHARE ROW EXCLUSIVE MODE`);
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

const applyInheritanceUser = async (
    db: DatabaseClient,
    userId: string,
    year: number,
    month: number
): Promise<number> => {
    const rows = await db.$queryRaw<Array<{ key: string; value: number }>>(
        GamePrisma.sql`
            SELECT key, value
            FROM inheritance_point
            WHERE user_id = ${userId}
            ORDER BY id ASC
            FOR UPDATE
        `
    );
    if (rows.length === 0) {
        return 0;
    }
    if (rows.length === 1 && rows[0]?.key === 'previous') {
        return rows[0].value;
    }

    const previousPoint = rows.find((row) => row.key === 'previous')?.value ?? 0;
    const totalPoint = Math.trunc(rows.reduce((sum, row) => sum + row.value, 0));
    for (const row of rows) {
        await db.inheritanceLog.create({
            data: {
                userId,
                year,
                month,
                text: `${row.key} 포인트 ${row.value} 증가`,
            },
        });
    }
    await db.inheritanceLog.create({
        data: {
            userId,
            year,
            month,
            text: `포인트 ${previousPoint} => ${totalPoint}`,
        },
    });
    await db.inheritancePoint.deleteMany({
        where: {
            userId,
            key: { not: 'previous' },
        },
    });
    await setInheritancePoint(db, userId, totalPoint);
    return totalPoint;
};

const setInheritancePoint = async (db: DatabaseClient, userId: string, value: number): Promise<void> => {
    await db.inheritancePoint.upsert({
        where: { userId_key: { userId, key: 'previous' } },
        update: { value },
        create: { userId, key: 'previous', value },
    });
};

const appendInheritanceLog = async (
    db: DatabaseClient,
    userId: string,
    year: number,
    month: number,
    text: string
): Promise<void> => {
    await db.inheritanceLog.create({
        data: { userId, year, month, text },
    });
};

const calculateInheritanceCost = (
    input: JoinCreateGeneralInput,
    constants: InheritConstants,
    inheritBonus: [number, number, number] | null
): number => {
    let required = 0;
    if (input.inheritCity !== undefined) {
        required += constants.inheritBornCityPoint;
    }
    if (inheritBonus) {
        required += constants.inheritBornStatPoint;
    }
    if (input.inheritSpecial !== undefined) {
        required += constants.inheritBornSpecialPoint;
    }
    if (input.inheritTurntimeZone !== undefined) {
        required += constants.inheritBornTurntimePoint;
    }
    return required;
};

const validateAndNormalizeBonus = (bonus: [number, number, number] | undefined): [number, number, number] | null => {
    if (!bonus) {
        return null;
    }
    if (bonus.some((value) => !Number.isInteger(value) || value < 0)) {
        fail('BAD_REQUEST', '보너스 능력치가 음수입니다. 다시 가입해주세요!');
    }
    const sum = bonus.reduce((acc, value) => acc + value, 0);
    if (sum === 0) {
        return null;
    }
    if (sum < 3 || sum > 5) {
        fail('BAD_REQUEST', '보너스 능력치 합이 잘못 지정되었습니다. 다시 가입해주세요!');
    }
    return bonus;
};

const buildRandomBonus = (rng: RandUtil, baseStats: [number, number, number]): [number, number, number] => {
    const result: [number, number, number] = [0, 0, 0];
    const count = rng.nextRangeInt(3, 5);
    for (let index = 0; index < count; index += 1) {
        const selected = Number(
            rng.choiceUsingWeight({
                0: baseStats[0],
                1: baseStats[1],
                2: baseStats[2],
            })
        );
        result[selected as 0 | 1 | 2] += 1;
    }
    return result;
};

const resolveRelativeYear = (worldState: WorldStateRow): number => {
    const scenarioMeta = asRecord(asRecord(worldState.meta).scenarioMeta);
    const startYear = asNumber(scenarioMeta.startYear, worldState.currentYear);
    return Math.max(worldState.currentYear - startYear, 0);
};

const resolveSpecialityAge = (retirementYear: number, age: number, relativeYear: number, divisor: number): number =>
    Math.max(Math.round((retirementYear - age) / divisor - relativeYear / 2), 3) + age;

export const cutJoinTurnTime = (value: Date, tickSeconds: number): Date => {
    const koreaTime = new Date(value.getTime() + LEGACY_TIMEZONE_OFFSET_MS);
    const baseTime =
        Date.UTC(koreaTime.getUTCFullYear(), koreaTime.getUTCMonth(), koreaTime.getUTCDate() - 1, 1) -
        LEGACY_TIMEZONE_OFFSET_MS;
    const elapsedSeconds = Math.floor((value.getTime() - baseTime) / 1000);
    const alignedSeconds = elapsedSeconds - (elapsedSeconds % tickSeconds);
    return new Date(baseTime + alignedSeconds * 1000);
};

const resolveTurnTime = (
    rng: RandUtil,
    worldState: WorldStateRow,
    acceptedAt: Date,
    runtimeTurnTime: Date,
    inheritTurntimeZone: number | undefined
): Date => {
    const tickSeconds = Math.max(1, Math.floor(worldState.tickSeconds));
    const base = runtimeTurnTime;
    let offsetSeconds: number;
    let offsetMicros: number;
    let turnTimeBase: Date;
    if (inheritTurntimeZone !== undefined) {
        const legacyTurnTermMinutes = Math.max(1, Math.floor(tickSeconds / 60));
        turnTimeBase = cutJoinTurnTime(base, tickSeconds);
        offsetSeconds = inheritTurntimeZone * legacyTurnTermMinutes + rng.nextRangeInt(0, legacyTurnTermMinutes - 1);
        offsetMicros = rng.nextRangeInt(0, 999_999);
    } else {
        turnTimeBase = base;
        offsetSeconds = rng.nextRangeInt(0, tickSeconds - 1);
        offsetMicros = rng.nextRangeInt(0, 999_999);
    }
    let turnTime = new Date(turnTimeBase.getTime() + offsetSeconds * 1000 + offsetMicros / 1000);
    if (turnTime.getTime() <= acceptedAt.getTime()) {
        turnTime = new Date(turnTime.getTime() + tickSeconds * 1000);
    }
    return turnTime;
};

const resolveCatchupExperience = async (db: DatabaseClient, relativeYear: number): Promise<number> => {
    if (relativeYear < 3) {
        return 0;
    }
    const count = await db.general.count({
        where: { nationId: { not: 0 }, npcState: { lt: 4 } },
    });
    if (count === 0) {
        return 0;
    }
    const order = Math.max(1, Math.round(count * 0.2));
    const row = await db.general.findFirst({
        where: { nationId: { not: 0 }, npcState: { lt: 4 } },
        orderBy: [{ experience: 'asc' }, { id: 'asc' }],
        skip: order - 1,
        select: { experience: true },
    });
    return Math.round((row?.experience ?? 0) * 0.8);
};

const resolveRestInheritanceBonus = async (
    db: DatabaseClient,
    worldState: WorldStateRow,
    userId: string
): Promise<number> => {
    const meta = asRecord(worldState.meta);
    const serverId = typeof meta.serverId === 'string' ? meta.serverId : '';
    const season = Math.floor(asNumber(meta.season, 0));
    if (!serverId || season < 1) {
        return 0;
    }
    if (
        (await db.inheritanceResult.count({
            where: { serverId, owner: userId },
        })) > 0
    ) {
        return 0;
    }
    const oldGames = await db.gameHistory.findMany({
        where: {
            winnerNation: { not: null },
            season: { gte: 1 },
            serverId: { not: serverId },
        },
        orderBy: { date: 'desc' },
        take: 8,
        select: { serverId: true },
    });
    if (oldGames.length === 0) {
        return 0;
    }
    const oldServerIds = oldGames.map(({ serverId: oldServerId }) => oldServerId);
    const playedRows = await db.oldGeneral.findMany({
        where: {
            owner: userId,
            serverId: { in: oldServerIds },
        },
        distinct: ['serverId'],
        select: { serverId: true },
    });
    const played = new Set(playedRows.map(({ serverId: oldServerId }) => oldServerId));
    let missedGames = 0;
    for (const { serverId: oldServerId } of oldGames) {
        if (played.has(oldServerId)) {
            break;
        }
        missedGames += 1;
    }
    return missedGames * 500;
};

const pushCreationLogs = (
    world: InMemoryTurnWorld,
    options: {
        generalId: number;
        userId: string;
        name: string;
        cityName: string;
        bonus: [number, number, number];
        age: number;
        genius: boolean;
        specialWarName: string;
    }
): void => {
    const logger = new ActionLogger({ generalId: options.generalId });
    const josaRa = JosaUtil.pick(options.name, '라');
    if (options.genius) {
        logger.pushGlobalActionLog(
            `<G><b>${options.cityName}</b></>에서 <Y>${options.name}</>${josaRa}는 기재가 천하에 이름을 알립니다.`
        );
        logger.pushGlobalActionLog(
            `<C>${options.specialWarName}</> 특기를 가진 <C>천재</>의 등장으로 온 천하가 떠들썩합니다.`
        );
        logger.pushGlobalHistoryLog(`<L><b>【천재】</b></><G><b>${options.cityName}</b></>에 천재가 등장했습니다.`);
    } else {
        logger.pushGlobalActionLog(
            `<G><b>${options.cityName}</b></>에서 <Y>${options.name}</>${josaRa}는 호걸이 천하에 이름을 알립니다.`
        );
    }
    logger.pushGeneralHistoryLog(`<Y>${options.name}</>, <G>${options.cityName}</>에서 큰 뜻을 품다.`);
    logger.pushGeneralActionLog(
        [
            JOIN_WELCOME_MESSAGE,
            '처음 하시는 경우에는 <D>도움말</>을 참고하시고,',
            '문의사항이 있으시면 게시판에 글을 남겨주시면 되겠네요~',
            '부디 즐거운 삼모전 되시길 바랍니다 ^^',
            `통솔 <C>${options.bonus[0]}</> 무력 <C>${options.bonus[1]}</> 지력 <C>${options.bonus[2]}</> 의 보너스를 받으셨습니다.`,
            `연령은 <C>${options.age}</>세로 시작합니다.`,
        ],
        LogFormat.PLAIN
    );
    if (options.genius) {
        logger.pushGeneralActionLog(
            `축하합니다! 천재로 태어나 처음부터 <C>${options.specialWarName}</> 특기를 가지게 됩니다!`,
            LogFormat.PLAIN
        );
        logger.pushGeneralHistoryLog(`<C>${options.specialWarName}</> 특기를 가진 천재로 탄생.`);
    }
    for (const entry of logger.flush()) {
        world.pushLog({
            ...entry,
            meta: {
                ...(entry.meta ?? {}),
                ownerUserId: options.userId,
            },
        });
    }
};

export const createGeneralFromJoin = async (options: {
    db: DatabaseClient;
    world: InMemoryTurnWorld;
    worldState: WorldStateRow;
    input: JoinCreateGeneralInput;
    acceptedAt: Date;
}): Promise<{ ok: true; generalId: number }> => {
    const { db, world, worldState, input, acceptedAt } = options;
    await lockJoinMutation(db, input.userId);
    await assertGeneralIdSnapshotMatches(db, world);

    if (isSelectionPoolWorld(worldState)) {
        fail('PRECONDITION_FAILED', '장수 선택 목록에서 장수를 골라 주세요.');
    }
    const config = asRecord(worldState.config);
    const configConst = asRecord(config.const);
    const blockGeneralCreate = Math.floor(asNumber(config.blockGeneralCreate, 0));
    if ((blockGeneralCreate & 1) !== 0) {
        fail('FORBIDDEN', '장수 직접 생성이 불가능한 모드입니다.');
    }

    if (
        world.listGenerals().some((general) => general.userId === input.userId) ||
        (await db.general.findFirst({
            where: { userId: input.userId },
            select: { id: true },
        }))
    ) {
        fail('PRECONDITION_FAILED', '이미 등록하셨습니다!');
    }

    const normalizedName = normalizeJoinName(input.name);
    if (!normalizedName || getLegacyStringWidth(normalizedName) < 1) {
        fail('BAD_REQUEST', '이름이 짧습니다. 다시 가입해주세요!');
    }
    if (getLegacyStringWidth(normalizedName) > 18) {
        fail('BAD_REQUEST', '이름이 유효하지 않습니다. 다시 가입해주세요!');
    }
    if (
        world.listGenerals().some((general) => general.name === normalizedName) ||
        (await db.general.findFirst({
            where: { name: normalizedName },
            select: { id: true },
        }))
    ) {
        fail('CONFLICT', '이미 있는 장수입니다. 다른 이름으로 등록해 주세요!');
    }

    const activeCount = await db.general.count({ where: { npcState: { lt: 2 } } });
    if (activeCount >= resolveMaxGeneral(worldState)) {
        fail('PRECONDITION_FAILED', '더이상 등록할 수 없습니다!');
    }

    const statRule = resolveStatRule(worldState);
    const stats = [input.leadership, input.strength, input.intel] as const;
    if (stats.some((value) => !Number.isInteger(value) || value < statRule.min || value > statRule.max)) {
        fail('BAD_REQUEST', '능력치 범위를 벗어났습니다.');
    }
    if (stats.reduce((sum, value) => sum + value, 0) > statRule.total) {
        fail('BAD_REQUEST', `능력치가 ${statRule.total}을 넘어섰습니다. 다시 가입해주세요!`);
    }

    if (
        input.character !== 'Random' &&
        (!isPersonalityTraitKey(input.character) || !JOIN_PERSONALITY_TRAIT_KEYS.some((key) => key === input.character))
    ) {
        fail('BAD_REQUEST', '성격이 잘못 지정되었습니다.');
    }
    const availableSpecialWar = Array.isArray(configConst.availableSpecialWar)
        ? configConst.availableSpecialWar.filter(
              (value): value is WarTraitKey => typeof value === 'string' && isWarTraitKey(value)
          )
        : [...WAR_TRAIT_KEYS];
    if (
        input.inheritSpecial !== undefined &&
        (!isWarTraitKey(input.inheritSpecial) || !availableSpecialWar.includes(input.inheritSpecial))
    ) {
        fail('BAD_REQUEST', '전투 특기가 잘못 지정되었습니다.');
    }
    if (
        input.inheritTurntimeZone !== undefined &&
        (!Number.isInteger(input.inheritTurntimeZone) ||
            input.inheritTurntimeZone < 0 ||
            input.inheritTurntimeZone > 59)
    ) {
        fail('BAD_REQUEST', '턴 시간 지정 범위가 올바르지 않습니다.');
    }

    const inheritBonus = validateAndNormalizeBonus(input.inheritBonusStat);
    const inheritConstants = resolveInheritConstants(worldState);
    const inheritRequiredPoint = calculateInheritanceCost(input, inheritConstants, inheritBonus);
    const currentInheritancePoint = await applyInheritanceUser(
        db,
        input.userId,
        worldState.currentYear,
        worldState.currentMonth
    );
    if (currentInheritancePoint < inheritRequiredPoint) {
        fail('BAD_REQUEST', '유산 포인트가 부족합니다. 다시 가입해주세요!');
    }

    const allCities = world.listCities().sort((left, right) => left.id - right.id);
    const selectedCity =
        input.inheritCity === undefined ? null : (allCities.find((city) => city.id === input.inheritCity) ?? null);
    if (input.inheritCity !== undefined && !selectedCity) {
        fail('BAD_REQUEST', '도시가 잘못 지정되었습니다. 다시 가입해주세요!');
    }
    const neutralCities = allCities.filter((city) => city.level >= 5 && city.level <= 6 && city.nationId === 0);
    const randomCities =
        neutralCities.length > 0 ? neutralCities : allCities.filter((city) => city.level >= 5 && city.level <= 6);
    if (!selectedCity && randomCities.length === 0) {
        fail('PRECONDITION_FAILED', '생성 가능한 도시가 없습니다.');
    }

    const hiddenSeed = readHiddenSeed(worldState);
    const rng = new RandUtil(
        new LiteHashDRBG(
            buildJoinCreateGeneralSeed(hiddenSeed, input.seedOwnerIdentity, world.dateToGameTick(acceptedAt))
        )
    );
    const worldMeta = asRecord(worldState.meta);
    const currentGenius = Math.max(
        0,
        Math.floor(asNumber(worldMeta.genius, asNumber(configConst.defaultMaxGenius, DEFAULT_MAX_GENIUS)))
    );
    if (input.inheritSpecial !== undefined && currentGenius === 0) {
        fail('PRECONDITION_FAILED', '이미 천재가 모두 나타났습니다. 다시 가입해주세요!');
    }
    const geniusRequested = input.inheritSpecial !== undefined || rng.nextBool(0.01);
    const genius = geniusRequested && currentGenius > 0;

    const city = selectedCity ?? rng.choice(randomCities);
    const bonus = inheritBonus ?? buildRandomBonus(rng, [...stats]);
    const finalStats = {
        leadership: input.leadership + bonus[0],
        strength: input.strength + bonus[1],
        intelligence: input.intel + bonus[2],
    };
    const age = 20 + (bonus[0] + bonus[1] + bonus[2]) * 2 - rng.nextRangeInt(0, 1);
    const relativeYear = resolveRelativeYear(worldState);
    const retirementYear = asNumber(configConst.retirementYear, 80);
    const scenarioId = Number(worldMeta.scenarioId ?? worldState.scenarioCode);
    let specialityDomesticAge = resolveSpecialityAge(retirementYear, age, relativeYear, 12);
    let specialityWarAge = resolveSpecialityAge(retirementYear, age, relativeYear, 6);
    let specialWar = typeof configConst.defaultSpecialWar === 'string' ? configConst.defaultSpecialWar : 'None';
    let specialWarName = specialWar;
    if (genius) {
        specialityWarAge = age;
        if (input.inheritSpecial) {
            specialWar = input.inheritSpecial;
        } else {
            const traits = await loadWarTraitModules(availableSpecialWar, new WarTraitLoader());
            specialWar =
                TraitSelector.pickWarTrait(
                    rng,
                    finalStats,
                    [0, 0, 0, 0, 0],
                    traits,
                    [],
                    world.getScenarioConfig().stat
                ) ?? specialWar;
        }
        const [trait] = await loadWarTraitModules(
            [specialWar].filter((key) => isWarTraitKey(key)),
            new WarTraitLoader()
        );
        specialWarName = trait?.name ?? specialWar;
    }
    if (Number.isFinite(scenarioId) && scenarioId >= 1000) {
        specialityDomesticAge = age + 3;
        specialityWarAge = age + 3;
    }

    const experience = await resolveCatchupExperience(db, relativeYear);
    const turnTime = resolveTurnTime(
        rng,
        worldState,
        acceptedAt,
        world.getState().lastTurnTime,
        input.inheritTurntimeZone
    );
    const personality = input.character === 'Random' ? rng.choice([...JOIN_PERSONALITY_TRAIT_KEYS]) : input.character;
    const affinity = rng.nextRangeInt(1, 150);
    const generalId = world.getNextGeneralId();
    let obfuscatedNamePool = Array.isArray(worldMeta.obfuscatedNamePool)
        ? worldMeta.obfuscatedNamePool.filter((value): value is string => typeof value === 'string')
        : [];
    if ((blockGeneralCreate & 2) !== 0 && obfuscatedNamePool.length === 0) {
        obfuscatedNamePool = buildAuctionAliasPool(hiddenSeed, configConst);
        world.updateWorldMeta({ obfuscatedNamePool });
    }
    const finalName =
        (blockGeneralCreate & 2) !== 0
            ? buildAuctionAlias(generalId, hiddenSeed, {
                  ...configConst,
                  obfuscatedNamePool,
              })
            : normalizedName;
    const showImgLevel = Math.floor(asNumber(config.showImgLevel, 0));
    const canUseOwnerPicture =
        showImgLevel >= 1 &&
        input.pic === true &&
        input.ownerCanUsePicture === true &&
        typeof input.ownerPicture === 'string' &&
        input.ownerPicture.length > 0 &&
        input.ownerPicture !== 'default.jpg';
    const picture = canUseOwnerPicture ? input.ownerPicture! : 'default.jpg';
    const imageServer = canUseOwnerPicture ? Math.max(0, Math.floor(input.ownerImageServer ?? 0)) : 0;
    const accountIconUpdatedAt =
        input.ownerIconRevision &&
        picture === input.ownerPicture &&
        imageServer === Math.max(0, Math.floor(input.ownerImageServer ?? 0))
            ? input.ownerIconRevision
            : undefined;
    const nextInheritancePoint = currentInheritancePoint - inheritRequiredPoint;
    const restInheritanceBonus = await resolveRestInheritanceBonus(db, worldState, input.userId);
    const finalInheritancePoint = nextInheritancePoint + restInheritanceBonus;
    const prestartDeleteAfter = buildPrestartDeleteAfter(acceptedAt, worldState.tickSeconds, config);
    const general: TurnGeneral = {
        id: generalId,
        userId: input.userId,
        name: finalName,
        nationId: 0,
        cityId: city.id,
        troopId: 0,
        npcState: 0,
        affinity,
        // Ref Join은 두 컬럼을 지정하지 않아 schema 기본값 180/300을 유지한다.
        bornYear: 180,
        deadYear: 300,
        picture,
        imageServer,
        stats: finalStats,
        experience,
        dedication: 0,
        officerLevel: 0,
        injury: 0,
        gold: asNumber(configConst.defaultGold, DEFAULT_GENERAL_GOLD),
        rice: asNumber(configConst.defaultRice, DEFAULT_GENERAL_RICE),
        crew: 0,
        crewTypeId: world.getUnitSet()?.defaultCrewTypeId ?? DEFAULT_CREW_TYPE_ID,
        train: 0,
        atmos: 0,
        turnTime,
        age,
        startAge: age,
        role: {
            personality,
            specialDomestic:
                typeof configConst.defaultSpecialDomestic === 'string' ? configConst.defaultSpecialDomestic : 'None',
            specialWar,
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
        penalty: resolveLegacyPenalty(input.ownerLegacyPenalty, input.profileId, acceptedAt),
        inheritancePoints: {
            previous: finalInheritancePoint,
        },
        refreshScoreTotal: 0,
        meta: {
            createdBy: 'join',
            ownerName: input.ownerDisplayName,
            owner_name: input.ownerDisplayName,
            killturn: 6,
            npc_org: 0,
            newmsg: 0,
            makelimit: 0,
            block: 0,
            dedlevel: 0,
            explevel: 0,
            officerCity: 0,
            officer_city: 0,
            permission: 'normal',
            belong: 1,
            betray: relativeYear >= 4 ? 2 : 0,
            specage: specialityDomesticAge,
            specage2: specialityWarAge,
            defence_train: 80,
            tnmt: 1,
            myset: 6,
            tournament: 0,
            newvote: 0,
            inherit_spent_dyn: inheritRequiredPoint,
            prestart_delete_after: prestartDeleteAfter.toISOString(),
            ...(accountIconUpdatedAt ? { accountIconUpdatedAt } : {}),
        },
    };
    if (!world.addGeneral(general)) {
        throw new Error(`장수 번호 ${generalId}를 할당할 수 없습니다.`);
    }
    if (genius) {
        world.updateWorldMeta({ genius: currentGenius - 1 });
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
        data: { generalId, revision: 0 },
    });
    await db.generalAccessLog.upsert({
        where: { generalId },
        update: { userId: input.userId, lastRefresh: acceptedAt },
        create: {
            generalId,
            userId: input.userId,
            lastRefresh: acceptedAt,
        },
    });
    if (inheritRequiredPoint > 0) {
        await setInheritancePoint(db, input.userId, nextInheritancePoint);
        const inheritLogs: string[] = [];
        if (input.inheritSpecial) {
            inheritLogs.push(`${specialWarName} 전투 특기를 가진 천재 생성`);
        }
        if (input.inheritCity !== undefined) {
            inheritLogs.push(`${city.name}에 장수 생성`);
        }
        if (inheritBonus) {
            inheritLogs.push(`${inheritBonus[0]}, ${inheritBonus[1]}, ${inheritBonus[2]} 보너스 능력치로 생성`);
        }
        if (input.inheritTurntimeZone !== undefined) {
            const zoneStart = input.inheritTurntimeZone * Math.max(1, Math.floor(worldState.tickSeconds / 60));
            inheritLogs.push(
                `턴 시간 ${String(Math.floor(zoneStart / 60)).padStart(2, '0')}:${String(zoneStart % 60).padStart(
                    2,
                    '0'
                )} 로 지정`
            );
        }
        inheritLogs.push(`장수 생성으로 포인트 ${inheritRequiredPoint} 소모`);
        for (const text of inheritLogs) {
            await appendInheritanceLog(db, input.userId, worldState.currentYear, worldState.currentMonth, text);
        }
    }
    if (restInheritanceBonus > 0) {
        await setInheritancePoint(db, input.userId, finalInheritancePoint);
        await appendInheritanceLog(
            db,
            input.userId,
            worldState.currentYear,
            worldState.currentMonth,
            `신규/복귀 생성으로 포인트 ${restInheritanceBonus} 지급`
        );
    }
    pushCreationLogs(world, {
        generalId,
        userId: input.userId,
        name: finalName,
        cityName: city.name,
        bonus,
        age,
        genius,
        specialWarName,
    });
    return { ok: true, generalId };
};
