import {
    asNumber,
    asRecord,
    LiteHashDRBG,
    parseJson,
    RandUtil,
    rankDataMetaKey,
    type TurnDaemonCommand,
    type TurnDaemonCommandResult,
    type TurnDaemonInheritanceAction,
} from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';
import {
    isCentennialStatResetAllowed,
    isWarTraitKey,
    loadWarTraitModules,
    resolveMessageTargetIcon,
    WarTraitLoader,
    type InheritBuffType,
    type MessageDraft,
    type MessageTarget,
} from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { TurnGeneral } from './types.js';

type InheritanceActionCommand = Extract<TurnDaemonCommand, { type: 'inheritanceAction' }>;
type InheritanceActionResult = Extract<TurnDaemonCommandResult, { type: 'inheritanceAction' }>;

interface InheritConstants {
    inheritBornStatPoint: number;
    inheritItemRandomPoint: number;
    inheritBuffPoints: number[];
    inheritSpecificSpecialPoint: number;
    inheritResetAttrPointBase: number[];
    inheritCheckOwnerPoint: number;
}

const DEFAULT_INHERIT_CONST: InheritConstants = {
    inheritBornStatPoint: 1_000,
    inheritItemRandomPoint: 3_000,
    inheritBuffPoints: [0, 200, 600, 1_200, 2_000, 3_000],
    inheritSpecificSpecialPoint: 4_000,
    inheritResetAttrPointBase: [1_000, 1_000, 2_000, 3_000],
    inheritCheckOwnerPoint: 1_000,
};

const BUFF_LABELS: Record<InheritBuffType, string> = {
    warAvoidRatio: '회피 확률 증가',
    warCriticalRatio: '필살 확률 증가',
    warMagicTrialProb: '전투계략 시도 확률 증가',
    domesticSuccessProb: '내정 성공률 증가',
    domesticFailProb: '내정 실패율 감소',
    warAvoidRatioOppose: '상대 회피 확률 감소',
    warCriticalRatioOppose: '상대 필살 확률 감소',
    warMagicTrialProbOppose: '상대 전투계략 시도 확률 감소',
};

const SYSTEM_TARGET: MessageTarget = {
    generalId: 0,
    generalName: '',
    nationId: 0,
    nationName: 'System',
    color: '#000000',
    icon: '',
};

const asJson = (value: unknown): GamePrisma.InputJsonValue => value as GamePrisma.InputJsonValue;

const resolveNumberArray = (value: unknown, fallback: number[]): number[] => {
    if (!Array.isArray(value)) return [...fallback];
    const result = value
        .map((entry) => (typeof entry === 'number' && Number.isFinite(entry) ? entry : null))
        .filter((entry): entry is number => entry !== null);
    return result.length > 0 ? result : [...fallback];
};

const resolveInheritConstants = (world: InMemoryTurnWorld): InheritConstants => {
    const configConst = asRecord(world.getScenarioConfig().const);
    return {
        inheritBornStatPoint: asNumber(configConst.inheritBornStatPoint, DEFAULT_INHERIT_CONST.inheritBornStatPoint),
        inheritItemRandomPoint: asNumber(
            configConst.inheritItemRandomPoint,
            DEFAULT_INHERIT_CONST.inheritItemRandomPoint
        ),
        inheritBuffPoints: resolveNumberArray(configConst.inheritBuffPoints, DEFAULT_INHERIT_CONST.inheritBuffPoints),
        inheritSpecificSpecialPoint: asNumber(
            configConst.inheritSpecificSpecialPoint,
            DEFAULT_INHERIT_CONST.inheritSpecificSpecialPoint
        ),
        inheritResetAttrPointBase: resolveNumberArray(
            configConst.inheritResetAttrPointBase,
            DEFAULT_INHERIT_CONST.inheritResetAttrPointBase
        ),
        inheritCheckOwnerPoint: asNumber(
            configConst.inheritCheckOwnerPoint,
            DEFAULT_INHERIT_CONST.inheritCheckOwnerPoint
        ),
    };
};

