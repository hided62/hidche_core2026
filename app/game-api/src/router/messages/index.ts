import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { asRecord } from '@sammo-ts/common';
import type { UserSanctions } from '@sammo-ts/common/auth/gameToken';
import { isMessageAccessBlocked } from '@sammo-ts/common/auth/sanctions';

import type { GameApiContext } from '../../context.js';
import { accessAuthedInputProcedure, accessLimitAuthedInputProcedure, authedProcedure, router } from '../../trpc.js';
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
import { getOwnedGeneral } from '../shared/general.js';
import { resolveNationPermission } from '../nation/shared.js';
import { respondToDiplomaticMessage } from '../../messages/diplomaticResponse.js';
import { loadCurrentGameTime } from '../../services/gameClock.js';

const zMessageType = z.enum(['private', 'public', 'national', 'diplomacy']);

const redactDiplomacyMessages = (messages: MessageView[], permission: number): MessageView[] => {
    if (permission >= 3) {
        return messages;
    }
    return messages.map((message) => {
        if (!message.dest || message.dest.nationId === 0) {
            return message;
        }
        return {
            ...message,
            text: '(외교 메시지입니다)',
            option: {
                ...(message.option ?? {}),
                invalid: true,
            },
        };
    });
};

const isMessageFeatureBlocked = (sanctions: UserSanctions, profileNames: string[]): boolean => {
    return isMessageAccessBlocked(sanctions, profileNames);
};

