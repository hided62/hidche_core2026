import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import type { WorldStateRow } from '../../context.js';
import { authedProcedure, router } from '../../trpc.js';
import { asNumber, asRecord, asStringArray, parseBooleanWithFallback } from '@sammo-ts/common';
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

const DEFAULT_JOIN_STAT = {
    total: 165,
    min: 15,
    max: 80,
    bonusMin: 3,
    bonusMax: 5,
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

            return ctx.db.$transaction(async (db) => {
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
                    select: { id: true, level: true },
                    orderBy: { id: 'asc' },
                });
                if (!cityList.length) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: '도시 정보를 찾을 수 없습니다.',
                    });
                }
                // 통합 테스트 전용: ENV로 지정한 경우에만 도시 지정 허용.
                const allowCityOverride = parseBooleanWithFallback(process.env.INTEGRATION_JOIN_ALLOW_CITY, false);
                if (allowCityOverride && typeof input.inheritCity === 'number') {
                    const override = cityList.find((city) => city.id === input.inheritCity);
                    if (!override) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: '지정한 도시를 찾을 수 없습니다.',
                        });
                    }
                    if (override.level !== 5 && override.level !== 6) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: '통합 테스트에서는 소성/중성 도시만 지정할 수 있습니다.',
                        });
                    }
                    const general = await db.general.create({
                        data: {
                            id: nextId,
                            userId,
                            name: generalName,
                            nationId: 0,
                            cityId: override.id,
                            troopId: 0,
                            npcState: 0,
                            leadership: input.leadership,
                            strength: input.strength,
                            intel: input.intel,
                            personalCode: chosenPersonality ?? 'None',
                            specialCode: 'None',
                            special2Code: 'None',
                            turnTime: new Date(),
                            meta: {
                                createdBy: 'join',
                            },
                        },
                    });

                    return { ok: true, generalId: general.id };
                }

                const cityIndex = hashString(userId) % cityList.length;
                const cityId = cityList[cityIndex]?.id ?? cityList[0].id;

                const general = await db.general.create({
                    data: {
                        id: nextId,
                        userId,
                        name: generalName,
                        nationId: 0,
                        cityId,
                        troopId: 0,
                        npcState: 0,
                        leadership: input.leadership,
                        strength: input.strength,
                        intel: input.intel,
                        personalCode: chosenPersonality ?? 'None',
                        specialCode: 'None',
                        special2Code: 'None',
                        turnTime: new Date(),
                        meta: {
                            createdBy: 'join',
                        },
                    },
                });

                return { ok: true, generalId: general.id };
            });
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

            const updated = await ctx.db.general.updateMany({
                where: {
                    id: input.generalId,
                    userId: null,
                    npcState: { gte: 2 },
                },
                data: {
                    userId,
                    npcState: 1,
                    updatedAt: new Date(),
                },
            });

            if (updated.count === 0) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: '빙의 가능한 장수를 찾지 못했습니다.',
                });
            }

            return { ok: true };
        }),
});