const buildResetCost = (baseCosts: number[], level: number): number => {
    const costs = [...baseCosts];
    while (costs.length <= level) {
        const size = costs.length;
        costs.push((costs[size - 1] ?? 0) + (costs[size - 2] ?? 0));
    }
    return costs[level] ?? 0;
};

const readBuffRecord = (raw: unknown): Record<string, number> => {
    const source = typeof raw === 'string' ? (parseJson<Record<string, unknown>>(raw) ?? {}) : asRecord(raw);
    return Object.fromEntries(
        Object.entries(source).filter((entry): entry is [string, number] => {
            const value = entry[1];
            return typeof value === 'number' && Number.isFinite(value);
        })
    );
};

const readBuffLevel = (buff: Record<string, number>, key: InheritBuffType): number => {
    const compatibilityKey = key === 'domesticSuccessProb' ? 'success' : key === 'domesticFailProb' ? 'fail' : null;
    return Math.max(0, Math.min(5, Math.floor(buff[key] ?? (compatibilityKey ? buff[compatibilityKey] : 0) ?? 0)));
};

const readStringList = (raw: unknown): string[] => {
    const value = typeof raw === 'string' ? parseJson<unknown>(raw) : raw;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
};

const readMetaNumber = (meta: Record<string, unknown>, key: string, fallback: number): number => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
    return fallback;
};

const resolveSeasonValue = (meta: Record<string, unknown>): number | null => {
    const value = meta.season;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
    return null;
};

const readResetSeasons = (meta: Record<string, unknown>): number[] =>
    Array.isArray(meta.last_stat_reset)
        ? meta.last_stat_reset
              .map((value) => (typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null))
              .filter((value): value is number => value !== null)
        : [];

export const buildResetStatRandomBonus = (
    rng: RandUtil,
    baseStats: [number, number, number]
): [number, number, number] => {
    const bonusCount = rng.nextRangeInt(3, 5);
    const bonus = [0, 0, 0] as [number, number, number];
    for (let index = 0; index < bonusCount; index += 1) {
        const selected = Number(
            rng.choiceUsingWeight({
                0: baseStats[0],
                1: baseStats[1],
                2: baseStats[2],
            })
        ) as 0 | 1 | 2;
        bonus[selected] += 1;
    }
    return bonus;
};

const formatTurnTimeBaseLabel = (value: number): string => {
    const wholeSeconds = Math.trunc(value);
    const hours = String(Math.trunc(wholeSeconds / 3_600)).padStart(2, '0');
    const minutes = String(Math.trunc((wholeSeconds % 3_600) / 60)).padStart(2, '0');
    return `${hours}:${minutes}`;
};

const resolveResetTurnTimeBase = (options: {
    hiddenSeed: string | number;
    userId: string;
    previousTurnTimeBase: string | number;
    tickSeconds: number;
}): { nextTurnTimeBase: number; nextTurnTimeLabel: string } => {
    const rng = new LiteHashDRBG(
        simpleSerialize(options.hiddenSeed, 'ResetTurnTime', options.userId, options.previousTurnTimeBase)
    );
    const nextTurnTimeBase = rng.nextFloat1() * Math.max(60, options.tickSeconds);
    return { nextTurnTimeBase, nextTurnTimeLabel: formatTurnTimeBaseLabel(nextTurnTimeBase) };
};

const reject = (
    action: TurnDaemonInheritanceAction['action'],
    code: Extract<InheritanceActionResult, { ok: false }>['code'],
    reason: string
): InheritanceActionResult => ({ type: 'inheritanceAction', ok: false, action, code, reason });

const lockPreviousPoint = async (db: GamePrisma.TransactionClient, userId: string): Promise<number> => {
    const rows = await db.$queryRaw<Array<{ value: number }>>(GamePrisma.sql`
        SELECT value
        FROM inheritance_point
        WHERE user_id = ${userId} AND key = 'previous'
        FOR UPDATE
    `);
    return rows[0]?.value ?? 0;
};

const appendInheritanceLog = async (
    db: GamePrisma.TransactionClient,
    userId: string,
    year: number,
    month: number,
    text: string
): Promise<void> => {
    await db.inheritanceLog.create({ data: { userId, year, month, text } });
};

