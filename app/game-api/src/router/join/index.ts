import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import type { DatabaseClient, WorldStateRow } from '../../context.js';
import { authedProcedure, router } from '../../trpc.js';
import { asNumber, asRecord, asStringArray, LiteHashDRBG } from '@sammo-ts/common';
import {
    isPersonalityTraitKey,
    isWarTraitKey,
    loadPersonalityTraitModules,
    loadWarTraitModules,
    PersonalityTraitLoader,
    PERSONALITY_TRAIT_KEYS,
    WarTraitLoader,
    WAR_TRAIT_KEYS,
} from '@sammo-ts/logic';
import {
    appendInheritanceLog,
    readInheritancePoint,
    resolveInheritConstants,
    setInheritancePoint,
} from '../../services/inheritance.js';

const DEFAULT_JOIN_STAT = {
    total: 165,
    min: 15,
    max: 80,
    bonusMin: 3,
    bonusMax: 5,
};

const buildSpecialityAge = (
    retirementYear: number,
    age: number,
    relativeYear: number,
    divisor: number
): number => Math.max(Math.round((retirementYear - age) / divisor - relativeYear / 2), 3) + age;

export const resolveJoinSpecialityAges = (options: {
    retirementYear: number;
    age: number;
    relativeYear: number;
    scenarioId: number;
}): { domestic: number; war: number } => {
    if (Number.isFinite(options.scenarioId) && options.scenarioId >= 1000) {
        return { domestic: options.age + 3, war: options.age + 3 };
    }
    return {
        domestic: buildSpecialityAge(options.retirementYear, options.age, options.relativeYear, 12),
        war: buildSpecialityAge(options.retirementYear, options.age, options.relativeYear, 6),
    };
};

const resolveJoinStat = (worldState: WorldStateRow) => {
    const config = asRecord(worldState.config);
    const stat = asRecord(config.stat);
    return {
        total: asNumber(stat.total, DEFAULT_JOIN_STAT.total),
        min: asNumber(stat.min, DEFAULT_JOIN_STAT.min),
        max: asNumber(stat.max, DEFAULT_JOIN_STAT.max),
        bonusMin: DEFAULT_JOIN_STAT.bonusMin,
        bonusMax: DEFAULT_JOIN_STAT.bonusMax,
    };
};

const resolveJoinPolicy = (worldState: WorldStateRow) => {
    const config = asRecord(worldState.config);
    const joinMode = typeof config.joinMode === 'string' ? config.joinMode : 'full';
    const blockGeneralCreate =
        typeof config.blockGeneralCreate === 'number' && Number.isFinite(config.blockGeneralCreate)
            ? Math.floor(config.blockGeneralCreate)
            : 0;
    return { joinMode, blockGeneralCreate };
};


const hashString = (value: string): number => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
};

const pickFromList = (values: string[], seed: string): string | null => {
    if (!values.length) {
        return null;
    }
    const index = hashString(seed) % values.length;
    return values[index] ?? null;
};

const buildTurnTimeZones = (tickMinutes: number): string[] => {
    const zones: string[] = [];
    for (let i = 0; i < 60; i += 1) {
        const totalMinutes = i * tickMinutes;
        const hour = Math.floor(totalMinutes / 60) % 24;
        const minute = totalMinutes % 60;
        zones.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
    return zones;
};

const alignToTurnBase = (time: Date, tickMinutes: number): Date => {
    const base = new Date(time.getFullYear(), time.getMonth(), time.getDate() - 1, 1, 0, 0, 0);
    const elapsedMinutes = Math.floor((time.getTime() - base.getTime()) / 60000);
    const alignedMinutes = elapsedMinutes - (elapsedMinutes % tickMinutes);
    return new Date(base.getTime() + alignedMinutes * 60000);
};

const nextRangeInt = (rng: LiteHashDRBG, minInclusive: number, maxInclusive: number): number => {
    if (maxInclusive <= minInclusive) {
        return minInclusive;
    }
    return minInclusive + rng.nextInt(maxInclusive - minInclusive);
};

const pickWeightedIndex = (rng: LiteHashDRBG, weights: number[]): number => {
    const total = weights.reduce((acc, value) => acc + value, 0);
    if (total <= 0) {
        return 0;
    }
    let cursor = rng.nextFloat1() * total;
    for (let i = 0; i < weights.length; i += 1) {
        cursor -= weights[i] ?? 0;
        if (cursor <= 0) {
            return i;
        }
    }
    return weights.length - 1;
};

const buildRandomBonus = (rng: LiteHashDRBG, baseStats: [number, number, number]): [number, number, number] => {
    const count = rng.nextInt(2) + 3;
    const bonus: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < count; i += 1) {
        const index = pickWeightedIndex(rng, baseStats);
        bonus[index] += 1;
    }
    return bonus;
};

