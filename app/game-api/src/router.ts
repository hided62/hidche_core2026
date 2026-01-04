import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { WorldStateRow } from './context.js';
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
    z.number()
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

const getMyGeneral = async (ctx: { db: any, auth: any }) => {
    if (!ctx.auth?.user.id) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const general = await ctx.db.general.findFirst({
        where: { userId: parseInt(ctx.auth.user.id) },
    });
    if (!general) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'General not found' });
    }
    return general;
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
            const worldState = await ctx.db.worldState.findFirst();
            if (!worldState) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'World state not found',
                });
            }

            const userCnt = await ctx.db.general.count({ where: { npcState: 0 } });
            const npcCnt = await ctx.db.general.count({ where: { npcState: { gt: 0 } } });
            const nationCnt = await ctx.db.nation.count({ where: { level: { gt: 0 } } });

            // myGeneral info if authenticated
            let myGeneral = null;
            if (ctx.auth?.user.id) {
                const general = await ctx.db.general.findFirst({
                    where: { userId: ctx.auth.user.id },
                    select: { name: true, picture: true }
                });
                if (general) {
                    myGeneral = {
                        name: (general as any).name,
                        picture: (general as any).picture,
                    };
                }
            }

            return {
                year: worldState.currentYear,
                month: worldState.currentMonth,
                userCnt,
                maxUserCnt: (worldState.config as any).maxUserCnt ?? 500,
                npcCnt,
                nationCnt,
                turnTerm: worldState.tickSeconds / 60,
                fictionMode: (worldState.config as any).fictionMode ?? '사실',
                starttime: (worldState.meta as any).starttime ?? '',
                opentime: (worldState.meta as any).opentime ?? '',
                turntime: (worldState.meta as any).turntime ?? '',
                otherTextInfo: (worldState.meta as any).otherTextInfo ?? '',
                isUnited: (worldState.meta as any).isUnited ?? 0,
                myGeneral,
            };
        }),
    }),
    battle: router({
        simulate: procedure
            .input(zBattleSimRequest)
            .mutation(async ({ ctx, input }) => {
                const worldState = await ctx.db.worldState.findFirst();
                if (!worldState) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: 'World state is not initialized.',
                    });
                }

                const payload = await buildBattleSimJobPayload(
                    worldState,
                    input,
                    ctx.profile.id
                );
                return ctx.battleSim.simulate(payload);
            }),
        getSimulation: procedure
            .input(zBattleSimJobId)
            .query(async ({ ctx, input }) => {
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
                        turnIndex: z.number()
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

                    const turns = await shiftGeneralTurns(
                        ctx.db,
                        input.generalId,
                        input.amount
                    );
                    return { ok: true, turns };
                }),
            setNation: authedProcedure
                .input(
                    z.object({
                        generalId: z.number().int().positive(),
                        turnIndex: z.number()
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

                    const turns = await shiftNationTurns(
                        ctx.db,
                        general.nationId,
                        general.officerLevel,
                        input.amount
                    );
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

                const [privateMessages, publicMessages, nationalMessages, diplomacyMessages] =
                    await Promise.all([
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
                } else if (
                    lastType === 'public' &&
                    messageBuckets.public.length > 0
                ) {
                    messageBuckets.public.pop();
                } else if (
                    lastType === 'national' &&
                    messageBuckets.national.length > 0
                ) {
                    messageBuckets.national.pop();
                } else if (
                    lastType === 'diplomacy' &&
                    messageBuckets.diplomacy.length > 0
                ) {
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
                    const destNationId =
                        input.mailbox - MESSAGE_MAILBOX_NATIONAL_BASE;
                    if (destNationId <= 0) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Invalid nation mailbox.',
                        });
                    }
                    const nationInfo = await resolveNationInfo(
                        ctx.db,
                        destNationId
                    );
                    dest = buildNationTarget(
                        destNationId,
                        nationInfo.name,
                        nationInfo.color
                    );
                    msgType =
                        destNationId === general.nationId
                            ? 'national'
                            : 'diplomacy';
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
                        insertMessage: (draft: MessageRecordDraft) =>
                            insertMessage(ctx.db, draft),
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
        setMySetting: authedProcedure
            .input(zGeneralSettings)
            .mutation(async ({ ctx, input }) => {
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
        dropItem: authedProcedure
            .input(z.object({ itemType: z.string() }))
            .mutation(async ({ ctx, input }) => {
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
            .input(z.object({
                isAmbassador: z.boolean(),
                targetGeneralIds: z.array(z.number().int().positive()),
            }))
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
            .input(z.object({
                destGeneralId: z.number().int().nonnegative(),
                destCityId: z.number().int().nonnegative(),
                officerLevel: z.number().int().nonnegative(),
            }))
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
                z.object({
                    reason: z.string().min(1).optional(),
                }).optional()
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
                z.object({
                    reason: z.string().min(1).optional(),
                }).optional()
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
                z.object({
                    timeoutMs: z.number().int().positive().optional(),
                }).optional()
            )
            .query(async ({ ctx, input }) => {
                return ctx.turnDaemon.requestStatus(input?.timeoutMs);
            }),
    }),
});

export type AppRouter = typeof appRouter;