const readPenaltyNumber = (penalty: unknown, key: string, fallback: number): number => {
    const value = asRecord(penalty)[key];
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

const hasPenalty = (penalty: unknown, key: string): boolean => {
    const value = asRecord(penalty)[key];
    return value === true || value === 1 || value === '1';
};

const markMessageMailboxes = (
    ctx: Pick<GameApiContext, 'changeJournal'>,
    mailboxes: Iterable<number>
): void => {
    for (const mailbox of mailboxes) {
        ctx.changeJournal?.mark('messages.mailbox', mailbox);
    }
};

export const messagesRouter = router({
    getRecent: accessLimitAuthedInputProcedure(
        z.object({
            generalId: z.number().int().positive(),
            sequence: z.number().int().optional(),
        })
    ).query(async ({ ctx, input }) => {
        const general = await getOwnedGeneral(ctx, input.generalId);

        const sequence = input.sequence ?? -1;
        const nationId = general.nationId;
        const mailboxes = {
            private: general.id,
            public: MESSAGE_MAILBOX_PUBLIC,
            national: MESSAGE_MAILBOX_NATIONAL_BASE + nationId,
            diplomacy: MESSAGE_MAILBOX_NATIONAL_BASE + nationId,
        } satisfies Record<MessageType, number>;

        const [privateMessages, publicMessages, nationalMessages, diplomacyMessages, readState, nation] =
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
                ctx.db.messageReadState.findUnique({ where: { generalId: general.id } }),
                nationId > 0
                    ? ctx.db.nation.findUnique({
                          where: { id: nationId },
                          select: { meta: true },
                      })
                    : null,
            ]);

        const permission = nationId > 0 && nation ? resolveNationPermission(general, nation.meta, false) : -1;
        const messageBuckets: Record<MessageType, MessageView[]> = {
            private: privateMessages,
            public: publicMessages,
            national: nationalMessages,
            diplomacy: redactDiplomacyMessages(diplomacyMessages, permission),
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
            permission,
            canRespondDiplomacy: permission >= 4 && general.officerLevel > 4,
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
                    nationId: nation.id,
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
            if (message.msgType === 'diplomacy' && message.payload.option?.action) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: '시스템 외교 메시지는 삭제할 수 없습니다.',
                });
            }
            if (message.payload.option?.deletable === false) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '삭제할 수 없는 메시지입니다.' });
            }
            const { now } = await loadCurrentGameTime(ctx.db);
            if (now.getTime() - message.time.getTime() > 5 * 60 * 1000) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '5분 이내의 메시지만 삭제할 수 있습니다.' });
            }
            const receiverMessageId = message.payload.option?.receiverMessageID;
            const shouldDeleteReceiverCopy = message.msgType === 'private' || message.msgType === 'national';
            const ids = [
                message.id,
                ...(shouldDeleteReceiverCopy && typeof receiverMessageId === 'number' ? [receiverMessageId] : []),
            ];
            await invalidateMessages(ctx.db, ids);
            const receiverMailbox =
                shouldDeleteReceiverCopy && typeof receiverMessageId === 'number' && message.msgType === 'private'
                    ? message.payload.dest.generalId
                    : shouldDeleteReceiverCopy &&
                        typeof receiverMessageId === 'number' &&
                        message.msgType === 'national'
                      ? MESSAGE_MAILBOX_NATIONAL_BASE + message.payload.dest.nationId
                      : null;
            markMessageMailboxes(ctx, [message.mailbox, ...(receiverMailbox === null ? [] : [receiverMailbox])]);
            return { ok: true, deletedIds: ids };
        }),
    respond: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
                messageId: z.number().int().positive(),
                response: z.boolean(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const general = await getOwnedGeneral(ctx, input.generalId);
            const result = await respondToDiplomaticMessage({
                db: ctx.db,
                actor: general,
                messageId: input.messageId,
                response: input.response,
            });
            markMessageMailboxes(ctx, result.affectedMailboxes);
            for (const generalId of result.affectedGeneralRecordIds) {
                ctx.changeJournal?.mark('records.general', generalId);
            }
            for (const nationId of result.affectedNationIds) {
                ctx.changeJournal?.mark('nation.content', nationId);
            }
            for (const cityId of result.affectedCityIds) {
                ctx.changeJournal?.mark('city.content', cityId);
            }
            if (result.affectedCityIds.length > 0) {
                ctx.changeJournal?.mark('map.world');
            }
            if (result.affectedNationIds.length > 0 || result.affectedCityIds.length > 0) {
                ctx.changeJournal?.mark('dashboard.global');
            }
            return { result: result.result, reason: result.reason };
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
            const nation =
                nationId > 0
                    ? await ctx.db.nation.findUnique({
                          where: { id: nationId },
                          select: { meta: true },
                      })
                    : null;
            const permission = nationId > 0 && nation ? resolveNationPermission(general, nation.meta, false) : -1;
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
            messageBuckets[input.type] =
                input.type === 'diplomacy' ? redactDiplomacyMessages(messages, permission) : messages;

            return {
                result: true,
                keepRecent: true,
                sequence: 0,
                nationId,
                generalName: general.name,
                permission,
                ...messageBuckets,
            };
        }),
    send: accessAuthedInputProcedure(
        z.object({
            generalId: z.number().int().positive(),
            mailbox: z.number().int(),
            text: z.string().min(1),
        })
    ).mutation(async ({ ctx, input }) => {
        const general = await getOwnedGeneral(ctx, input.generalId);
        if (!ctx.auth || isMessageFeatureBlocked(ctx.auth.sanctions, [ctx.profile.name, ctx.profile.id])) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: '메시지 전송이 제한된 계정입니다.',
            });
        }

        const src = await buildTargetFromGeneral(ctx.db, general);
        const { now } = await loadCurrentGameTime(ctx.db);
        const validUntil = new Date('9999-12-31T00:00:00Z');

        let msgType: MessageType;
        let dest = src;
        let receiverMailbox = input.mailbox;

        if (input.mailbox === MESSAGE_MAILBOX_PUBLIC) {
            if (hasPenalty(general.penalty, 'noSendPublicMsg')) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: '공개 메세지를 보낼 수 없습니다.',
                });
            }
            msgType = 'public';
        } else if (input.mailbox >= MESSAGE_MAILBOX_NATIONAL_BASE) {
            const sourceNation =
                general.nationId > 0
                    ? await ctx.db.nation.findUnique({
                          where: { id: general.nationId },
                          select: { meta: true },
                      })
                    : null;
            const permission =
                general.nationId > 0 && sourceNation ? resolveNationPermission(general, sourceNation.meta) : -1;
            const destNationId = permission < 4 ? general.nationId : input.mailbox - MESSAGE_MAILBOX_NATIONAL_BASE;
            const nationInfo = await resolveNationInfo(ctx.db, destNationId);
            if (destNationId > 0) {
                const destNation = await ctx.db.nation.findUnique({ where: { id: destNationId } });
                if (!destNation) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: '존재하지 않는 국가입니다.',
                    });
                }
            }
            dest = buildNationTarget(destNationId, nationInfo.name, nationInfo.color);
            msgType = destNationId === general.nationId ? 'national' : 'diplomacy';
            receiverMailbox = MESSAGE_MAILBOX_NATIONAL_BASE + destNationId;
        } else if (input.mailbox > 0) {
            if (hasPenalty(general.penalty, 'noSendPrivateMsg')) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: '개인 메세지를 보낼 수 없습니다.',
                });
            }
            const intervalSeconds = Math.max(
                0,
                Math.ceil(readPenaltyNumber(general.penalty, 'sendPrivateMsgDelay', 2))
            );
            if (intervalSeconds > 0) {
                const rateLimitKey = `game:${ctx.profile.name}:message:private:${ctx.auth.sessionId}`;
                const acquired = await ctx.redis.set(rateLimitKey, '1', {
                    NX: true,
                    PX: intervalSeconds * 1000,
                });
                if (acquired === null) {
                    throw new TRPCError({
                        code: 'TOO_MANY_REQUESTS',
                        message: `개인메세지는 ${intervalSeconds}초당 1건만 보낼 수 있습니다!`,
                    });
                }
            }
            const destGeneral = await ctx.db.general.findUnique({
                where: { id: input.mailbox },
            });
            if (!destGeneral) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: '존재하지 않는 유저입니다.',
                });
            }
            const [sourceNation, destNation] = await Promise.all([
                general.nationId > 0
                    ? ctx.db.nation.findUnique({ where: { id: general.nationId }, select: { meta: true } })
                    : null,
                destGeneral.nationId > 0
                    ? ctx.db.nation.findUnique({ where: { id: destGeneral.nationId }, select: { meta: true } })
                    : null,
            ]);
            const sourcePermission =
                sourceNation && general.nationId > 0 ? resolveNationPermission(general, sourceNation.meta, false) : -1;
            const destPermission =
                destNation && destGeneral.nationId > 0
                    ? resolveNationPermission(destGeneral, destNation.meta, false)
                    : -1;
            if (sourcePermission === 4 && destPermission === 4 && destGeneral.nationId !== general.nationId) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: '외교권자끼리는 메시지를 보낼 수 없습니다.',
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

        const senderMailbox =
            result.senderId === undefined
                ? null
                : msgType === 'private'
                  ? general.id
                  : MESSAGE_MAILBOX_NATIONAL_BASE + general.nationId;
        markMessageMailboxes(ctx, [receiverMailbox, ...(senderMailbox === null ? [] : [senderMailbox])]);

        return { msgType, msgId: result.receiverId };
    }),
});
