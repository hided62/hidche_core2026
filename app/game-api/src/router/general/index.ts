import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { LogCategory, LogScope } from '@sammo-ts/logic';
import { asRecord } from '@sammo-ts/common';

import type { GameApiContext } from '../../context.js';
import {
    accessEngineAuthedProcedure,
    accessEngineAuthedInputProcedure,
    authedProcedure,
    deferredAccessLimitAuthedProcedure,
    engineAuthedProcedure,
    router,
} from '../../trpc.js';
import { ConflictingTurnDaemonCommandError } from '../../daemon/databaseTransport.js';
import { resolveAccessWindows } from '../../services/generalAccess.js';
import { adjustAccountIconForUser } from '../../services/accountIconSync.js';
import {
    loadCrewTypeDisplayNames,
    loadItemDisplayNames,
    resolveCityLevelName,
    resolveDedicationLevelName,
    resolveNationLevelName,
    resolveOfficerLevelName,
    resolveRegionName,
    sanitizeInternalDisplayCode,
} from '../../services/gameDisplayNames.js';
import { getMyGeneral } from '../shared/general.js';
import {
    loadTraitNames,
    resolveNationBill,
    resolveNationBlockScout,
    resolveNationBlockWar,
    resolveNationNotice,
    resolveNationRate,
    type TraitNameMap,
} from '../nation/shared.js';
import {
    resolveImpossibleStrategicCommands,
    resolveMainNationTech,
    splitNationTraitInfo,
} from '../../services/mainNationProjection.js';
import {
    resolveGeneralTypeCall,
    resolveLeadershipBonus,
    resolveRefreshScoreText,
    resolveRemainingMinutes,
} from '../../services/generalBasicCardProjection.js';

const zGeneralSettings = z.object({
    tnmt: z.number().int().optional(),
    defence_train: z.number().int().optional(),
    use_treatment: z.number().int().optional(),
    use_auto_nation_turn: z.number().int().optional(),
});

const zGeneralLogType = z.enum(['generalHistory', 'battleDetail', 'battleResult', 'generalAction']);
const zImmediateActionInput = z
    .object({
        clientRequestId: z.string().uuid().optional(),
    })
    .optional();
const MAIN_RECORD_LIMIT = 15;
const NEUTRAL_NATION_CONTEXT = {
    id: 0,
    name: '재야',
    color: '#000000',
    level: 0,
    gold: 0,
    rice: 0,
    tech: 0,
    typeCode: 'None',
    capitalCityId: null,
    meta: {},
} as const;

const resolveImmediateActionRequestId = (
    contextRequestId: string | undefined,
    userId: string,
    clientRequestId: string | undefined,
    action: 'buildNationCandidate' | 'dieOnPrestart' | 'instantRetreat'
): string | undefined => {
    if (clientRequestId) {
        return `general:${action}:${userId}:${clientRequestId}`;
    }
    return contextRequestId ? `${contextRequestId}:general.${action}` : undefined;
};

const requestImmediateAction = async (
    ctx: GameApiContext,
    input: { clientRequestId?: string } | undefined,
    action: 'buildNationCandidate' | 'dieOnPrestart' | 'instantRetreat'
): Promise<{ ok: true }> => {
    const userId = ctx.auth?.user.id;
    if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const general =
        action === 'dieOnPrestart'
            ? await ctx.db.general.findFirst({ where: { userId, npcState: 0 } })
            : await getMyGeneral(ctx);
    if (!general) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '장수가 없습니다' });
    }
    const requestId = resolveImmediateActionRequestId(ctx.requestId, userId, input?.clientRequestId, action);
    try {
        const result = await ctx.turnDaemon.requestCommand({
            type: action,
            ...(requestId ? { requestId } : {}),
            userId,
            generalId: general.id,
        });
        if (!result) {
            throw new TRPCError({
                code: 'TIMEOUT',
                message: '요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
            });
        }
        if (result.type !== action) {
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: '턴 데몬이 올바르지 않은 즉시 행동 결과를 반환했습니다.',
            });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        if (action === 'dieOnPrestart' && ctx.accessToken) {
            await ctx.accessTokenStore.revoke(ctx.accessToken);
        }
        return { ok: true };
    } catch (error) {
        if (
            error instanceof ConflictingTurnDaemonCommandError ||
            (error instanceof Error && error.name === 'ConflictingTurnDaemonCommandError')
        ) {
            throw new TRPCError({
                code: 'CONFLICT',
                message: '이미 접수된 즉시 행동 요청과 입력이 다릅니다. 새 요청 번호로 다시 시도해 주세요.',
            });
        }
        throw error;
    }
};