const buildMessageTarget = (world: InMemoryTurnWorld, general: TurnGeneral): MessageTarget => {
    const nation = general.nationId > 0 ? world.getNationById(general.nationId) : null;
    return {
        generalId: general.id,
        generalName: general.name,
        nationId: general.nationId,
        nationName: nation?.name ?? '재야',
        color: nation?.color ?? '#000000',
        icon: resolveMessageTargetIcon(general),
    };
};

const queueOwnerLookupMessages = (
    world: InMemoryTurnWorld,
    actor: TurnGeneral,
    target: TurnGeneral,
    ownerName: string,
    gameNow: Date
): void => {
    const validUntil = new Date('9999-12-31T00:00:00.000Z');
    const messages: MessageDraft[] = [
        {
            msgType: 'private',
            src: SYSTEM_TARGET,
            dest: buildMessageTarget(world, actor),
            text: `${target.name}의 소유자는 ${ownerName} 입니다.`,
            time: gameNow,
            validUntil,
            option: {},
            sendDestOnly: true,
        },
        {
            msgType: 'private',
            src: SYSTEM_TARGET,
            dest: buildMessageTarget(world, target),
            text: '소유자명이 누군가에 의해 확인되었습니다.',
            time: gameNow,
            validUntil,
            option: {},
            sendDestOnly: true,
        },
    ];
    for (const message of messages) world.queueMessage(message);
};

const applyCharge = (options: {
    world: InMemoryTurnWorld;
    general: TurnGeneral;
    userId: string;
    previousPoint: number;
    cost: number;
    patch: Partial<TurnGeneral>;
}): TurnGeneral => {
    const { world, general, userId, previousPoint, cost, patch } = options;
    const patchMeta = patch.meta ? asRecord(patch.meta) : general.meta;
    const spentKey = rankDataMetaKey('inherit_spent_dyn');
    const nextMeta = {
        ...patchMeta,
        [spentKey]: readMetaNumber(general.meta, spentKey, 0) + cost,
    } as TurnGeneral['meta'];
    const next = world.updateGeneral(general.id, {
        ...patch,
        meta: nextMeta,
        inheritancePoints: {
            ...general.inheritancePoints,
            previous: previousPoint - cost,
        },
    });
    if (!next) throw new Error(`Inheritance action general ${general.id} disappeared during mutation.`);
    world.queueInheritancePointAdjustment(userId, 'previous', -cost);
    return next;
};

const isUnited = (world: InMemoryTurnWorld): boolean => {
    const meta = asRecord(world.getState().meta);
    return asNumber(meta.isunited, 0) !== 0 || asNumber(meta.isUnited, 0) !== 0;
};

