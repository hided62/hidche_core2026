import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord, type RankDataType, type TurnDaemonCommandResult } from '@sammo-ts/common';
import {
    getBillByLevel,
    isValidTroopNameWidth,
    normalizeTroopName,
    resolveTroopSecretPermission,
} from '@sammo-ts/logic';

import { accessAuthedProcedure, engineAuthedProcedure, router } from '../../trpc.js';
import {
    loadCrewTypeDisplayNames,
    loadItemDisplayNames,
    resolveDedicationLevelName,
    resolveOfficerLevelName,
    sanitizeInternalDisplayCode,
} from '../../services/gameDisplayNames.js';
import {
    resolveGeneralTypeCall,
    resolveLeadershipBonus,
    resolveRefreshScoreText,
    resolveRemainingMinutes,
} from '../../services/generalBasicCardProjection.js';
import { loadCurrentGameTime } from '../../services/gameClock.js';
import { loadTraitNames } from '../nation/shared.js';
import { getAuthenticatedUserId, getMyGeneral } from '../shared/general.js';
import { throwIfCommandRejected } from '../shared/turnDaemon.js';

const TROOP_PANEL_RECORD_TYPES = [
    'firenum',
    'warnum',
    'killnum',
    'deathnum',
    'killcrew',
    'deathcrew',
] as const satisfies readonly RankDataType[];

const readNumber = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const troopNameSchema = z
    .string()
    .refine(isValidTroopNameWidth, '부대 이름은 전각 9자 또는 반각 18자 이하여야 합니다.');

const normalizeRequiredTroopName = (value: string): string => {
    const name = normalizeTroopName(value);
    if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '부대 이름이 없습니다.' });
    }
    return name;
};