const trimRecentRecords = <Entry extends { id: number }>(entries: Entry[], cursor: number): Entry[] => {
    if (entries.length === 0) {
        return entries;
    }
    const result = [...entries];
    if (result.at(-1)?.id === cursor || result.length > MAIN_RECORD_LIMIT) {
        result.pop();
    }
    return result;
};

const readNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const normalizeItemCode = (value: string | null): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

const resolveTraitDisplayName = (code: string, names: TraitNameMap): string => {
    if (!code || code === 'None') {
        return '-';
    }
    const loadedName = names.get(code)?.name;
    if (loadedName) {
        return loadedName;
    }
    // Ref는 class getName()을 표시하므로 로더가 모르는 선택적 특기도 raw namespace는 노출하지 않는다.
    return sanitizeInternalDisplayCode(code);
};

const resolveUserSettings = (meta: Record<string, unknown>) => {
    // The legacy general columns are persisted at the top level of General.meta.
    // Keep reading the short-lived nested shape for installations that ran the
    // initial rewrite implementation before this compatibility fix.
    const nestedSettings = asRecord(meta.userSettings);
    const readSetting = (key: string): unknown => meta[key] ?? nestedSettings[key];
    const mysetRaw = readSetting('myset');
    const myset = typeof mysetRaw === 'number' && Number.isFinite(mysetRaw) ? mysetRaw : null;

    return {
        tnmt: readNumber(readSetting('tnmt'), 1),
        defence_train: readNumber(readSetting('defence_train'), 80),
        use_treatment: readNumber(readSetting('use_treatment'), 10),
        use_auto_nation_turn: readNumber(readSetting('use_auto_nation_turn'), 1),
        myset,
    };
};

const resolvePenalty = (penalty: unknown): Record<string, number> => {
    const penaltyRecord = asRecord(penalty);
    const result: Record<string, number> = {};

    for (const [key, value] of Object.entries(penaltyRecord)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            result[key] = value;
            continue;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                result[key] = parsed;
            }
        }
    }

    return result;
};

