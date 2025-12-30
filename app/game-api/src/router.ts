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
import type { BattleSimRequestPayload } from './battleSim/types.js';

const zRunReason = z.enum(['schedule', 'manual', 'poke']);
const zMessageType = z.enum(['private', 'public', 'national', 'diplomacy']);

const zTurnRunBudget = z.object({
    budgetMs: z.number().int().positive(),
    maxGenerals: z.number().int().positive(),
    catchUpCap: z.number().int().positive(),
});

const zBattleSimGeneral = z.object({
    no: z.number().int().positive(),
    name: z.string().min(1),
    nation: z.number().int().positive(),
    turntime: z.string().min(1),
    personal: z.string().nullable(),
    special2: z.string().nullable(),
    crew: z.number().int().min(0),
    crewtype: z.number().int().positive(),
    atmos: z.number().int().min(0),
    train: z.number().int().min(0),
    intel: z.number().int().min(0),
    intel_exp: z.number().int().min(0),
    book: z.string().nullable(),
    strength: z.number().int().min(0),
    strength_exp: z.number().int().min(0),
    weapon: z.string().nullable(),
    injury: z.number().int().min(0),
    leadership: z.number().int().min(0),
    leadership_exp: z.number().int().min(0),
    horse: z.string().nullable(),
    item: z.string().nullable(),
    explevel: z.number().int().min(0),
    experience: z.number().int().min(0),
    dedication: z.number().int().min(0),
    officer_level: z.number().int().min(1),
    officer_city: z.number().int().positive(),
    gold: z.number().int().min(0),
    rice: z.number().int().min(0),
    dex1: z.number().int().min(0),
    dex2: z.number().int().min(0),
    dex3: z.number().int().min(0),
    dex4: z.number().int().min(0),
    dex5: z.number().int().min(0),
    recent_war: z.string().nullable(),
    warnum: z.number().int().min(0),
    killnum: z.number().int().min(0),
    killcrew: z.number().int().min(0),
    inheritBuff: z.union([z.record(z.string(), z.number()), z.array(z.number())]).optional(),
});

const zBattleSimCity = z.object({
    city: z.number().int().positive(),
    nation: z.number().int().min(0),
    supply: z.number().int().min(0),
    name: z.string().min(1),
    pop: z.number().min(0),
    agri: z.number().min(0),
    comm: z.number().min(0),
    secu: z.number().min(0),
    def: z.number().min(0),
    wall: z.number().min(0),
    trust: z.number().min(0),
    level: z.number().int().min(1),
    pop_max: z.number().min(0),
    agri_max: z.number().min(0),
    comm_max: z.number().min(0),
    secu_max: z.number().min(0),
    def_max: z.number().min(0),
    wall_max: z.number().min(0),
    dead: z.number().min(0),
    state: z.number().int().min(0),
    conflict: z.string(),
});

const zBattleSimNation = z.object({
    type: z.string().min(1),
    tech: z.number().min(0),
    level: z.number().int().min(1),
    capital: z.number().int().min(0),
    nation: z.number().int().min(0),
    name: z.string().min(1),
    gold: z.number().min(0),
    rice: z.number().min(0),
    gennum: z.number().int().min(1),
});

const zBattleSimRequest: z.ZodType<BattleSimRequestPayload> = z.object({
    action: z.enum(['reorder', 'battle']),
    seed: z.string().optional(),
    repeatCnt: z.number().int().min(1).max(1000),
    year: z.number().int().min(0),
    month: z.number().int().min(1).max(12),
    attackerGeneral: zBattleSimGeneral,
    attackerCity: zBattleSimCity,
    attackerNation: zBattleSimNation,
    defenderGenerals: z.array(zBattleSimGeneral),
    defenderCity: zBattleSimCity,
    defenderNation: zBattleSimNation,
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

export const appRouter = router({
    health: router({
        ping: procedure.query(({ ctx }) => ({
            ok: true,
            profile: ctx.profile.name,
            now: new Date().toISOString(),
        })),
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
            .input(
                z.object({
                    jobId: z.string().min(1),
                })
            )
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

                const [city, nation] = await Promise.all([
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
                ]);

                return buildTurnCommandTable({
                    worldState,
                    general,
                    city,
                    nation,
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