let cachedPersonalityOptions: Array<{ key: string; name: string; info: string }> | null = null;

const loadPersonalityOptions = async () => {
    if (cachedPersonalityOptions) {
        return cachedPersonalityOptions;
    }
    const modules = await loadPersonalityTraitModules([...PERSONALITY_TRAIT_KEYS], new PersonalityTraitLoader());
    cachedPersonalityOptions = modules.map((trait) => ({
        key: trait.key,
        name: trait.name,
        info: trait.info ?? '',
    }));
    return cachedPersonalityOptions;
};

const loadWarOptions = async (keys: string[]) => {
    const unique = Array.from(new Set(keys.filter((key) => isWarTraitKey(key))));
    const modules = await loadWarTraitModules(unique, new WarTraitLoader());
    return modules.map((trait) => ({
        key: trait.key,
        name: trait.name,
        info: trait.info ?? '',
    }));
};

export const joinRouter = router({
    getConfig: authedProcedure.query(async ({ ctx }) => {
        const worldState = await ctx.db.worldState.findFirst();
        if (!worldState) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }

        const config = asRecord(worldState.config);
        const configConst = asRecord(config.const);
        const availableSpecialWar = asStringArray(configConst.availableSpecialWar);
        const warKeys = availableSpecialWar.length > 0 ? availableSpecialWar : [...WAR_TRAIT_KEYS];

        const [personalities, warSpecials, nationRows] = await Promise.all([
            loadPersonalityOptions(),
            loadWarOptions(warKeys),
            ctx.db.nation.findMany({
                select: {
                    id: true,
                    name: true,
                    color: true,
                    meta: true,
                },
                orderBy: { id: 'asc' },
            }),
        ]);

        const nations = nationRows.map((nation) => {
            const meta = asRecord(nation.meta);
            return {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                scoutMessage: typeof meta.infoText === 'string' ? meta.infoText : null,
            };
        });

        const inheritConst = resolveInheritConstants(worldState);
        const inheritTotalPoint = ctx.auth?.user.id
            ? await readInheritancePoint(ctx.db, ctx.auth.user.id, 'previous')
            : 0;
        const tickMinutes = Math.max(1, Math.round(worldState.tickSeconds / 60));
        const inheritCitiesRaw = await ctx.db.city.findMany({
            where: { level: { in: [5, 6] }, nationId: 0 },
            select: { id: true, name: true, level: true, region: true },
            orderBy: { id: 'asc' },
        });
        const inheritCities =
            inheritCitiesRaw.length > 0
                ? inheritCitiesRaw
                : await ctx.db.city.findMany({
                      where: { level: { in: [5, 6] } },
                      select: { id: true, name: true, level: true, region: true },
                      orderBy: { id: 'asc' },
                  });

        return {
            rules: {
                stat: resolveJoinStat(worldState),
                allowCustomName: true,
            },
            user: {
                id: ctx.auth?.user.id ?? '',
                displayName: ctx.auth?.user.displayName ?? '',
            },
            personalities: [
                { key: 'Random', name: '???', info: '무작위 성격을 선택합니다.' },
                ...personalities,
            ],
            warSpecials,
            nations,
            inherit: {
                totalPoint: inheritTotalPoint,
                costs: {
                    inheritBornSpecialPoint: inheritConst.inheritBornSpecialPoint,
                    inheritBornTurntimePoint: inheritConst.inheritBornTurntimePoint,
                    inheritBornCityPoint: inheritConst.inheritBornCityPoint,
                    inheritBornStatPoint: inheritConst.inheritBornStatPoint,
                },
                availableCities: inheritCities,
                turnTimeZones: buildTurnTimeZones(tickMinutes),
                availableSpecialWar: warSpecials,
            },
        };
    }),
    createGeneral: authedProcedure
        .input(
            z.object({
                name: z.string().min(1).max(18),
                leadership: z.number().int(),
                strength: z.number().int(),
                intel: z.number().int(),
                pic: z.boolean().optional(),
                character: z.string(),
                inheritSpecial: z.string().optional(),
                inheritTurntimeZone: z.number().int().optional(),
                inheritCity: z.number().int().optional(),
                inheritBonusStat: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            if (ctx.auth?.identity?.canCreateGeneral === false) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: '이 서버에서는 카카오 인증을 완료해야 장수를 생성할 수 있습니다.',
                });
            }

            const worldState = await ctx.db.worldState.findFirst();
            if (!worldState) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: 'World state is not initialized.',
                });
            }

            const joinPolicy = resolveJoinPolicy(worldState);
            if (joinPolicy.blockGeneralCreate === 1) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: '장수 생성이 제한된 서버입니다.',
                });
            }

            const inheritConst = resolveInheritConstants(worldState);
            const configConst = asRecord(asRecord(worldState.config).const);
            const availableSpecialWar = asStringArray(configConst.availableSpecialWar);
            const inheritBonus = input.inheritBonusStat ?? null;
            if (inheritBonus) {
                const bonusSum = inheritBonus.reduce((acc, value) => acc + value, 0);
                if (inheritBonus.some((value) => value < 0)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '보너스 능력치가 음수입니다. 다시 가입해주세요!',
                    });
                }
                if (bonusSum !== 0 && (bonusSum < 3 || bonusSum > 5)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '보너스 능력치 합이 잘못 지정되었습니다. 다시 가입해주세요!',
                    });
                }
            }
            if (input.inheritSpecial !== undefined) {
                if (!isWarTraitKey(input.inheritSpecial)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '전투 특기가 잘못 지정되었습니다.',
                    });
                }
                if (availableSpecialWar.length > 0 && !availableSpecialWar.includes(input.inheritSpecial)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '허용되지 않은 전투 특기입니다.',
                    });
                }
            }
            if (input.inheritTurntimeZone !== undefined) {
                if (input.inheritTurntimeZone < 0 || input.inheritTurntimeZone > 59) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '턴 시간 지정 범위가 올바르지 않습니다.',
                    });
                }
            }

            const statRule = resolveJoinStat(worldState);
            const statTotal = input.leadership + input.strength + input.intel;

            if (
                input.leadership < statRule.min ||
                input.strength < statRule.min ||
                input.intel < statRule.min ||
                input.leadership > statRule.max ||
                input.strength > statRule.max ||
                input.intel > statRule.max
            ) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: '능력치 범위를 벗어났습니다.',
                });
            }

            if (statTotal > statRule.total) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `능력치 합이 ${statRule.total}을 초과했습니다.`,
                });
            }

            const personalityOptions = await loadPersonalityOptions();
            const personalityKeys = personalityOptions.map((trait) => trait.key);
            const resolveGeneralName = async (): Promise<string> => {
                if (joinPolicy.blockGeneralCreate !== 2) {
                    return input.name;
                }
                for (let attempt = 0; attempt < 5; attempt += 1) {
                    const candidate = randomBytes(5).toString('hex');
                    const exists = await ctx.db.general.findFirst({ where: { name: candidate } });
                    if (!exists) {
                        return candidate;
                    }
                }
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: '랜덤 장수명 생성에 실패했습니다.',
                });
            };

            const generalName = await resolveGeneralName();
            const chosenPersonality =
                input.character === 'Random'
                    ? pickFromList(personalityKeys, `${userId}:${generalName}`) ?? 'None'
                    : isPersonalityTraitKey(input.character)
                      ? input.character
                      : 'None';

            const createGeneral = async (db: DatabaseClient) => {
                const existing = await db.general.findFirst({ where: { userId } });
                if (existing) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: '이미 장수가 생성되어 있습니다.',
                    });
                }
                const nameExists = await db.general.findFirst({ where: { name: generalName } });
                if (nameExists) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '이미 존재하는 장수명입니다.',
                    });
                }

                const maxId = await db.general.aggregate({ _max: { id: true } });
                const nextId = (maxId._max.id ?? 0) + 1;
                const cityList = await db.city.findMany({
                    select: { id: true, level: true, nationId: true, name: true },
                    orderBy: { id: 'asc' },
                });
                if (!cityList.length) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: '도시 정보를 찾을 수 없습니다.',
                    });
                }
                const neutralCities = cityList.filter((city) => city.level >= 5 && city.level <= 6 && city.nationId === 0);
                const candidateCities =
                    neutralCities.length > 0 ? neutralCities : cityList.filter((city) => city.level >= 5 && city.level <= 6);
                if (!candidateCities.length) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: '생성 가능한 도시가 없습니다.',
                    });
                }

                let inheritRequiredPoint = 0;
                if (input.inheritCity !== undefined) {
                    inheritRequiredPoint += inheritConst.inheritBornCityPoint;
                }
                if (input.inheritSpecial !== undefined) {
                    inheritRequiredPoint += inheritConst.inheritBornSpecialPoint;
                }
                if (input.inheritTurntimeZone !== undefined) {
                    inheritRequiredPoint += inheritConst.inheritBornTurntimePoint;
                }
                if (inheritBonus && inheritBonus.reduce((acc, value) => acc + value, 0) > 0) {
                    inheritRequiredPoint += inheritConst.inheritBornStatPoint;
                }

                const currentPoint = await readInheritancePoint(db, userId, 'previous');
                if (currentPoint < inheritRequiredPoint) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '유산 포인트가 부족합니다.',
                    });
                }

                const hiddenSeed = String(asRecord(worldState.meta).hiddenSeed ?? 'inherit');
                const rng = new LiteHashDRBG(`${hiddenSeed}:MakeGeneral:${userId}:${generalName}`);

                const bonusStatSum = inheritBonus ? inheritBonus.reduce((acc, value) => acc + value, 0) : 0;
                const randomBonus =
                    !inheritBonus || bonusStatSum === 0
                        ? buildRandomBonus(
                              rng,
                              [input.leadership, input.strength, input.intel]
                          )
                        : (inheritBonus as [number, number, number]);

                const finalLeadership = input.leadership + randomBonus[0];
                const finalStrength = input.strength + randomBonus[1];
                const finalIntel = input.intel + randomBonus[2];
                const age = 20 + (randomBonus[0] + randomBonus[1] + randomBonus[2]) * 2 - nextRangeInt(rng, 0, 1);

                const selectedCity =
                    typeof input.inheritCity === 'number'
                        ? candidateCities.find((city) => city.id === input.inheritCity)
                        : null;
                if (input.inheritCity !== undefined && !selectedCity) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '지정한 도시를 찾을 수 없습니다.',
                    });
                }

                const cityIndex = nextRangeInt(rng, 0, candidateCities.length - 1);
                const cityId = (selectedCity ?? candidateCities[cityIndex] ?? candidateCities[0]).id;

                const defaultSpecialDomestic =
                    typeof configConst.defaultSpecialDomestic === 'string' ? configConst.defaultSpecialDomestic : 'None';
                const defaultSpecialWar =
                    typeof configConst.defaultSpecialWar === 'string' ? configConst.defaultSpecialWar : 'None';
                const retirementYear =
                    typeof configConst.retirementYear === 'number' && Number.isFinite(configConst.retirementYear)
                        ? configConst.retirementYear
                        : 80;
                const worldMeta = asRecord(worldState.meta);
                const scenarioMeta = asRecord(worldMeta.scenarioMeta);
                const startYear =
                    typeof scenarioMeta.startYear === 'number' && Number.isFinite(scenarioMeta.startYear)
                        ? scenarioMeta.startYear
                        : worldState.currentYear;
                const relativeYear = Math.max(
                    worldState.currentYear - startYear,
                    0
                );
                const scenarioId = Number(worldMeta.scenarioId ?? worldState.scenarioCode);
                const specialityAges = resolveJoinSpecialityAges({
                    retirementYear,
                    age,
                    relativeYear,
                    scenarioId,
                });

                const specialWar =
                    input.inheritSpecial && isWarTraitKey(input.inheritSpecial) ? input.inheritSpecial : defaultSpecialWar;

                const tickMinutes = Math.max(1, Math.round(worldState.tickSeconds / 60));
                const baseTime = alignToTurnBase(new Date(), tickMinutes);
                let turnTime = new Date(baseTime.getTime() + rng.nextFloat1() * tickMinutes * 60000);
                if (input.inheritTurntimeZone !== undefined) {
                    const offsetMinutes = input.inheritTurntimeZone * tickMinutes + rng.nextFloat1() * tickMinutes;
                    turnTime = new Date(baseTime.getTime() + offsetMinutes * 60000);
                }
                if (turnTime.getTime() <= Date.now()) {
                    turnTime = new Date(turnTime.getTime() + tickMinutes * 60000);
                }

                const logEntries: string[] = [];
                if (input.inheritSpecial && isWarTraitKey(input.inheritSpecial)) {
                    const [special] = await loadWarOptions([input.inheritSpecial]);
                    const specialName = special?.name ?? input.inheritSpecial;
                    logEntries.push(`${specialName} 전투 특기를 가진 천재 생성`);
                }
                if (input.inheritCity !== undefined && selectedCity) {
                    logEntries.push(`${selectedCity.name}에 장수 생성`);
                }
                if (inheritBonus && inheritBonus.reduce((acc, value) => acc + value, 0) > 0) {
                    logEntries.push(
                        `${inheritBonus[0]}, ${inheritBonus[1]}, ${inheritBonus[2]} 보너스 능력치로 생성`
                    );
                }
                if (input.inheritTurntimeZone !== undefined) {
                    const zones = buildTurnTimeZones(tickMinutes);
                    const zoneLabel = zones[input.inheritTurntimeZone];
                    if (zoneLabel) {
                        logEntries.push(`턴 시간 ${zoneLabel} 로 지정`);
                    }
                }

                const general = await db.general.create({
                    data: {
                        id: nextId,
                        userId,
                        name: generalName,
                        nationId: 0,
                        cityId,
                        troopId: 0,
                        npcState: 0,
                        leadership: finalLeadership,
                        strength: finalStrength,
                        intel: finalIntel,
                        personalCode: chosenPersonality ?? 'None',
                        specialCode: defaultSpecialDomestic,
                        special2Code: specialWar,
                        turnTime,
                        age,
                        startAge: age,
                        meta: {
                            createdBy: 'join',
                            ownerName: ctx.auth?.user.displayName ?? '',
                            killturn: 24,
                            specage: specialityAges.domestic,
                            specage2: specialityAges.war,
                        },
                    },
                });
                await db.generalAccessLog.upsert({
                    where: { generalId: general.id },
                    update: {
                        userId,
                        lastRefresh: new Date(),
                    },
                    create: {
                        generalId: general.id,
                        userId,
                        lastRefresh: new Date(),
                    },
                });

                if (inheritRequiredPoint > 0) {
                    await setInheritancePoint(db, userId, 'previous', currentPoint - inheritRequiredPoint);
                }
                for (const entry of logEntries) {
                    await appendInheritanceLog(db, userId, worldState.currentYear, worldState.currentMonth, entry);
                }

                return { ok: true, generalId: general.id };
            };

            return ctx.db.$transaction ? ctx.db.$transaction(createGeneral) : createGeneral(ctx.db);
        }),
    listPossessCandidates: authedProcedure
        .input(
            z.object({
                limit: z.number().int().min(1).max(50).optional(),
                offset: z.number().int().min(0).optional(),
            })
        )
        .query(async ({ ctx, input }) => {
            const limit = input.limit ?? 20;
            const offset = input.offset ?? 0;

            const candidates = await ctx.db.general.findMany({
                where: {
                    userId: null,
                    npcState: { gte: 2 },
                },
                orderBy: { id: 'asc' },
                skip: offset,
                take: limit,
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    nationId: true,
                    cityId: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    age: true,
                    officerLevel: true,
                    personalCode: true,
                    specialCode: true,
                    special2Code: true,
                    picture: true,
                    imageServer: true,
                },
            });

            const [nationRows, cityRows] = await Promise.all([
                ctx.db.nation.findMany({ select: { id: true, name: true, color: true } }),
                ctx.db.city.findMany({ select: { id: true, name: true } }),
            ]);
            const nationMap = new Map(nationRows.map((nation) => [nation.id, nation]));
            const cityMap = new Map(cityRows.map((city) => [city.id, city]));

            return candidates.map((candidate) => {
                const nation = nationMap.get(candidate.nationId);
                const city = cityMap.get(candidate.cityId);
                return {
                    id: candidate.id,
                    name: candidate.name,
                    npcState: candidate.npcState,
                    nation: nation
                        ? { id: nation.id, name: nation.name, color: nation.color }
                        : { id: 0, name: '재야', color: '#666666' },
                    city: city ? { id: city.id, name: city.name } : null,
                    stats: {
                        leadership: candidate.leadership,
                        strength: candidate.strength,
                        intelligence: candidate.intel,
                    },
                    age: candidate.age,
                    officerLevel: candidate.officerLevel,
                    personality: candidate.personalCode,
                    special: candidate.specialCode,
                    specialWar: candidate.special2Code,
                    picture: candidate.picture,
                    imageServer: candidate.imageServer,
                };
            });
        }),
    possessGeneral: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const existing = await ctx.db.general.findFirst({ where: { userId } });
            if (existing) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: '이미 장수가 생성되어 있습니다.',
                });
            }

            await ctx.db.$transaction!(async (db) => {
                const [candidate, worldState] = await Promise.all([
                    db.general.findUnique({
                        where: { id: input.generalId },
                        select: { npcState: true, meta: true },
                    }),
                    db.worldState.findFirst({
                        select: { currentYear: true, currentMonth: true },
                    }),
                ]);
                if (!candidate || candidate.npcState < 2 || !worldState) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: '빙의 가능한 장수를 찾지 못했습니다.',
                    });
                }

                const now = new Date();
                const updated = await db.general.updateMany({
                    where: {
                        id: input.generalId,
                        userId: null,
                        npcState: candidate.npcState,
                    },
                    data: {
                        userId,
                        npcState: 1,
                        meta: {
                            ...asRecord(candidate.meta),
                            npc_org: candidate.npcState,
                            owner_name: ctx.auth?.user.displayName ?? '',
                            pickYearMonth: worldState.currentYear * 12 + worldState.currentMonth - 1,
                            killturn: 6,
                            defence_train: 80,
                        },
                        updatedAt: now,
                    },
                });
                if (updated.count === 0) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: '빙의 가능한 장수를 찾지 못했습니다.',
                    });
                }
                await db.generalAccessLog.upsert({
                    where: { generalId: input.generalId },
                    update: {
                        userId,
                        lastRefresh: now,
                        refresh: 0,
                        refreshTotal: 0,
                        refreshScore: 0,
                        refreshScoreTotal: 0,
                    },
                    create: {
                        generalId: input.generalId,
                        userId,
                        lastRefresh: now,
                    },
                });
            });

            return { ok: true };
        }),
});
