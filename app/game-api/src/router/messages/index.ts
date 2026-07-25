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
    fetchMessageById,
    invalidateMessages,
    insertMessage,
    type MessageView,
} from '../../messages/store.js';
import { publishRealtimeEvent } from '../../realtime/publisher.js';
import { getOwnedGeneral } from '../shared/general.js';
import { resolveNationPermission } from '../nation/shared.js';

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
            const general = await getOwnedGeneral(ctx, input.generalId);

            const sequence = input.sequence ?? -1;
            const nationId = general.nationId;
            const mailboxes = {
                private: general.id,
                public: MESSAGE_MAILBOX_PUBLIC,
                national: MESSAGE_MAILBOX_NATIONAL_BASE + nationId,
                diplomacy: MESSAGE_MAILBOX_NATIONAL_BASE + nationId,
            } satisfies Record<MessageType, number>;

            const [privateMessages, publicMessages, nationalMessages, diplomacyMessages, readState] = await Promise.all(
                [
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
                    ctx.db.messageReadState.findUnique({ where: { generalId: general.id } }),
                ]
            );

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
                    diplomacy: readState?.latestDiplomacyMessage ?? 0,
                    private: readState?.latestPrivateMessage ?? 0,
                },
            };
        }),
    getContacts: authedProcedure
        .input(z.object({ generalId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
            await getOwnedGeneral(ctx, input.generalId);
            const [nations, generals] = await Promise.all([
                ctx.db.nation.findMany({
                    select: { id: true, name: true, color: true, meta: true },
                    orderBy: { id: 'asc' },
                }),
                ctx.db.general.findMany({
                    where: { npcState: { lt: 2 } },
                    select: {
                        id: true,
                        name: true,
                        nationId: true,
                        officerLevel: true,
                        npcState: true,
                        meta: true,
                        penalty: true,
                    },
                    orderBy: { id: 'asc' },
                }),
            ]);
            const nationMeta = new Map(nations.map((nation) => [nation.id, nation.meta]));
            const grouped = new Map<number, Array<[number, string, number]>>();
            for (const general of generals) {
                let flags = 0;
                if (general.officerLevel === 12) flags |= 1;
                if (general.npcState === 1) flags |= 2;
                if (resolveNationPermission(general, nationMeta.get(general.nationId) ?? {}, false) === 4) flags |= 4;
                const list = grouped.get(general.nationId) ?? [];
                list.push([general.id, general.name, flags]);
                grouped.set(general.nationId, list);
            }
            const nationList = [
                { id: 0, name: '재야', color: '#000000', meta: {} },
                ...nations.filter((nation) => nation.id !== 0),
            ];
            return {
                nation: nationList.map((nation) => ({
                    mailbox: MESSAGE_MAILBOX_NATIONAL_BASE + nation.id,
                    name: nation.name,
                    color: nation.color,
                    general: grouped.get(nation.id) ?? [],
                })),
            };
        }),
    readLatest: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
                type: z.enum(['private', 'diplomacy']),
                messageId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const general = await getOwnedGeneral(ctx, input.generalId);
            const privateValue = input.type === 'private' ? input.messageId : 0;
            const diplomacyValue = input.type === 'diplomacy' ? input.messageId : 0;
            await ctx.db.$executeRaw`
                INSERT INTO message_read_state (
                    general_id,
                    latest_private_message,
                    latest_diplomacy_message,
                    updated_at
                )
                VALUES (${general.id}, ${privateValue}, ${diplomacyValue}, NOW())
                ON CONFLICT (general_id) DO UPDATE SET
                    latest_private_message = GREATEST(
                        message_read_state.latest_private_message,
                        EXCLUDED.latest_private_message
                    ),
                    latest_diplomacy_message = GREATEST(
                        message_read_state.latest_diplomacy_message,
                        EXCLUDED.latest_diplomacy_message
                    ),
                    updated_at = NOW()
            `;
            return { ok: true };
        }),
    delete: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
                messageId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const general = await getOwnedGeneral(ctx, input.generalId);
            const message = await fetchMessageById(ctx.db, input.messageId);
            if (!message) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '메시지가 없습니다.' });
            }
            if (message.payload.src.generalId !== general.id) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '본인의 메시지만 삭제할 수 있습니다.' });
            }
            if (message.msgType === 'diplomacy' || message.payload.option?.deletable === false) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '삭제할 수 없는 메시지입니다.' });
            }
            if (Date.now() - message.time.getTime() > 5 * 60 * 1000) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '5분 이내의 메시지만 삭제할 수 있습니다.' });
            }
            const receiverMessageId = message.payload.option?.receiverMessageID;
            const ids = [message.id, ...(typeof receiverMessageId === 'number' ? [receiverMessageId] : [])];
            await invalidateMessages(ctx.db, ids);
            return { ok: true, deletedIds: ids };
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
            const general = await getOwnedGeneral(ctx, input.generalId);

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
            const general = await getOwnedGeneral(ctx, input.generalId);

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

            try {
                await publishRealtimeEvent(ctx.redis, ctx.profile.name, {
                    type: 'messageCreated',
                    at: now.toISOString(),
                    mailbox: input.mailbox,
                    msgType,
                    messageId: result.receiverId,
                    senderId: general.id,
                });
            } catch {
                // 실시간 알림 실패는 메시지 전송 실패로 취급하지 않는다.
            }

            return { msgType, msgId: result.receiverId };
        }),
});
