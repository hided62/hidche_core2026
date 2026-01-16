import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { zWorldStateConfig, zWorldStateMeta } from './context.js';
import type { GameApiContext, WorldStateRow } from './context.js';
import { authedProcedure, procedure, router } from './trpc.js';
import { buildTurnCommandTable } from './turns/commandTable.js';
import {
    MAX_GENERAL_TURNS,
    MAX_NATION_TURNS,
    setGeneralTurn,
    setNationTurn,
    shiftGeneralTurns,
    shiftNationTurns,
} from './turns/reservedTurns.js';
import {
    MESSAGE_MAILBOX_NATIONAL_BASE,
    MESSAGE_MAILBOX_PUBLIC,
    sendMessage,
    type MessageDraft,
    type MessageRecordDraft,
    type MessageType,
} from '@sammo-ts/logic';
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
import { buildNationTarget, buildTargetFromGeneral, resolveNationInfo } from './messages/targets.js';
import {
    fetchMessagesFromMailbox,
    fetchOldMessagesFromMailbox,
    insertMessage,
    type MessageView,
} from './messages/store.js';
import { buildBattleSimJobPayload } from './battleSim/environment.js';
import { zBattleSimJobId, zBattleSimRequest } from './battleSim/schema.js';
import { loadWorldMap } from './maps/worldMap.js';
import { loadMapLayout } from './maps/mapLayout.js';

const zRunReason = z.enum(['schedule', 'manual', 'poke']);
const zMessageType = z.enum(['private', 'public', 'national', 'diplomacy']);

const zGeneralSettings = z.object({
    tnmt: z.number().int().optional(),
    defence_train: z.number().int().optional(),
    use_treatment: z.number().int().optional(),
    use_auto_nation_turn: z.number().int().optional(),
});

const zTurnRunBudget = z.object({
    budgetMs: z.number().int().positive(),
    maxGenerals: z.number().int().positive(),
    catchUpCap: z.number().int().positive(),
});

const buildShiftAmountSchema = (maxTurns: number) =>
    z
        .number()
        .int()
        .min(-(maxTurns - 1))
        .max(maxTurns - 1)
        .refine((value) => value !== 0, {
            message: 'Amount must be non-zero.',
        });

const toWorldStateSnapshot = (row: WorldStateRow) => ({
    scenarioCode: row.scenarioCode,
    currentYear: row.currentYear,
    currentMonth: row.currentMonth,
    tickSeconds: row.tickSeconds,
    config: row.config,
    meta: row.meta,
    updatedAt: row.updatedAt.toISOString(),
});

const getMyGeneral = async (ctx: Pick<GameApiContext, 'db' | 'auth'>) => {
    if (!ctx.auth?.user.id) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const general = await ctx.db.general.findFirst({
        where: { userId: ctx.auth.user.id },
    });
    if (!general) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'General not found' });
    }
    return general;
};