const assertCommandResult = <T extends 'troopCreate' | 'troopJoin' | 'troopExit' | 'troopKick' | 'troopRename'>(
    result: TurnDaemonCommandResult | null,
    expectedType: T
): never => {
    throwIfCommandRejected(result);
    if (!result) {
        throw new TRPCError({ code: 'TIMEOUT', message: 'Turn daemon did not respond.' });
    }
    throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Unexpected turn daemon response for ${expectedType}.`,
    });
};

export const troopRouter = router({
    getList: accessAuthedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        if (me.nationId <= 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '국가에 소속되어 있지 않습니다.' });
        }

        const [nation, troops, generals, cities, worldState, gameTime] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { id: true, name: true, color: true, level: true, meta: true },
            }),
            ctx.db.troop.findMany({
                where: { nationId: me.nationId },
                select: { troopLeaderId: true, nationId: true, name: true },
            }),
            ctx.db.general.findMany({
                where: { nationId: me.nationId },
                select: {
                    id: true,
                    name: true,
                    cityId: true,
                    troopId: true,
                    npcState: true,
                    picture: true,
                    imageServer: true,
                    turnTime: true,
                    recentWarTime: true,
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
                    crewTypeId: true,
                    weaponCode: true,
                    bookCode: true,
                    horseCode: true,
                    itemCode: true,
                    personalCode: true,
                    specialCode: true,
                    special2Code: true,
                    meta: true,
                },
            }),
            ctx.db.city.findMany({
                select: { id: true, name: true },
            }),
            ctx.db.worldState.findFirst({ select: { tickSeconds: true, config: true, meta: true } }),
            loadCurrentGameTime(ctx.db),
        ]);
        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '국가 정보를 찾을 수 없습니다.' });
        }

        const permission = resolveTroopSecretPermission(me, nation.meta, false);
        const troopLeaderIds = troops.map((troop) => troop.troopLeaderId);
        const generalIds = generals.map((general) => general.id);
        const [turns, rankRows, accessRows] = await Promise.all([
            troopLeaderIds.length === 0
                ? []
                : ctx.db.generalTurn.findMany({
                      where: { generalId: { in: troopLeaderIds }, turnIdx: { lt: 5 } },
                      select: { generalId: true, turnIdx: true, actionCode: true },
                      orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
                  }),
            permission < 1 || generalIds.length === 0
                ? []
                : ctx.db.rankData.findMany({
                      where: {
                          generalId: { in: generalIds },
                          type: { in: [...TROOP_PANEL_RECORD_TYPES] },
                      },
                      select: { generalId: true, type: true, value: true },
                  }),
            permission < 1 || generalIds.length === 0
                ? []
                : ctx.db.generalAccessLog.findMany({
                      where: { generalId: { in: generalIds } },
                      select: { generalId: true, refreshScore: true, refreshScoreTotal: true },
                  }),
        ]);
        const cityNames = new Map(cities.map((city) => [city.id, city.name]));
        const generalMap = new Map(generals.map((general) => [general.id, general]));
        const reservedByLeader = new Map<number, string[]>();
        const firstActionByLeader = new Map<number, string>();
        const rankValueMap = new Map<number, Map<RankDataType, number>>();
        const accessByGeneral = new Map(accessRows.map((row) => [row.generalId, row]));
        const worldConfig = asRecord(worldState?.config);
        const constValues = asRecord(worldConfig.const ?? worldConfig.consts);
        const scenarioStat = asRecord(worldConfig.stat);
        const chiefStatMin = readNumber(scenarioStat.chiefMin, 70);
        const statGradeLevel = readNumber(constValues.statGradeLevel, 5);
        const retirementYear = readNumber(constValues.retirementYear, 70);
        const maxDedicationLevel = Math.max(0, Math.trunc(readNumber(constValues.maxDedLevel, 30)));
        const statUpgradeLimit =
            typeof constValues.upgradeLimit === 'number' && Number.isFinite(constValues.upgradeLimit)
                ? constValues.upgradeLimit
                : 30;
        for (const turn of turns) {
            if (!firstActionByLeader.has(turn.generalId)) {
                firstActionByLeader.set(turn.generalId, turn.actionCode);
            }
            const list = reservedByLeader.get(turn.generalId) ?? [];
            // Ref 부대 편성은 앞쪽 슬롯이 집합인지 여부만 공개하고 다른 명령은 가립니다.
            list.push(turn.actionCode === 'che_집합' ? '집합' : '-');
            reservedByLeader.set(turn.generalId, list);
        }
        for (const row of rankRows) {
            const values = rankValueMap.get(row.generalId) ?? new Map<RankDataType, number>();
            values.set(row.type as (typeof TROOP_PANEL_RECORD_TYPES)[number], row.value);
            rankValueMap.set(row.generalId, values);
        }

        const [personalityNames, domesticNames, warNames, crewTypeNames, itemNames] =
            permission < 1
                ? [new Map(), new Map(), new Map(), new Map(), new Map()]
                : await Promise.all([
                      loadTraitNames(
                          generals.map((general) => general.personalCode),
                          'personality'
                      ),
                      loadTraitNames(
                          generals.map((general) => general.specialCode),
                          'domestic'
                      ),
                      loadTraitNames(
                          generals.map((general) => general.special2Code),
                          'war'
                      ),
                      loadCrewTypeDisplayNames(worldState, ctx.profile.id),
                      loadItemDisplayNames(
                          generals.flatMap((general) => [
                              general.weaponCode,
                              general.bookCode,
                              general.horseCode,
                              general.itemCode,
                          ])
                      ),
                  ]);
        const traitName = (code: string, names: Map<string, { name: string }>): string =>
            names.get(code)?.name ?? sanitizeInternalDisplayCode(code);
        const itemName = (code: string): string => itemNames.get(code) ?? sanitizeInternalDisplayCode(code);
        const mappedTroops = troops
            .map((troop) => {
                const leader = generalMap.get(troop.troopLeaderId);
                return {
                    id: troop.troopLeaderId,
                    name: troop.name,
                    nationId: troop.nationId,
                    turnTime: leader?.turnTime.toISOString() ?? null,
                    reservedCommands: reservedByLeader.get(troop.troopLeaderId) ?? [],
                    leader: leader
                        ? {
                              id: leader.id,
                              name: leader.name,
                              cityId: leader.cityId,
                              cityName: cityNames.get(leader.cityId) ?? '알 수 없음',
                              picture: leader.picture,
                              imageServer: leader.imageServer,
                          }
                        : null,
                    members: generals
                        .filter((general) => general.troopId === troop.troopLeaderId)
                        .map((general) => {
                            const meta = asRecord(general.meta);
                            const metaNumber = (key: string): number => {
                                return readNumber(meta[key]);
                            };
                            const stats = {
                                leadership: general.leadership,
                                strength: general.strength,
                                intelligence: general.intel,
                            };
                            const storedDedicationLevel = metaNumber('dedlevel');
                            const dedicationLevel =
                                storedDedicationLevel > 0
                                    ? storedDedicationLevel
                                    : Math.max(
                                          0,
                                          Math.min(Math.ceil(Math.sqrt(general.dedication) / 10), maxDedicationLevel)
                                      );
                            const rankValue = (
                                type: (typeof TROOP_PANEL_RECORD_TYPES)[number],
                                fallbackKeys: string[] = []
                            ): number => {
                                const stored = rankValueMap.get(general.id)?.get(type);
                                if (stored !== undefined) return stored;
                                for (const key of fallbackKeys) {
                                    const fallback = meta[key];
                                    if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
                                }
                                return 0;
                            };
                            const officerCityId = readNumber(
                                meta.officerCity ?? meta.officer_city ?? meta.officerCityId
                            );
                            const access = accessByGeneral.get(general.id);
                            const refreshScore = access?.refreshScore ?? 0;
                            const refreshScoreTotal = access?.refreshScoreTotal ?? 0;
                            const firstAction = firstActionByLeader.get(troop.troopLeaderId);
                            const troopStatus: 'inactive' | 'present' | 'away' =
                                firstAction !== undefined && firstAction !== 'che_집합'
                                    ? 'inactive'
                                    : leader?.cityId === general.cityId
                                      ? 'present'
                                      : 'away';
                            return {
                                id: general.id,
                                name: general.name,
                                cityId: general.cityId,
                                cityName: cityNames.get(general.cityId) ?? '알 수 없음',
                                stats,
                                experience: general.experience,
                                progression: {
                                    experienceLevel: metaNumber('explevel'),
                                    statExperience: {
                                        leadership: metaNumber('leadership_exp'),
                                        strength: metaNumber('strength_exp'),
                                        intelligence: metaNumber('intel_exp'),
                                    },
                                    statUpgradeLimit,
                                    dex: [1, 2, 3, 4, 5].map((index) => metaNumber(`dex${index}`)),
                                },
                                panel:
                                    permission < 1
                                        ? null
                                        : {
                                              general: {
                                                  id: general.id,
                                                  name: general.name,
                                                  picture: general.picture,
                                                  imageServer: general.imageServer,
                                                  npcState: general.npcState,
                                                  officerLevel: general.officerLevel,
                                                  officerLevelText: resolveOfficerLevelName(
                                                      general.officerLevel,
                                                      nation.level
                                                  ),
                                                  officerCityName:
                                                      general.officerLevel >= 2 && general.officerLevel <= 4
                                                          ? (cityNames.get(officerCityId) ?? null)
                                                          : null,
                                                  generalType: resolveGeneralTypeCall(
                                                      stats,
                                                      chiefStatMin,
                                                      statGradeLevel
                                                  ),
                                                  leadershipBonus: resolveLeadershipBonus(
                                                      general.officerLevel,
                                                      nation.level
                                                  ),
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
                                                  defenceTrain: readNumber(meta.defence_train, 80),
                                                  killTurn: readNumber(meta.killturn ?? meta.killTurn),
                                                  remainingMinutes: resolveRemainingMinutes(
                                                      general.turnTime,
                                                      gameTime.now
                                                  ),
                                                  troopId: general.troopId,
                                                  troop: {
                                                      name: troop.name,
                                                      status: troopStatus,
                                                      leaderCityName:
                                                          leader && leader.cityId !== general.cityId
                                                              ? (cityNames.get(leader.cityId) ?? null)
                                                              : null,
                                                  },
                                                  refreshScore: {
                                                      current: refreshScore,
                                                      total: refreshScoreTotal,
                                                      text: resolveRefreshScoreText(refreshScoreTotal),
                                                  },
                                                  crewTypeId: general.crewTypeId,
                                                  crewTypeName: crewTypeNames.get(general.crewTypeId) ?? '-',
                                                  traits: {
                                                      personal: traitName(general.personalCode, personalityNames),
                                                      specialDomestic: traitName(general.specialCode, domesticNames),
                                                      specialWar: traitName(general.special2Code, warNames),
                                                  },
                                                  progression: {
                                                      experienceLevel: metaNumber('explevel'),
                                                      dedicationLevel,
                                                      dedicationText: resolveDedicationLevelName(
                                                          dedicationLevel,
                                                          maxDedicationLevel
                                                      ),
                                                      statExperience: {
                                                          leadership: metaNumber('leadership_exp'),
                                                          strength: metaNumber('strength_exp'),
                                                          intelligence: metaNumber('intel_exp'),
                                                      },
                                                      statUpgradeLimit,
                                                      dex: [1, 2, 3, 4, 5].map((index) => metaNumber(`dex${index}`)),
                                                  },
                                                  itemNames: {
                                                      horse: itemName(general.horseCode),
                                                      weapon: itemName(general.weaponCode),
                                                      book: itemName(general.bookCode),
                                                      item: itemName(general.itemCode),
                                                  },
                                              },
                                              summary: {
                                                  available: true,
                                                  experience: general.experience,
                                                  dedicationText: resolveDedicationLevelName(
                                                      dedicationLevel,
                                                      maxDedicationLevel
                                                  ),
                                                  bill: getBillByLevel(dedicationLevel),
                                                  warnum: rankValue('warnum', ['rank_warnum', 'warnum']),
                                                  wins: rankValue('killnum', ['rank_killnum', 'killnum']),
                                                  losses: rankValue('deathnum', ['rank_deathnum', 'deathnum']),
                                                  strategies: rankValue('firenum', ['rank_firenum', 'firenum']),
                                                  serviceYears: metaNumber('belong'),
                                                  killCrew: rankValue('killcrew', ['rank_killcrew', 'killcrew']),
                                                  deathCrew: rankValue('deathcrew', ['rank_deathcrew', 'deathcrew']),
                                                  recentWar: general.recentWarTime?.toISOString() ?? null,
                                              },
                                          },
                            };
                        }),
                };
            })
            .sort((left, right) => {
                const timeOrder = (left.turnTime ?? '').localeCompare(right.turnTime ?? '');
                return timeOrder || left.id - right.id;
            });

        return {
            nation: { id: nation.id, name: nation.name, color: nation.color },
            me: { id: me.id, troopId: me.troopId },
            permission,
            troops: mappedTroops,
        };
    }),
    create: engineAuthedProcedure.input(z.object({ troopName: troopNameSchema })).mutation(async ({ ctx, input }) => {
        const userId = getAuthenticatedUserId(ctx);
        const me = await getMyGeneral(ctx);
        const troopName = normalizeRequiredTroopName(input.troopName);
        if (me.troopId !== 0) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: '이미 부대에 소속되어 있습니다.',
            });
        }
        if (me.nationId <= 0) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: '국가에 소속되어 있지 않습니다.',
            });
        }
        const result = await ctx.turnDaemon.requestCommand({
            type: 'troopCreate',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:troop.create:engine:0:troopCreate` } : {}),
            userId,
            generalId: me.id,
            troopName,
        });
        if (!result || result.type !== 'troopCreate') {
            return assertCommandResult(result, 'troopCreate');
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.reason });
        }
        return { ok: true, troopId: result.troopId, troopName: result.troopName };
    }),
    join: engineAuthedProcedure
        .input(z.object({ troopId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
            const userId = getAuthenticatedUserId(ctx);
            const me = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'troopJoin',
                ...(ctx.requestId ? { requestId: `${ctx.requestId}:troop.join:engine:0:troopJoin` } : {}),
                userId,
                generalId: me.id,
                troopId: input.troopId,
            });
            if (!result || result.type !== 'troopJoin') {
                return assertCommandResult(result, 'troopJoin');
            }
            if (!result.ok) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.reason });
            }
            return { ok: true };
        }),
    exit: engineAuthedProcedure.mutation(async ({ ctx }) => {
        const userId = getAuthenticatedUserId(ctx);
        const me = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'troopExit',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:troop.exit:engine:0:troopExit` } : {}),
            userId,
            generalId: me.id,
        });
        if (!result || result.type !== 'troopExit') {
            return assertCommandResult(result, 'troopExit');
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.reason });
        }
        return { ok: true, wasLeader: result.wasLeader };
    }),
    kick: engineAuthedProcedure
        .input(
            z.object({
                troopId: z.number().int().positive(),
                targetGeneralId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = getAuthenticatedUserId(ctx);
            const me = await getMyGeneral(ctx);
            if (me.id !== input.troopId || me.troopId !== me.id) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }
            const target = await ctx.db.general.findUnique({
                where: { id: input.targetGeneralId },
                select: { id: true, troopId: true },
            });
            if (!target) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '장수 정보를 찾을 수 없습니다.' });
            }
            if (target.troopId === 0) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '부대에 소속되어 있지 않습니다.' });
            }
            if (target.troopId !== input.troopId) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '다른 부대에 소속되어 있습니다.' });
            }
            if (target.id === input.troopId) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '부대장을 추방할 수 없습니다.' });
            }

            const result = await ctx.turnDaemon.requestCommand({
                type: 'troopKick',
                ...(ctx.requestId ? { requestId: `${ctx.requestId}:troop.kick:engine:0:troopKick` } : {}),
                userId,
                generalId: me.id,
                troopId: input.troopId,
                targetGeneralId: input.targetGeneralId,
            });
            if (!result || result.type !== 'troopKick') {
                return assertCommandResult(result, 'troopKick');
            }
            if (!result.ok) {
                const code = result.reason === '권한이 부족합니다.' ? 'FORBIDDEN' : 'PRECONDITION_FAILED';
                throw new TRPCError({ code, message: result.reason });
            }
            return { ok: true };
        }),
    rename: engineAuthedProcedure
        .input(
            z.object({
                troopId: z.number().int().positive(),
                troopName: troopNameSchema,
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = getAuthenticatedUserId(ctx);
            const me = await getMyGeneral(ctx);
            const troopName = normalizeRequiredTroopName(input.troopName);
            const nation = await ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            });
            const permission = resolveTroopSecretPermission(me, nation?.meta ?? {}, false);
            if (me.id !== input.troopId && permission < 4) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }
            const troop = await ctx.db.troop.findUnique({
                where: { troopLeaderId: input.troopId },
                select: { nationId: true },
            });
            if (!troop || me.nationId <= 0 || troop.nationId !== me.nationId) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '부대가 없습니다.' });
            }

            const result = await ctx.turnDaemon.requestCommand({
                type: 'troopRename',
                ...(ctx.requestId ? { requestId: `${ctx.requestId}:troop.rename:engine:0:troopRename` } : {}),
                userId,
                generalId: me.id,
                troopId: input.troopId,
                troopName,
            });
            if (!result || result.type !== 'troopRename') {
                return assertCommandResult(result, 'troopRename');
            }
            if (!result.ok) {
                const code = result.reason === '권한이 부족합니다.' ? 'FORBIDDEN' : 'PRECONDITION_FAILED';
                throw new TRPCError({ code, message: result.reason });
            }
            return { ok: true, troopName: result.troopName };
        }),
});