export const resolveOwnerDisplayName = (rawMeta: unknown): string => {
    const meta = asRecord(rawMeta);
    for (const key of ['ownerDisplayName', 'owner_name', 'ownerName']) {
        const value = meta[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return '알수없음';
};

const executeInheritanceActionMutation = async (options: {
    db: GamePrisma.TransactionClient;
    world: InMemoryTurnWorld;
    command: InheritanceActionCommand;
    gameNow: Date;
}): Promise<InheritanceActionResult> => {
    const { db, world, command, gameNow } = options;
    const { input, userId } = command;
    const action = input.action;
    const general = world.listGenerals().find((candidate) => candidate.userId === userId);
    if (!general) return reject(action, 'PRECONDITION_FAILED', '장수가 존재하지 않습니다.');

    const state = world.getState();
    const worldMeta = asRecord(state.meta);
    const config = world.getScenarioConfig();
    const configRecord = asRecord(config);
    const constants = resolveInheritConstants(world);

    if (action === 'checkOwner') {
        if (input.targetGeneralId === general.id) {
            return reject(action, 'BAD_REQUEST', '자신의 정보는 확인할 수 없습니다.');
        }
        const target = world.getGeneralById(input.targetGeneralId);
        if (!target) return reject(action, 'BAD_REQUEST', '대상 장수가 존재하지 않습니다.');
        if (!target.userId) return reject(action, 'BAD_REQUEST', '대상 장수는 NPC입니다.');
        if (isUnited(world)) return reject(action, 'FORBIDDEN', '이미 천하가 통일되었습니다.');
        const previousPoint = await lockPreviousPoint(db, userId);
        const cost = constants.inheritCheckOwnerPoint;
        if (previousPoint < cost) return reject(action, 'BAD_REQUEST', '충분한 유산 포인트를 가지고 있지 않습니다.');
        const ownerName = resolveOwnerDisplayName(target.meta);

        await appendInheritanceLog(
            db,
            userId,
            state.currentYear,
            state.currentMonth,
            `${cost} 포인트로 장수 소유자 확인`
        );
        queueOwnerLookupMessages(world, general, target, ownerName, gameNow);
        applyCharge({ world, general, userId, previousPoint, cost, patch: {} });
        return {
            type: 'inheritanceAction',
            ok: true,
            action,
            generalId: general.id,
            remainPoint: previousPoint - cost,
            ownerName,
            targetName: target.name,
        };
    }

    if (action === 'buyHiddenBuff') {
        const buff = readBuffRecord(general.meta.inheritBuff);
        const previousLevel = readBuffLevel(buff, input.buffType);
        if (input.level === previousLevel) return reject(action, 'BAD_REQUEST', '이미 구입했습니다.');
        if (input.level < previousLevel) return reject(action, 'BAD_REQUEST', '이미 더 높은 등급을 구입했습니다.');
        if (isUnited(world)) return reject(action, 'FORBIDDEN', '이미 천하가 통일되었습니다.');
        const cost =
            (constants.inheritBuffPoints[input.level] ?? 0) - (constants.inheritBuffPoints[previousLevel] ?? 0);
        const previousPoint = await lockPreviousPoint(db, userId);
        if (previousPoint < cost) return reject(action, 'BAD_REQUEST', '충분한 유산 포인트를 가지고 있지 않습니다.');
        const moreText = previousLevel > 0 ? '추가' : '';
        buff[input.buffType] = input.level;
        await appendInheritanceLog(
            db,
            userId,
            state.currentYear,
            state.currentMonth,
            `${cost} 포인트로 ${BUFF_LABELS[input.buffType]} ${input.level} 단계 ${moreText}구입`
        );
        applyCharge({
            world,
            general,
            userId,
            previousPoint,
            cost,
            patch: { meta: { ...general.meta, inheritBuff: JSON.stringify(buff) } },
        });
        return {
            type: 'inheritanceAction',
            ok: true,
            action,
            generalId: general.id,
            remainPoint: previousPoint - cost,
        };
    }

    if (action === 'setNextSpecialWar') {
        if (!isWarTraitKey(input.specialKey)) return reject(action, 'BAD_REQUEST', '잘못된 전투 특기입니다.');
        const configConst = asRecord(config.const);
        const allowed = Array.isArray(configConst.availableSpecialWar)
            ? configConst.availableSpecialWar.filter((key): key is string => typeof key === 'string')
            : [];
        if (allowed.length > 0 && !allowed.includes(input.specialKey)) {
            return reject(action, 'BAD_REQUEST', '허용되지 않은 전투 특기입니다.');
        }
        if (general.role.specialWar === input.specialKey) {
            return reject(action, 'BAD_REQUEST', '이미 그 특기를 보유하고 있습니다.');
        }
        const reserved =
            typeof general.meta.inheritSpecificSpecialWar === 'string' ? general.meta.inheritSpecificSpecialWar : null;
        if (reserved === input.specialKey) return reject(action, 'BAD_REQUEST', '이미 그 특기를 예약하였습니다.');
        if (reserved) return reject(action, 'BAD_REQUEST', '이미 예약한 특기가 있습니다.');
        if (isUnited(world)) return reject(action, 'FORBIDDEN', '이미 천하가 통일되었습니다.');
        const cost = constants.inheritSpecificSpecialPoint;
        const previousPoint = await lockPreviousPoint(db, userId);
        if (previousPoint < cost) return reject(action, 'BAD_REQUEST', '충분한 유산 포인트를 가지고 있지 않습니다.');
        const [warModule] = await loadWarTraitModules([input.specialKey], new WarTraitLoader());
        const warName = warModule?.name ?? input.specialKey;
        await appendInheritanceLog(
            db,
            userId,
            state.currentYear,
            state.currentMonth,
            `${cost} 포인트로 다음 전투 특기로 ${warName} 지정`
        );
        applyCharge({
            world,
            general,
            userId,
            previousPoint,
            cost,
            patch: { meta: { ...general.meta, inheritSpecificSpecialWar: input.specialKey } },
        });
        return {
            type: 'inheritanceAction',
            ok: true,
            action,
            generalId: general.id,
            remainPoint: previousPoint - cost,
        };
    }

    if (action === 'resetSpecialWar') {
        const currentSpecial = general.role.specialWar;
        if (!currentSpecial || currentSpecial === 'None') {
            return reject(action, 'BAD_REQUEST', '이미 전투 특기가 공란입니다.');
        }
        if (isUnited(world)) return reject(action, 'FORBIDDEN', '이미 천하가 통일되었습니다.');
        const currentLevel = readMetaNumber(general.meta, 'inheritResetSpecialWar', -1);
        const nextLevel = currentLevel + 1;
        const cost = buildResetCost(constants.inheritResetAttrPointBase, nextLevel);
        const previousPoint = await lockPreviousPoint(db, userId);
        if (previousPoint < cost) return reject(action, 'BAD_REQUEST', '충분한 유산 포인트를 가지고 있지 않습니다.');
        const previousTypes = readStringList(general.meta.prev_types_special2);
        previousTypes.push(currentSpecial);
        await appendInheritanceLog(
            db,
            userId,
            state.currentYear,
            state.currentMonth,
            `${cost} 포인트로 전투 특기 초기화`
        );
        applyCharge({
            world,
            general,
            userId,
            previousPoint,
            cost,
            patch: {
                role: { ...general.role, specialWar: null },
                meta: {
                    ...general.meta,
                    inheritResetSpecialWar: nextLevel,
                    prev_types_special2: previousTypes,
                },
            },
        });
        return {
            type: 'inheritanceAction',
            ok: true,
            action,
            generalId: general.id,
            remainPoint: previousPoint - cost,
        };
    }

    if (action === 'resetTurnTime') {
        if (isUnited(world)) return reject(action, 'FORBIDDEN', '이미 천하가 통일되었습니다.');
        const currentLevel = readMetaNumber(general.meta, 'inheritResetTurnTime', -1);
        const nextLevel = currentLevel + 1;
        const cost = buildResetCost(constants.inheritResetAttrPointBase, nextLevel);
        const previousPoint = await lockPreviousPoint(db, userId);
        if (previousPoint < cost) return reject(action, 'BAD_REQUEST', '충분한 유산 포인트를 가지고 있지 않습니다.');
        const rawSeedTurnTime = general.meta.nextTurnTimeBase ?? general.turnTick ?? 0;
        const seedTurnTime =
            typeof rawSeedTurnTime === 'string' || typeof rawSeedTurnTime === 'number'
                ? rawSeedTurnTime
                : typeof rawSeedTurnTime === 'bigint'
                  ? Number(rawSeedTurnTime)
                  : 0;
        const hiddenSeed =
            typeof worldMeta.hiddenSeed === 'string' || typeof worldMeta.hiddenSeed === 'number'
                ? worldMeta.hiddenSeed
                : 'inherit';
        const timing = resolveResetTurnTimeBase({
            hiddenSeed,
            userId,
            previousTurnTimeBase: seedTurnTime,
            tickSeconds: state.tickSeconds,
        });
        await appendInheritanceLog(
            db,
            userId,
            state.currentYear,
            state.currentMonth,
            `${cost} 포인트로 턴 시간을 바꾸어 다다음 턴부터 ${timing.nextTurnTimeLabel} 적용`
        );
        applyCharge({
            world,
            general,
            userId,
            previousPoint,
            cost,
            patch: {
                meta: {
                    ...general.meta,
                    inheritResetTurnTime: nextLevel,
                    nextTurnTimeBase: timing.nextTurnTimeBase,
                },
            },
        });
        return {
            type: 'inheritanceAction',
            ok: true,
            action,
            generalId: general.id,
            remainPoint: previousPoint - cost,
            ...timing,
        };
    }

    if (action === 'resetStat') {
        const statConfig = asRecord(configRecord.stat);
        const statTotal = asNumber(statConfig.total, input.leadership + input.strength + input.intel);
        const statMin = asNumber(statConfig.min, 1);
        const statMax = asNumber(statConfig.max, 999);
        if (input.leadership + input.strength + input.intel !== statTotal) {
            return reject(action, 'BAD_REQUEST', `능력치 총합이 ${statTotal}이 아닙니다. 다시 입력해주세요!`);
        }
        if (
            input.leadership < statMin ||
            input.strength < statMin ||
            input.intel < statMin ||
            input.leadership > statMax ||
            input.strength > statMax ||
            input.intel > statMax
        ) {
            return reject(action, 'BAD_REQUEST', '능력치 범위를 벗어났습니다.');
        }
        const bonus = input.inheritBonusStat ?? [0, 0, 0];
        const bonusSum = bonus.reduce((sum, value) => sum + value, 0);
        if (bonus.some((value) => value < 0)) {
            return reject(action, 'BAD_REQUEST', '보너스 능력치가 음수입니다. 다시 입력해주세요!');
        }
        if (bonusSum !== 0 && (bonusSum < 3 || bonusSum > 5)) {
            return reject(action, 'BAD_REQUEST', '보너스 능력치 합이 잘못 지정되었습니다. 다시 입력해주세요!');
        }
        if (general.npcState !== 0) return reject(action, 'BAD_REQUEST', 'NPC는 능력치 초기화를 할 수 없습니다.');
        if (!isCentennialStatResetAllowed(config)) {
            return reject(action, 'BAD_REQUEST', '100기 올스타 장수는 능력치 초기화를 사용할 수 없습니다.');
        }
        if (isUnited(world)) return reject(action, 'FORBIDDEN', '이미 천하가 통일되었습니다.');
        const cost = bonusSum > 0 ? constants.inheritBornStatPoint : 0;
        const season = resolveSeasonValue(worldMeta);
        const userStateRow =
            season === null
                ? null
                : await db.inheritanceUserState.findUnique({ where: { userId }, select: { meta: true } });
        const userState = asRecord(userStateRow?.meta);
        const resetSeasons = readResetSeasons(userState);
        if (season !== null && resetSeasons.includes(season)) {
            return reject(action, 'BAD_REQUEST', '이번 시즌에 이미 능력치를 초기화하셨습니다.');
        }
        const previousPoint = await lockPreviousPoint(db, userId);
        if (previousPoint < cost) return reject(action, 'BAD_REQUEST', '충분한 유산 포인트를 가지고 있지 않습니다.');
        const statHiddenSeed =
            typeof worldMeta.hiddenSeed === 'string' || typeof worldMeta.hiddenSeed === 'number'
                ? worldMeta.hiddenSeed
                : 'inherit';
        const baseStats = [input.leadership, input.strength, input.intel] as [number, number, number];
        const finalBonus =
            bonusSum === 0
                ? buildResetStatRandomBonus(
                      new RandUtil(new LiteHashDRBG(simpleSerialize(statHiddenSeed, 'ResetStat', userId))),
                      baseStats
                  )
                : (bonus as [number, number, number]);
        const nextStats = {
            leadership: input.leadership + finalBonus[0],
            strength: input.strength + finalBonus[1],
            intel: input.intel + finalBonus[2],
        };
        await appendInheritanceLog(
            db,
            userId,
            state.currentYear,
            state.currentMonth,
            `통솔 ${input.leadership}, 무력 ${input.strength}, 지력 ${input.intel} 스탯 재설정`
        );
        await appendInheritanceLog(
            db,
            userId,
            state.currentYear,
            state.currentMonth,
            bonusSum > 0
                ? `${cost}로 통솔 ${finalBonus[0]}, 무력 ${finalBonus[1]}, 지력 ${finalBonus[2]} 보너스 능력치 적용`
                : `통솔 ${finalBonus[0]}, 무력 ${finalBonus[1]}, 지력 ${finalBonus[2]} 보너스 능력치 적용`
        );
        if (season !== null) {
            await db.inheritanceUserState.upsert({
                where: { userId },
                update: { meta: asJson({ ...userState, last_stat_reset: [...resetSeasons, season] }) },
                create: { userId, meta: asJson({ ...userState, last_stat_reset: [...resetSeasons, season] }) },
            });
        }
        applyCharge({
            world,
            general,
            userId,
            previousPoint,
            cost,
            patch: {
                stats: {
                    leadership: nextStats.leadership,
                    strength: nextStats.strength,
                    intelligence: nextStats.intel,
                },
            },
        });
        return {
            type: 'inheritanceAction',
            ok: true,
            action,
            generalId: general.id,
            remainPoint: previousPoint - cost,
            stats: nextStats,
        };
    }

    if (general.meta.inheritRandomUnique !== undefined && general.meta.inheritRandomUnique !== null) {
        return reject(action, 'BAD_REQUEST', '이미 구입 명령을 내렸습니다. 다음 턴까지 기다려주세요.');
    }
    if (isUnited(world)) return reject(action, 'FORBIDDEN', '이미 천하가 통일되었습니다.');
    const previousPoint = await lockPreviousPoint(db, userId);
    const cost = constants.inheritItemRandomPoint;
    if (previousPoint < cost) return reject(action, 'BAD_REQUEST', '충분한 유산 포인트를 가지고 있지 않습니다.');
    await appendInheritanceLog(db, userId, state.currentYear, state.currentMonth, `${cost} 포인트로 랜덤 유니크 구입`);
    applyCharge({
        world,
        general,
        userId,
        previousPoint,
        cost,
        patch: { meta: { ...general.meta, inheritRandomUnique: 1 } },
    });
    return { type: 'inheritanceAction', ok: true, action, generalId: general.id, remainPoint: previousPoint - cost };
};

/**
 * Persists the WALL_TIME inheritance receipt in the same transaction as the
 * point debit, game mutation, and input-event completion. The input_event row
 * is the durable retry/failure record and owns the authoritative GAME clock
 * coordinate; an immediate effect does not invent a separate applied tick.
 */
export const executeInheritanceAction = async (options: {
    db: GamePrisma.TransactionClient;
    world: InMemoryTurnWorld;
    command: InheritanceActionCommand;
    gameNow: Date;
}): Promise<InheritanceActionResult> => {
    const result = await executeInheritanceActionMutation(options);
    if (!result.ok || !options.command.requestId) return result;

    const event = await options.db.inputEvent.findUnique({
        where: { requestId: options.command.requestId },
        select: {
            actorUserId: true,
            target: true,
            eventType: true,
            createdAt: true,
            processingClockRevision: true,
            processingDeadlineGeneration: true,
        },
    });
    if (
        !event ||
        event.actorUserId !== options.command.userId ||
        event.target !== 'ENGINE' ||
        event.eventType !== 'inheritanceAction' ||
        event.processingClockRevision === null ||
        event.processingDeadlineGeneration === null
    ) {
        throw new Error('Inheritance ledger requires the authoritative ENGINE input-event clock fence.');
    }
    const previousPoint = await lockPreviousPoint(options.db, options.command.userId);
    const cost = previousPoint - result.remainPoint;
    if (!Number.isFinite(cost) || cost < 0) {
        throw new Error(`Inheritance ledger calculated an invalid cost: ${cost}.`);
    }
    await options.db.inheritanceLedger.create({
        data: {
            requestId: options.command.requestId,
            userId: options.command.userId,
            action: result.action,
            cost,
            status: 'APPLIED',
            requestedAtWall: event.createdAt,
            appliedClockRevision: event.processingClockRevision,
            appliedDeadlineGeneration: event.processingDeadlineGeneration,
        },
    });
    return result;
};