export const getGeneralContext = async (ctx: GameApiContext) => {
    const userId = ctx.auth?.user.id;
    if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    const general = await ctx.db.general.findFirst({
        where: { userId },
        select: {
            id: true,
            name: true,
            npcState: true,
            nationId: true,
            cityId: true,
            troopId: true,
            picture: true,
            imageServer: true,
            leadership: true,
            strength: true,
            intel: true,
            officerLevel: true,
            gold: true,
            rice: true,
            crew: true,
            train: true,
            atmos: true,
            injury: true,
            experience: true,
            dedication: true,
            age: true,
            turnTime: true,
            crewTypeId: true,
            personalCode: true,
            specialCode: true,
            special2Code: true,
            weaponCode: true,
            horseCode: true,
            bookCode: true,
            itemCode: true,
            meta: true,
            penalty: true,
        },
    });

    if (!general) {
        return null;
    }

    const metaRecord = asRecord(general.meta);
    const officerCityId = readNumber(metaRecord.officerCity ?? metaRecord.officer_city ?? metaRecord.officerCityId, 0);
    const [city, queriedNation, worldState, officerCity, troop, troopLeader, troopLeaderFirstTurn, accessLog] =
        await Promise.all([
            general.cityId > 0
                ? ctx.db.city.findUnique({
                      where: { id: general.cityId },
                      select: {
                          id: true,
                          name: true,
                          level: true,
                          nationId: true,
                          population: true,
                          populationMax: true,
                          agriculture: true,
                          agricultureMax: true,
                          commerce: true,
                          commerceMax: true,
                          security: true,
                          securityMax: true,
                          trust: true,
                          trade: true,
                          defence: true,
                          defenceMax: true,
                          wall: true,
                          wallMax: true,
                          region: true,
                          supplyState: true,
                          frontState: true,
                      },
                  })
                : null,
            general.nationId > 0
                ? ctx.db.nation.findUnique({
                      where: { id: general.nationId },
                      select: {
                          id: true,
                          name: true,
                          color: true,
                          level: true,
                          gold: true,
                          rice: true,
                          tech: true,
                          typeCode: true,
                          capitalCityId: true,
                          meta: true,
                      },
                  })
                : Promise.resolve(NEUTRAL_NATION_CONTEXT),
            ctx.db.worldState.findFirst({
                select: { currentYear: true, currentMonth: true, tickSeconds: true, config: true, meta: true },
            }),
            officerCityId > 0
                ? ctx.db.city.findUnique({ where: { id: officerCityId }, select: { name: true } })
                : Promise.resolve(null),
            general.troopId > 0
                ? ctx.db.troop.findUnique({ where: { troopLeaderId: general.troopId }, select: { name: true } })
                : Promise.resolve(null),
            general.troopId > 0
                ? ctx.db.general.findUnique({ where: { id: general.troopId }, select: { cityId: true } })
                : Promise.resolve(null),
            general.troopId > 0
                ? ctx.db.generalTurn.findFirst({
                      where: { generalId: general.troopId },
                      orderBy: { turnIdx: 'asc' },
                      select: { actionCode: true },
                  })
                : Promise.resolve(null),
            ctx.db.generalAccessLog.findUnique({
                where: { generalId: general.id },
                select: { refreshScore: true, refreshScoreTotal: true },
            }),
        ]);
    const nation = queriedNation ?? NEUTRAL_NATION_CONTEXT;

    const [capitalCity, cityNation, troopLeaderCity, nationPopulation, nationCrew, topChiefRows] = await Promise.all([
        nation.capitalCityId
            ? ctx.db.city.findUnique({ where: { id: nation.capitalCityId }, select: { name: true } })
            : Promise.resolve(null),
        city && city.nationId > 0
            ? ctx.db.nation.findUnique({ where: { id: city.nationId }, select: { name: true } })
            : Promise.resolve(null),
        troopLeader && troopLeader.cityId > 0
            ? ctx.db.city.findUnique({ where: { id: troopLeader.cityId }, select: { name: true } })
            : Promise.resolve(null),
        nation.id > 0
            ? ctx.db.city.aggregate({
                  where: { nationId: nation.id },
                  _count: true,
                  _sum: { population: true, populationMax: true },
              })
            : Promise.resolve({ _count: 0, _sum: { population: 0, populationMax: 0 } }),
        nation.id > 0
            ? ctx.db.general.aggregate({
                  where: { nationId: nation.id, npcState: { not: 5 } },
                  _count: true,
                  _sum: { crew: true, leadership: true },
              })
            : Promise.resolve({ _count: 0, _sum: { crew: 0, leadership: 0 } }),
        nation.id > 0
            ? ctx.db.general.findMany({
                  where: { nationId: nation.id, officerLevel: { gte: 11 } },
                  select: { id: true, name: true, npcState: true, officerLevel: true },
                  orderBy: { id: 'asc' },
              })
            : Promise.resolve([]),
    ]);
    const [personalityNames, domesticNames, warNames, nationTypeNames, crewTypeNames, itemNames] = await Promise.all([
        loadTraitNames([general.personalCode], 'personality'),
        loadTraitNames([general.specialCode], 'domestic'),
        loadTraitNames([general.special2Code], 'war'),
        loadTraitNames([nation.typeCode], 'nation'),
        loadCrewTypeDisplayNames(worldState, ctx.profile.id),
        loadItemDisplayNames([general.horseCode, general.weaponCode, general.bookCode, general.itemCode]),
    ]);

    const worldConfig = asRecord(worldState?.config);
    const constValues = asRecord(worldConfig.const ?? worldConfig.consts);
    const scenarioStat = asRecord(worldConfig.stat);
    const chiefStatMin = readNumber(scenarioStat.chiefMin, 70);
    const statGradeLevel = readNumber(constValues.statGradeLevel, 5);
    const retirementYear = readNumber(constValues.retirementYear, 70);
    const maxDedicationLevel = readNumber(constValues.maxDedLevel, 30);
    const settings = resolveUserSettings(metaRecord);
    const penalties = resolvePenalty(general.penalty);
    const dedicationLevel = readNumber(metaRecord.dedlevel, 0);
    const nationMeta = asRecord(nation.meta);
    const nationType = nationTypeNames.get(nation.typeCode);
    const nationTypeEffects = splitNationTraitInfo(nationType?.info ?? '');
    const nationTech = resolveMainNationTech({
        tech: nation.tech,
        currentYear: worldState?.currentYear ?? 0,
        worldConfig: worldState?.config,
        worldMeta: worldState?.meta,
    });
    const topChiefs = Object.fromEntries(
        topChiefRows.map((chief) => [chief.officerLevel, { id: chief.id, name: chief.name, npcState: chief.npcState }])
    );
    const itemName = (code: string | null): string | null => {
        const normalized = normalizeItemCode(code);
        return normalized ? (itemNames.get(normalized) ?? sanitizeInternalDisplayCode(normalized)) : null;
    };
    const worldMeta = asRecord(worldState?.meta);
    const rawLastExecuted = worldMeta.lastTurnTime ?? worldMeta.turntime;
    const parsedLastExecuted =
        rawLastExecuted instanceof Date
            ? rawLastExecuted
            : typeof rawLastExecuted === 'string'
              ? new Date(rawLastExecuted)
              : null;
    const stats = {
        leadership: general.leadership,
        strength: general.strength,
        intelligence: general.intel,
    };
    const refreshScore = accessLog?.refreshScore ?? 0;
    const refreshScoreTotal = accessLog?.refreshScoreTotal ?? 0;
    const troopStatus: 'inactive' | 'present' | 'away' =
        troopLeaderFirstTurn?.actionCode !== undefined && troopLeaderFirstTurn.actionCode !== 'che_집합'
            ? 'inactive'
            : troopLeader?.cityId === general.cityId
              ? 'present'
              : 'away';

    return {
        general: {
            id: general.id,
            name: general.name,
            npcState: general.npcState,
            nationId: general.nationId,
            cityId: general.cityId,
            troopId: general.troopId,
            picture: general.picture,
            imageServer: general.imageServer,
            officerLevel: general.officerLevel,
            officerLevelText: resolveOfficerLevelName(general.officerLevel, nation.level),
            officerCityName:
                general.officerLevel >= 2 && general.officerLevel <= 4 ? (officerCity?.name ?? null) : null,
            generalType: resolveGeneralTypeCall(stats, chiefStatMin, statGradeLevel),
            leadershipBonus: resolveLeadershipBonus(general.officerLevel, nation.level),
            stats,
            gold: general.gold,
            rice: general.rice,
            crew: general.crew,
            train: general.train,
            atmos: general.atmos,
            injury: general.injury,
            experience: general.experience,
            dedication: general.dedication,
            age: general.age,
            retirementYear,
            turnTime: general.turnTime.toISOString(),
            defenceTrain: settings.defence_train,
            killTurn: readNumber(metaRecord.killturn ?? metaRecord.killTurn, 0),
            remainingMinutes: resolveRemainingMinutes(
                general.turnTime,
                parsedLastExecuted,
                worldState?.tickSeconds ?? 0
            ),
            crewTypeId: general.crewTypeId,
            crewTypeName: crewTypeNames.get(general.crewTypeId) ?? '-',
            traits: {
                personal: resolveTraitDisplayName(general.personalCode, personalityNames),
                specialDomestic: resolveTraitDisplayName(general.specialCode, domesticNames),
                specialWar: resolveTraitDisplayName(general.special2Code, warNames),
            },
            progression: {
                experienceLevel: readNumber(metaRecord.explevel, 0),
                dedicationLevel,
                dedicationText: resolveDedicationLevelName(dedicationLevel, maxDedicationLevel),
                statExperience: {
                    leadership: readNumber(metaRecord.leadership_exp, 0),
                    strength: readNumber(metaRecord.strength_exp, 0),
                    intelligence: readNumber(metaRecord.intel_exp, 0),
                },
                statUpgradeLimit: readNumber(constValues.upgradeLimit, 30),
                dex: [1, 2, 3, 4, 5].map((index) => readNumber(metaRecord[`dex${index}`], 0)),
            },
            items: {
                horse: normalizeItemCode(general.horseCode),
                weapon: normalizeItemCode(general.weaponCode),
                book: normalizeItemCode(general.bookCode),
                item: normalizeItemCode(general.itemCode),
            },
            itemNames: {
                horse: itemName(general.horseCode),
                weapon: itemName(general.weaponCode),
                book: itemName(general.bookCode),
                item: itemName(general.itemCode),
            },
            troop: troop
                ? {
                      name: troop.name,
                      status: troopStatus,
                      leaderCityName: troopLeaderCity?.name ?? null,
                  }
                : null,
            refreshScore: {
                current: refreshScore,
                total: refreshScoreTotal,
                text: resolveRefreshScoreText(refreshScoreTotal),
            },
        },
        iconChoices: ctx.auth?.user.canUseGeneralPicture === false ? [] : (ctx.auth?.user.icons ?? []),
        canChangeIcon: general.npcState === 0 && ctx.auth?.user.canUseGeneralPicture !== false,
        iconChangeAvailableAt:
            typeof metaRecord.generalIconChangedAt === 'string'
                ? new Date(new Date(metaRecord.generalIconChangedAt).getTime() + 24 * 60 * 60 * 1000).toISOString()
                : null,
        city: city
            ? {
                  ...city,
                  levelName: resolveCityLevelName(city.level),
                  regionName: resolveRegionName(city.region),
                  nationName: city.nationId > 0 ? (cityNation?.name ?? '-') : '공백지',
              }
            : null,
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            gold: nation.gold,
            rice: nation.rice,
            tech: nation.tech,
            typeCode: nation.typeCode,
            capitalCityId: nation.capitalCityId,
            levelName: resolveNationLevelName(nation.level),
            typeName: nation.id === 0 ? '-' : (nationType?.name ?? sanitizeInternalDisplayCode(nation.typeCode)),
            typePros: nationTypeEffects.pros,
            typeCons: nationTypeEffects.cons,
            capitalCityName: nation.id === 0 ? null : (capitalCity?.name ?? null),
            population: {
                cityCount: nationPopulation._count,
                current: nationPopulation._sum.population ?? 0,
                max: nationPopulation._sum.populationMax ?? 0,
            },
            crew: {
                generalCount: nationCrew._count,
                current: nationCrew._sum.crew ?? 0,
                max: (nationCrew._sum.leadership ?? 0) * 100,
            },
            power: readNumber(nationMeta.power, 0),
            bill: resolveNationBill(nationMeta),
            taxRate: resolveNationRate(nation),
            strategicCommandLimit: readNumber(nationMeta.strategic_cmd_limit, 0),
            diplomaticLimit: readNumber(nationMeta.surlimit, 0),
            prohibitScout: resolveNationBlockScout(nationMeta),
            prohibitWar: resolveNationBlockWar(nationMeta),
            techLevel: nationTech.level,
            techLimited: nationTech.limited,
            topChiefs,
            impossibleStrategicCommands:
                nation.id === 0
                    ? []
                    : resolveImpossibleStrategicCommands(
                          nationMeta,
                          worldState?.currentYear ?? 0,
                          worldState?.currentMonth ?? 1
                      ),
        },
        settings,
        penalties,
    };
};