const DEFAULT_JOIN_STAT = {
    total: 165,
    min: 15,
    max: 80,
    bonusMin: 3,
    bonusMax: 5,
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

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

export const appRouter = router({
    health: router({
        ping: procedure.query(({ ctx }) => ({
            ok: true,
            profile: ctx.profile.name,
            now: new Date().toISOString(),
        })),
    }),
    lobby: router({
        info: procedure.query(async ({ ctx }) => {
            const rawWorldState = await ctx.db.worldState.findFirst();
            if (!rawWorldState) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'World state not found',
                });
            }

            const worldState = {
                ...rawWorldState,
                config: zWorldStateConfig.parse(rawWorldState.config),
                meta: zWorldStateMeta.parse(rawWorldState.meta),
            };

            const userCnt = await ctx.db.general.count({ where: { npcState: 0 } });
            const npcCnt = await ctx.db.general.count({ where: { npcState: { gt: 0 } } });
            const nationCnt = await ctx.db.nation.count({ where: { level: { gt: 0 } } });

            // myGeneral info if authenticated
            let myGeneral = null;
            if (ctx.auth?.user.id) {
                const general = await ctx.db.general.findFirst({
                    where: { userId: ctx.auth.user.id },
                    select: { name: true, picture: true },
                });
                if (general) {
                    myGeneral = {
                        name: general.name,
                        picture: general.picture,
                    };
                }
            }

            return {
                year: worldState.currentYear,
                month: worldState.currentMonth,
                userCnt,
                maxUserCnt: worldState.config.maxUserCnt ?? 500,
                npcCnt,
                nationCnt,
                turnTerm: worldState.tickSeconds / 60,
                fictionMode: worldState.config.fictionMode ?? '사실',
                starttime: worldState.meta.starttime ?? '',
                opentime: worldState.meta.opentime ?? '',
                turntime: worldState.meta.turntime ?? '',
                otherTextInfo: worldState.meta.otherTextInfo ?? '',
                isUnited: worldState.meta.isUnited ?? 0,
                myGeneral,
            };
        }),
    }),
    join: router({
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
                const chosenPersonality =
                    input.character === 'Random'
                        ? pickFromList(personalityKeys, `${userId}:${input.name}`) ?? 'None'
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
                    const nameExists = await db.general.findFirst({ where: { name: input.name } });
                    if (nameExists) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '이미 존재하는 장수명입니다.',
                        });
                    }

                    const maxId = await db.general.aggregate({ _max: { id: true } });
                    const nextId = (maxId._max.id ?? 0) + 1;
                    const cityList = await db.city.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
                    if (!cityList.length) {
                        throw new TRPCError({
                            code: 'PRECONDITION_FAILED',
                            message: '도시 정보를 찾을 수 없습니다.',
                        });
                    }
                    const cityIndex = hashString(userId) % cityList.length;
                    const cityId = cityList[cityIndex]?.id ?? cityList[0].id;

                    const general = await db.general.create({
                        data: {
                            id: nextId,
                            userId,
                            name: input.name,
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
    }),
    battle: router({
        simulate: procedure.input(zBattleSimRequest).mutation(async ({ ctx, input }) => {
            const worldState = await ctx.db.worldState.findFirst();
            if (!worldState) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: 'World state is not initialized.',
                });
            }

            const payload = await buildBattleSimJobPayload(worldState, input, ctx.profile.id);
            return ctx.battleSim.simulate(payload);
        }),
        getSimulation: procedure.input(zBattleSimJobId).query(async ({ ctx, input }) => {
            const result = await ctx.battleSim.getSimulationResult(input.jobId);
            if (!result) {
                return { status: 'queued', jobId: input.jobId };
            }
            return { status: 'completed', jobId: input.jobId, payload: result };
        }),
    }),
    world: router({
        getState: procedure.query(async ({ ctx }) => {
            const state = await ctx.db.worldState.findFirst();
            return state ? toWorldStateSnapshot(state) : null;
        }),
        getMapLayout: procedure.query(async ({ ctx }) => {
            return loadMapLayout(ctx.profile.scenario);
        }),
        getMap: procedure
            .input(
                z.object({
                    generalId: z.number().int().positive().optional(),
                    neutralView: z.boolean().optional(),
                    showMe: z.boolean().optional(),
                    useCache: z.boolean().optional(),
                })
            )
            .query(async ({ ctx, input }) => {
                const map = await loadWorldMap(ctx, input);
                if (!map) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: 'World state is not initialized.',
                    });
                }
                return map;
            }),
    }),
    turns: router({
        getCommandTable: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                })
            )
            .query(async ({ ctx, input }) => {
                const [worldState, general] = await Promise.all([
                    ctx.db.worldState.findFirst(),
                    ctx.db.general.findUnique({ where: { id: input.generalId } }),
                ]);

                if (!worldState) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: 'World state is not initialized.',
                    });
                }

                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }

                const [city, nation, nationGenerals] = await Promise.all([
                    general.cityId > 0
                        ? ctx.db.city.findUnique({
                              where: { id: general.cityId },
                          })
                        : null,
                    general.nationId > 0
                        ? ctx.db.nation.findUnique({
                              where: { id: general.nationId },
                          })
                        : null,
                    general.nationId > 0
                        ? ctx.db.general.findMany({
                              where: { nationId: general.nationId },
                          })
                        : Promise.resolve(null),
                ]);

                return buildTurnCommandTable({
                    worldState,
                    general,
                    city,
                    nation,
                    nationGenerals,
                });
            }),
        reserved: router({
            setGeneral: authedProcedure
                .input(
                    z.object({
                        generalId: z.number().int().positive(),
                        turnIndex: z
                            .number()
                            .int()
                            .min(0)
                            .max(MAX_GENERAL_TURNS - 1),
                        action: z.string().min(1),
                        args: z.unknown().optional(),
                    })
                )
                .mutation(async ({ ctx, input }) => {
                    const general = await ctx.db.general.findUnique({
                        where: { id: input.generalId },
                    });
                    if (!general) {
                        throw new TRPCError({
                            code: 'NOT_FOUND',
                            message: 'General not found.',
                        });
                    }

                    const turns = await setGeneralTurn(
                        ctx.db,
                        input.generalId,
                        input.turnIndex,
                        input.action,
                        input.args
                    );
                    return { ok: true, turns };
                }),
            shiftGeneral: authedProcedure
                .input(
                    z.object({
                        generalId: z.number().int().positive(),
                        amount: buildShiftAmountSchema(MAX_GENERAL_TURNS),
                    })
                )
                .mutation(async ({ ctx, input }) => {
                    const general = await ctx.db.general.findUnique({
                        where: { id: input.generalId },
                    });
                    if (!general) {
                        throw new TRPCError({
                            code: 'NOT_FOUND',
                            message: 'General not found.',
                        });
                    }

                    const turns = await shiftGeneralTurns(ctx.db, input.generalId, input.amount);
                    return { ok: true, turns };
                }),
            setNation: authedProcedure
                .input(
                    z.object({
                        generalId: z.number().int().positive(),
                        turnIndex: z
                            .number()
                            .int()
                            .min(0)
                            .max(MAX_NATION_TURNS - 1),
                        action: z.string().min(1),
                        args: z.unknown().optional(),
                    })
                )
                .mutation(async ({ ctx, input }) => {
                    const general = await ctx.db.general.findUnique({
                        where: { id: input.generalId },
                    });
                    if (!general) {
                        throw new TRPCError({
                            code: 'NOT_FOUND',
                            message: 'General not found.',
                        });
                    }
                    if (general.nationId <= 0) {
                        throw new TRPCError({
                            code: 'PRECONDITION_FAILED',
                            message: 'General is not part of a nation.',
                        });
                    }
                    if (general.officerLevel < 5) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'General is not an officer.',
                        });
                    }

                    const turns = await setNationTurn(
                        ctx.db,
                        general.nationId,
                        general.officerLevel,
                        input.turnIndex,
                        input.action,
                        input.args
                    );
                    return { ok: true, turns };
                }),
            shiftNation: authedProcedure
                .input(
                    z.object({
                        generalId: z.number().int().positive(),
                        amount: buildShiftAmountSchema(MAX_NATION_TURNS),
                    })
                )
                .mutation(async ({ ctx, input }) => {
                    const general = await ctx.db.general.findUnique({
                        where: { id: input.generalId },
                    });
                    if (!general) {
                        throw new TRPCError({
                            code: 'NOT_FOUND',
                            message: 'General not found.',
                        });
                    }
                    if (general.nationId <= 0) {
                        throw new TRPCError({
                            code: 'PRECONDITION_FAILED',
                            message: 'General is not part of a nation.',
                        });
                    }
                    if (general.officerLevel < 5) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'General is not an officer.',
                        });
                    }

                    const turns = await shiftNationTurns(ctx.db, general.nationId, general.officerLevel, input.amount);
                    return { ok: true, turns };
                }),
        }),
    }),
    messages: router({
        getRecent: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    sequence: z.number().int().optional(),
                })
            )
            .query(async ({ ctx, input }) => {
                const general = await ctx.db.general.findUnique({
                    where: { id: input.generalId },
                });
                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }

                const sequence = input.sequence ?? -1;
                const nationId = general.nationId;
                const mailboxes = {
                    private: general.id,
                    public: MESSAGE_MAILBOX_PUBLIC,
                    national: MESSAGE_MAILBOX_NATIONAL_BASE + nationId,
                    diplomacy: MESSAGE_MAILBOX_NATIONAL_BASE + nationId,
                } satisfies Record<MessageType, number>;

                const [privateMessages, publicMessages, nationalMessages, diplomacyMessages] = await Promise.all([
                    fetchMessagesFromMailbox({
                        db: ctx.db,
                        mailbox: mailboxes.private,
                        msgType: 'private',
                        limit: 15,
                        fromSeq: sequence,
                    }),
                    fetchMessagesFromMailbox({
                        db: ctx.db,
                        mailbox: mailboxes.public,
                        msgType: 'public',
                        limit: 15,
                        fromSeq: sequence,
                    }),
                    fetchMessagesFromMailbox({
                        db: ctx.db,
                        mailbox: mailboxes.national,
                        msgType: 'national',
                        limit: 15,
                        fromSeq: sequence,
                    }),
                    fetchMessagesFromMailbox({
                        db: ctx.db,
                        mailbox: mailboxes.diplomacy,
                        msgType: 'diplomacy',
                        limit: 15,
                        fromSeq: sequence,
                    }),
                ]);

                const messageBuckets: Record<MessageType, MessageView[]> = {
                    private: privateMessages,
                    public: publicMessages,
                    national: nationalMessages,
                    diplomacy: diplomacyMessages,
                };

                let nextSequence = sequence;
                let minSequence = sequence;
                let lastType: MessageType | null = null;
                const updateSequence = (type: MessageType, messages: Array<{ id: number }>) => {
                    for (const message of messages) {
                        if (message.id > nextSequence) {
                            nextSequence = message.id;
                        }
                        if (message.id <= minSequence) {
                            minSequence = message.id;
                            lastType = type;
                        }
                    }
                };

                updateSequence('private', privateMessages);
                updateSequence('public', publicMessages);
                updateSequence('national', nationalMessages);
                updateSequence('diplomacy', diplomacyMessages);

                if (lastType === 'private' && messageBuckets.private.length > 0) {
                    messageBuckets.private.pop();
                } else if (lastType === 'public' && messageBuckets.public.length > 0) {
                    messageBuckets.public.pop();
                } else if (lastType === 'national' && messageBuckets.national.length > 0) {
                    messageBuckets.national.pop();
                } else if (lastType === 'diplomacy' && messageBuckets.diplomacy.length > 0) {
                    messageBuckets.diplomacy.pop();
                }

                return {
                    result: true,
                    ...messageBuckets,
                    sequence: nextSequence,
                    nationId: nationId,
                    generalName: general.name,
                    latestRead: {
                        diplomacy: 0,
                        private: 0,
                    },
                };
            }),
        getOld: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    to: z.number().int().positive(),
                    type: zMessageType,
                })
            )
            .query(async ({ ctx, input }) => {
                const general = await ctx.db.general.findUnique({
                    where: { id: input.generalId },
                });
                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }

                const nationId = general.nationId;
                const mailboxes = {
                    private: general.id,
                    public: MESSAGE_MAILBOX_PUBLIC,
                    national: MESSAGE_MAILBOX_NATIONAL_BASE + nationId,
                    diplomacy: MESSAGE_MAILBOX_NATIONAL_BASE + nationId,
                } satisfies Record<MessageType, number>;

                const messageBuckets: Record<MessageType, MessageView[]> = {
                    private: [],
                    public: [],
                    national: [],
                    diplomacy: [],
                };

                const messages = await fetchOldMessagesFromMailbox({
                    db: ctx.db,
                    mailbox: mailboxes[input.type],
                    msgType: input.type,
                    toSeq: input.to,
                    limit: 15,
                });
                messageBuckets[input.type] = messages;

                return {
                    result: true,
                    keepRecent: true,
                    sequence: 0,
                    nationId,
                    generalName: general.name,
                    ...messageBuckets,
                };
            }),
        send: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    mailbox: z.number().int(),
                    text: z.string().min(1),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await ctx.db.general.findUnique({
                    where: { id: input.generalId },
                });
                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }

                const src = await buildTargetFromGeneral(ctx.db, general);
                const now = new Date();
                const validUntil = new Date('9999-12-31T00:00:00Z');

                let msgType: MessageType;
                let dest = src;

                if (input.mailbox === MESSAGE_MAILBOX_PUBLIC) {
                    msgType = 'public';
                } else if (input.mailbox >= MESSAGE_MAILBOX_NATIONAL_BASE) {
                    const destNationId = input.mailbox - MESSAGE_MAILBOX_NATIONAL_BASE;
                    if (destNationId <= 0) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Invalid nation mailbox.',
                        });
                    }
                    const nationInfo = await resolveNationInfo(ctx.db, destNationId);
                    dest = buildNationTarget(destNationId, nationInfo.name, nationInfo.color);
                    msgType = destNationId === general.nationId ? 'national' : 'diplomacy';
                } else if (input.mailbox > 0) {
                    const destGeneral = await ctx.db.general.findUnique({
                        where: { id: input.mailbox },
                    });
                    if (!destGeneral) {
                        throw new TRPCError({
                            code: 'NOT_FOUND',
                            message: 'Destination general not found.',
                        });
                    }
                    dest = await buildTargetFromGeneral(ctx.db, destGeneral);
                    msgType = 'private';
                } else {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Invalid mailbox.',
                    });
                }

                const draft: MessageDraft = {
                    msgType,
                    src,
                    dest,
                    text: input.text,
                    time: now,
                    validUntil,
                    option: {},
                };

                const result = await sendMessage(
                    {
                        insertMessage: (draft: MessageRecordDraft) => insertMessage(ctx.db, draft),
                    },
                    draft
                );

                return { msgType, msgId: result.receiverId };
            }),
    }),
    troop: router({
        join: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    troopId: z.number().int().positive(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const result = await ctx.turnDaemon.requestCommand({
                    type: 'troopJoin',
                    generalId: input.generalId,
                    troopId: input.troopId,
                });
                if (!result) {
                    throw new TRPCError({
                        code: 'TIMEOUT',
                        message: 'Turn daemon did not respond.',
                    });
                }
                if (result.type !== 'troopJoin') {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: 'Unexpected turn daemon response.',
                    });
                }
                if (!result.ok) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: result.reason,
                    });
                }

                return { ok: true };
            }),
        exit: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const result = await ctx.turnDaemon.requestCommand({
                    type: 'troopExit',
                    generalId: input.generalId,
                });
                if (!result) {
                    throw new TRPCError({
                        code: 'TIMEOUT',
                        message: 'Turn daemon did not respond.',
                    });
                }
                if (result.type !== 'troopExit') {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: 'Unexpected turn daemon response.',
                    });
                }
                if (!result.ok) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: result.reason,
                    });
                }

                return { ok: true, wasLeader: result.wasLeader };
            }),
    }),
    general: router({
        me: authedProcedure.query(async ({ ctx }) => {
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
                },
            });

            if (!general) {
                return null;
            }

            const [city, nation] = await Promise.all([
                general.cityId > 0
                    ? ctx.db.city.findUnique({
                          where: { id: general.cityId },
                          select: {
                              id: true,
                              name: true,
                              level: true,
                              nationId: true,
                              population: true,
                              agriculture: true,
                              commerce: true,
                              security: true,
                              defence: true,
                              wall: true,
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
                          },
                      })
                    : null,
            ]);

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
                    stats: {
                        leadership: general.leadership,
                        strength: general.strength,
                        intelligence: general.intel,
                    },
                    gold: general.gold,
                    rice: general.rice,
                    crew: general.crew,
                    train: general.train,
                    atmos: general.atmos,
                    injury: general.injury,
                    experience: general.experience,
                    dedication: general.dedication,
                },
                city,
                nation,
            };
        }),
        dieOnPrestart: authedProcedure.mutation(async ({ ctx }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'dieOnPrestart',
                generalId: general.id,
            });
            if (!result || result.type !== 'dieOnPrestart') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!result.ok) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
            }
            return { ok: true };
        }),
        buildNationCandidate: authedProcedure.mutation(async ({ ctx }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'buildNationCandidate',
                generalId: general.id,
            });
            if (!result || result.type !== 'buildNationCandidate') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!result.ok) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
            }
            return { ok: true };
        }),
        instantRetreat: authedProcedure.mutation(async ({ ctx }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'instantRetreat',
                generalId: general.id,
            });
            if (!result || result.type !== 'instantRetreat') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!result.ok) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
            }
            return { ok: true };
        }),
        vacation: authedProcedure.mutation(async ({ ctx }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'vacation',
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
        setMySetting: authedProcedure.input(zGeneralSettings).mutation(async ({ ctx, input }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'setMySetting',
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
        dropItem: authedProcedure.input(z.object({ itemType: z.string() })).mutation(async ({ ctx, input }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'dropItem',
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
    }),
    nation: router({
        changePermission: authedProcedure
            .input(
                z.object({
                    isAmbassador: z.boolean(),
                    targetGeneralIds: z.array(z.number().int().positive()),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await getMyGeneral(ctx);
                const result = await ctx.turnDaemon.requestCommand({
                    type: 'changePermission',
                    generalId: general.id,
                    isAmbassador: input.isAmbassador,
                    targetGeneralIds: input.targetGeneralIds,
                });
                if (!result || result.type !== 'changePermission') {
                    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
                }
                if (!result.ok) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
                }
                return { ok: true };
            }),
        kick: authedProcedure
            .input(z.object({ destGeneralId: z.number().int().positive() }))
            .mutation(async ({ ctx, input }) => {
                const general = await getMyGeneral(ctx);
                const result = await ctx.turnDaemon.requestCommand({
                    type: 'kick',
                    generalId: general.id,
                    destGeneralId: input.destGeneralId,
                });
                if (!result || result.type !== 'kick') {
                    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
                }
                if (!result.ok) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
                }
                return { ok: true };
            }),
        appoint: authedProcedure
            .input(
                z.object({
                    destGeneralId: z.number().int().nonnegative(),
                    destCityId: z.number().int().nonnegative(),
                    officerLevel: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await getMyGeneral(ctx);
                const result = await ctx.turnDaemon.requestCommand({
                    type: 'appoint',
                    generalId: general.id,
                    destGeneralId: input.destGeneralId,
                    destCityId: input.destCityId,
                    officerLevel: input.officerLevel,
                });
                if (!result || result.type !== 'appoint') {
                    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
                }
                if (!result.ok) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
                }
                return { ok: true };
            }),
    }),
    turnDaemon: router({
        run: procedure
            .input(
                z.object({
                    reason: zRunReason,
                    targetTime: z.string().min(1).optional(),
                    budget: zTurnRunBudget.optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const requestId = await ctx.turnDaemon.sendCommand({
                    type: 'run',
                    reason: input.reason,
                    targetTime: input.targetTime,
                    budget: input.budget,
                });
                return { accepted: true, requestId };
            }),
        pause: procedure
            .input(
                z
                    .object({
                        reason: z.string().min(1).optional(),
                    })
                    .optional()
            )
            .mutation(async ({ ctx, input }) => {
                const requestId = await ctx.turnDaemon.sendCommand({
                    type: 'pause',
                    reason: input?.reason,
                });
                return { accepted: true, requestId };
            }),
        resume: procedure
            .input(
                z
                    .object({
                        reason: z.string().min(1).optional(),
                    })
                    .optional()
            )
            .mutation(async ({ ctx, input }) => {
                const requestId = await ctx.turnDaemon.sendCommand({
                    type: 'resume',
                    reason: input?.reason,
                });
                return { accepted: true, requestId };
            }),
        status: procedure
            .input(
                z
                    .object({
                        timeoutMs: z.number().int().positive().optional(),
                    })
                    .optional()
            )
            .query(async ({ ctx, input }) => {
                return ctx.turnDaemon.requestStatus(input?.timeoutMs);
            }),
    }),
});

export type AppRouter = typeof appRouter;
