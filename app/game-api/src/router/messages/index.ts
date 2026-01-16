import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '../../trpc.js';
import {
    MESSAGE_MAILBOX_NATIONAL_BASE,
    MESSAGE_MAILBOX_PUBLIC,
    sendMessage,
    type MessageDraft,
    type MessageRecordDraft,
    type MessageType,
} from '@sammo-ts/logic';
import { buildNationTarget, buildTargetFromGeneral, resolveNationInfo } from '../../messages/targets.js';
import {
    fetchMessagesFromMailbox,
    fetchOldMessagesFromMailbox,
    insertMessage,
    type MessageView,
} from '../../messages/store.js';

const zMessageType = z.enum(['private', 'public', 'national', 'diplomacy']);

export const messagesRouter = router({
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
});