export const generalRouter = router({
    adjustIcon: engineAuthedProcedure
        .input(
            z.object({ iconId: z.string().uuid().optional(), clientRequestId: z.string().uuid().optional() }).optional()
        )
        .mutation(({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const selected = input?.iconId ? ctx.auth?.user.icons?.find((icon) => icon.id === input.iconId) : undefined;
            if (input?.iconId && (!selected || ctx.auth?.user.canUseGeneralPicture === false)) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '사용 가능한 내 전용 아이콘이 아닙니다.' });
            }
            return adjustAccountIconForUser(
                ctx,
                userId,
                selected
                    ? {
                          picture: selected.picture,
                          imageServer: selected.imageServer,
                          revision: ctx.auth?.user.iconUpdatedAt ?? selected.createdAt,
                      }
                    : undefined,
                true,
                input?.clientRequestId ?? ctx.requestId
            );
        }),
    me: authedProcedure.query(({ ctx }) => getGeneralContext(ctx)),
    ensureDieOnPrestartStatus: accessEngineAuthedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }
        const general = await ctx.db.general.findFirst({
            where: { userId, npcState: 0 },
            select: { id: true },
        });
        if (!general) {
            return { show: false, available: false, availableAt: null };
        }
        const result = await ctx.turnDaemon.requestCommand({
            type: 'ensureDieOnPrestartStatus',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:general.ensureDieOnPrestartStatus` } : {}),
            userId,
            generalId: general.id,
        });
        if (!result) {
            throw new TRPCError({
                code: 'TIMEOUT',
                message: '삭제 가능 시각을 아직 확인하지 못했습니다. 다시 시도해 주세요.',
            });
        }
        if (result.type !== 'ensureDieOnPrestartStatus') {
            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: '턴 데몬이 올바르지 않은 삭제 상태를 반환했습니다.',
            });
        }
        return {
            show: result.show,
            available: result.available,
            availableAt: result.availableAt ?? null,
        };
    }),
    dieOnPrestart: accessEngineAuthedInputProcedure(zImmediateActionInput).mutation(({ ctx, input }) =>
        requestImmediateAction(ctx, input, 'dieOnPrestart')
    ),
    buildNationCandidate: accessEngineAuthedInputProcedure(zImmediateActionInput).mutation(({ ctx, input }) =>
        requestImmediateAction(ctx, input, 'buildNationCandidate')
    ),
    instantRetreat: accessEngineAuthedInputProcedure(zImmediateActionInput).mutation(({ ctx, input }) =>
        requestImmediateAction(ctx, input, 'instantRetreat')
    ),
    vacation: engineAuthedProcedure.mutation(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'vacation',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:general.vacation:engine:0:vacation` } : {}),
            generalId: general.id,
        });
        if (!result || result.type !== 'vacation') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    }),
    setMySetting: accessEngineAuthedInputProcedure(zGeneralSettings).mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'setMySetting',
            ...(ctx.requestId
                ? { requestId: `${ctx.requestId}:general.setMySetting:engine:0:setMySetting` }
                : {}),
            generalId: general.id,
            settings: input,
        });
        if (!result || result.type !== 'setMySetting') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }

        return { ok: true };
    }),
    dropItem: engineAuthedProcedure.input(z.object({ itemType: z.string() })).mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'dropItem',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:general.dropItem:engine:0:dropItem` } : {}),
            generalId: general.id,
            itemType: input.itemType,
        });
        if (!result || result.type !== 'dropItem') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    }),
    getMyLog: authedProcedure
        .input(
            z.object({
                type: zGeneralLogType,
                beforeId: z.number().int().positive().optional(),
            })
        )
        .query(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);

            const categoryMap: Record<z.infer<typeof zGeneralLogType>, LogCategory> = {
                generalHistory: LogCategory.HISTORY,
                generalAction: LogCategory.ACTION,
                battleResult: LogCategory.BATTLE_BRIEF,
                battleDetail: LogCategory.BATTLE_DETAIL,
            };

            const logs = await ctx.db.logEntry.findMany({
                where: {
                    generalId: me.id,
                    scope: LogScope.GENERAL,
                    category: categoryMap[input.type],
                    ...(input.type !== 'generalHistory' && input.beforeId ? { id: { lt: input.beforeId } } : {}),
                },
                orderBy: { id: 'desc' },
                ...(input.type === 'generalHistory' ? {} : { take: 24 }),
            });

            return {
                type: input.type,
                logs: logs.map((entry) => ({
                    id: entry.id,
                    text: entry.text,
                })),
            };
        }),
    getRecentRecords: deferredAccessLimitAuthedProcedure
        .input(
            z.object({
                lastGeneralRecordId: z.number().int().nonnegative().default(0),
                lastWorldHistoryId: z.number().int().nonnegative().default(0),
            })
        )
        .query(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            const take = MAIN_RECORD_LIMIT + 1;
            const [global, general, history] = await Promise.all([
                ctx.db.logEntry.findMany({
                    where: {
                        scope: LogScope.SYSTEM,
                        category: { in: [LogCategory.SUMMARY, LogCategory.ACTION] },
                        id: { gte: input.lastGeneralRecordId },
                    },
                    orderBy: { id: 'desc' },
                    take,
                    select: { id: true, text: true, createdAt: true },
                }),
                ctx.db.logEntry.findMany({
                    where: {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        generalId: me.id,
                        id: { gte: input.lastGeneralRecordId },
                    },
                    orderBy: { id: 'desc' },
                    take,
                    select: { id: true, text: true, createdAt: true },
                }),
                ctx.db.logEntry.findMany({
                    where: {
                        scope: LogScope.SYSTEM,
                        category: LogCategory.HISTORY,
                        id: { gte: input.lastWorldHistoryId },
                    },
                    orderBy: { id: 'desc' },
                    take,
                    select: { id: true, text: true, createdAt: true },
                }),
            ]);

            return {
                global: trimRecentRecords(global, input.lastGeneralRecordId),
                general: trimRecentRecords(general, input.lastGeneralRecordId),
                history: trimRecentRecords(history, input.lastWorldHistoryId),
            };
        }),
    // 메인 화면은 SSE invalidation, 탭 복귀와 직접 갱신이 같은 read model을
    // 호출한다. 클라이언트가 주장하는 갱신 원인을 신뢰해 구분하지 않고 이
    // projection 전체를 무가점으로 두되, 이미 제한된 사용자의 gate는 유지한다.
    getFrontStatus: deferredAccessLimitAuthedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        const worldState = await ctx.db.worldState.findFirst({
            orderBy: { id: 'asc' },
            select: {
                tickSeconds: true,
                meta: true,
            },
        });
        if (!worldState) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
        }

        const now = new Date();
        const { scoreStartedAt } = resolveAccessWindows(now, worldState.tickSeconds, worldState.meta);
        const [onlineAccess, ownNation, latestVote] = await Promise.all([
            ctx.db.generalAccessLog.findMany({
                where: {
                    lastRefresh: {
                        gte: scoreStartedAt,
                    },
                },
                select: { generalId: true },
            }),
            me.nationId > 0
                ? ctx.db.nation.findUnique({
                      where: { id: me.nationId },
                      select: { meta: true },
                  })
                : Promise.resolve(null),
            ctx.db.votePoll.findFirst({
                where: {
                    startAt: { lte: now },
                    closedAt: null,
                    OR: [{ endAt: null }, { endAt: { gte: now } }],
                },
                orderBy: { id: 'desc' },
                select: {
                    id: true,
                    title: true,
                },
            }),
        ]);

        const onlineGeneralIds = onlineAccess.map((entry) => entry.generalId);
        const onlineGenerals =
            onlineGeneralIds.length > 0
                ? await ctx.db.general.findMany({
                      where: { id: { in: onlineGeneralIds } },
                      orderBy: { id: 'asc' },
                      select: {
                          id: true,
                          name: true,
                          nationId: true,
                      },
                  })
                : [];
        const nationIds = [...new Set(onlineGenerals.map((general) => general.nationId).filter((id) => id > 0))];
        const nations =
            nationIds.length > 0
                ? await ctx.db.nation.findMany({
                      where: { id: { in: nationIds } },
                      select: {
                          id: true,
                          name: true,
                      },
                  })
                : [];
        const nationNames = new Map(nations.map((nation) => [nation.id, nation.name]));
        const onlineByNation = new Map<number, typeof onlineGenerals>();
        for (const general of onlineGenerals) {
            const bucket = onlineByNation.get(general.nationId) ?? [];
            bucket.push(general);
            onlineByNation.set(general.nationId, bucket);
        }
        const onlineNations = [...onlineByNation.entries()]
            .sort((left, right) => right[1].length - left[1].length || left[0] - right[0])
            .map(([nationId]) => `【${nationId === 0 ? '재야' : (nationNames.get(nationId) ?? `세력 ${nationId}`)}】`)
            .join(', ');
        const myOnlineGenerals = onlineGenerals
            .filter((general) => general.nationId === me.nationId)
            .map((general) => general.name)
            .join(', ');
        const myVote = latestVote
            ? await ctx.db.vote.findFirst({
                  where: {
                      voteId: latestVote.id,
                      generalId: me.id,
                  },
                  select: { id: true },
              })
            : null;
        const worldMeta = asRecord(worldState.meta);
        const rawLastExecuted = worldMeta.lastTurnTime ?? worldMeta.turntime;
        const parsedLastExecuted =
            typeof rawLastExecuted === 'string' || rawLastExecuted instanceof Date ? new Date(rawLastExecuted) : null;

        return {
            onlineUserCount: onlineGenerals.length,
            onlineNations,
            onlineGenerals: myOnlineGenerals,
            nationNotice: ownNation ? resolveNationNotice(asRecord(ownNation.meta)) : '',
            lastExecuted:
                parsedLastExecuted && Number.isFinite(parsedLastExecuted.getTime())
                    ? parsedLastExecuted.toISOString()
                    : null,
            latestVote: latestVote
                ? {
                      id: latestVote.id,
                      title: latestVote.title,
                      hasVoted: Boolean(myVote),
                  }
                : null,
        };
    }),
});
