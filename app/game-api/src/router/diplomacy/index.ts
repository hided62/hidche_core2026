import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord, JosaUtil } from '@sammo-ts/common';
import type { GamePrisma } from '@sammo-ts/infra';
import {
    MESSAGE_MAILBOX_NATIONAL_BASE,
    resolveMessageTargetIcon,
    sendMessage,
    type MessageDraft,
    type MessageRecordDraft,
    type MessageTarget,
} from '@sammo-ts/logic';

import type { GameApiContext, GeneralRow, NationRow } from '../../context.js';
import { insertMessage } from '../../messages/store.js';
import { purifyDiplomacyHtml } from '../../security/diplomacyHtml.js';
import { readDatabaseWallTime } from '../../services/wallClock.js';
import { accessAuthedInputProcedure, accessAuthedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';
import { assertNationAccess, resolveNationPermission } from '../nation/shared.js';

const DIPLOMACY_MESSAGE_VALID_UNTIL = new Date('9999-12-31T00:00:00.000Z');

type DiplomacyNation = Pick<NationRow, 'id' | 'name' | 'color'>;

const buildActorTarget = (general: GeneralRow, nation: DiplomacyNation): MessageTarget => ({
    generalId: general.id,
    generalName: general.name,
    nationId: nation.id,
    nationName: nation.name,
    color: nation.color,
    icon: resolveMessageTargetIcon({ picture: general.picture, imageServer: general.imageServer }),
});

const buildNationTarget = (nation: DiplomacyNation): MessageTarget => ({
    generalId: 0,
    generalName: '',
    nationId: nation.id,
    nationName: nation.name,
    color: nation.color,
    icon: resolveMessageTargetIcon(null),
});

const loadLetterNations = async (
    ctx: Pick<GameApiContext, 'db'>,
    srcNationId: number,
    destNationId: number
): Promise<{ srcNation: DiplomacyNation; destNation: DiplomacyNation }> => {
    const nations = await ctx.db.nation.findMany({
        where: { id: { in: [srcNationId, destNationId] } },
        select: { id: true, name: true, color: true },
    });
    const srcNation = nations.find((nation) => nation.id === srcNationId);
    const destNation = nations.find((nation) => nation.id === destNationId);
    if (!srcNation || !destNation) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '올바르지 않은 국가입니다.' });
    }
    return { srcNation, destNation };
};

const sendDocumentNotice = async (options: {
    ctx: Pick<GameApiContext, 'db' | 'changeJournal'>;
    src: MessageTarget;
    dest: MessageTarget;
    text: string;
    time: Date;
    includeNational?: boolean;
}): Promise<void> => {
    const store = {
        insertMessage: (draft: MessageRecordDraft) => insertMessage(options.ctx.db, draft),
    };
    const draft = {
        msgType: 'diplomacy',
        src: options.src,
        dest: options.dest,
        text: options.text,
        time: options.time,
        validUntil: DIPLOMACY_MESSAGE_VALID_UNTIL,
        option: { deletable: false },
    } satisfies MessageDraft;

    // Ref는 외교 사본을 먼저, 응답 때만 같은 문구의 국가 사본을 뒤이어 보낸다.
    await sendMessage(store, draft);
    if (options.includeNational) {
        await sendMessage(store, { ...draft, msgType: 'national' });
    }

    const messageDomain = options.includeNational ? 'messages.mailbox' : 'messages.diplomacyMailbox';
    options.ctx.changeJournal?.mark(messageDomain, MESSAGE_MAILBOX_NATIONAL_BASE + options.src.nationId);
    options.ctx.changeJournal?.mark(messageDomain, MESSAGE_MAILBOX_NATIONAL_BASE + options.dest.nationId);
};

const resolvePermissionLevel = async (ctx: Parameters<typeof getMyGeneral>[0], nationId: number) => {
    const nation = await ctx.db.nation.findUnique({
        where: { id: nationId },
        select: { meta: true },
    });
    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }
    const general = await getMyGeneral(ctx);
    return resolveNationPermission(general, nation.meta, true);
};

const mapLetterState = (state: string): 'PROPOSED' | 'ACTIVATED' | 'CANCELLED' | 'REPLACED' => {
    if (state === 'ACTIVATED') return 'ACTIVATED';
    if (state === 'CANCELLED') return 'CANCELLED';
    if (state === 'REPLACED') return 'REPLACED';
    return 'PROPOSED';
};

export const diplomacyRouter = router({
    getLetters: accessAuthedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);

        const permission = await resolvePermissionLevel(ctx, me.nationId);
        if (permission < 1) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }

        const letters = await ctx.db.diplomacyLetter.findMany({
            where: {
                state: { not: 'CANCELLED' },
                OR: [{ srcNationId: me.nationId }, { destNationId: me.nationId }],
            },
            orderBy: { date: 'desc' },
        });

        const nations = await ctx.db.nation.findMany({
            select: { id: true, name: true, color: true, level: true },
            orderBy: { id: 'asc' },
        });

        const signerIds = [
            ...new Set(
                letters.flatMap((letter) =>
                    letter.destSignerId === null ? [letter.srcSignerId] : [letter.srcSignerId, letter.destSignerId]
                )
            ),
        ];
        const signers = await ctx.db.general.findMany({
            where: { id: { in: signerIds } },
            select: { id: true, name: true, picture: true, imageServer: true },
        });
        const nationById = new Map(nations.map((nation) => [nation.id, nation]));
        const signerById = new Map(signers.map((general) => [general.id, general]));

        const result = letters.map((letter) => {
            const aux = asRecord(letter.aux);
            const src = asRecord(aux.src);
            const dest = asRecord(aux.dest);
            const stateOpt = typeof aux.state_opt === 'string' ? aux.state_opt : null;
            const detail =
                permission < 3 && letter.textDetail ? '(권한이 부족합니다)' : purifyDiplomacyHtml(letter.textDetail);
            const reason = asRecord(aux.reason);
            const srcNation = nationById.get(letter.srcNationId);
            const destNation = nationById.get(letter.destNationId);
            const srcSigner = signerById.get(letter.srcSignerId);
            const destSigner = letter.destSignerId === null ? undefined : signerById.get(letter.destSignerId);

            return {
                id: letter.id,
                src: {
                    nationId: letter.srcNationId,
                    nationName: typeof src.nationName === 'string' ? src.nationName : (srcNation?.name ?? ''),
                    nationColor: typeof src.nationColor === 'string' ? src.nationColor : (srcNation?.color ?? ''),
                    generalId: typeof src.generalId === 'number' ? src.generalId : letter.srcSignerId,
                    generalName: typeof src.generalName === 'string' ? src.generalName : (srcSigner?.name ?? null),
                    generalIcon: typeof src.generalIcon === 'string' ? src.generalIcon : null,
                    generalPicture: srcSigner?.picture ?? null,
                    generalImageServer: srcSigner?.imageServer ?? 0,
                },
                dest: {
                    nationId: letter.destNationId,
                    nationName: typeof dest.nationName === 'string' ? dest.nationName : (destNation?.name ?? ''),
                    nationColor: typeof dest.nationColor === 'string' ? dest.nationColor : (destNation?.color ?? ''),
                    generalId: typeof dest.generalId === 'number' ? dest.generalId : letter.destSignerId,
                    generalName: typeof dest.generalName === 'string' ? dest.generalName : (destSigner?.name ?? null),
                    generalIcon: typeof dest.generalIcon === 'string' ? dest.generalIcon : null,
                    generalPicture: destSigner?.picture ?? null,
                    generalImageServer: destSigner?.imageServer ?? 0,
                },
                prevId: letter.prevId,
                state: mapLetterState(letter.state),
                stateOpt,
                brief: purifyDiplomacyHtml(letter.textBrief),
                detail,
                date: letter.date.toISOString(),
                reason: {
                    who: typeof reason.who === 'number' ? reason.who : null,
                    action: typeof reason.action === 'string' ? reason.action : null,
                    text: typeof reason.reason === 'string' ? reason.reason : null,
                },
            };
        });

        return {
            letters: result,
            nations: nations.filter((nation) => nation.id !== me.nationId),
            myNationId: me.nationId,
            permission,
        };
    }),
    sendLetter: accessAuthedInputProcedure(
            z.object({
                destNationId: z.number().int().positive(),
                prevId: z.number().int().positive().nullable().optional(),
                brief: z.string().trim().min(1).max(2000),
                detail: z.string().trim().max(20000),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);

            const permission = await resolvePermissionLevel(ctx, me.nationId);
            if (permission < 4) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }

            if (input.destNationId === me.nationId) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '자국으로 보낼 수 없습니다.' });
            }

            let destNationId = input.destNationId;
            let prevId = input.prevId ?? null;

            if (prevId && prevId < 1) {
                prevId = null;
            }

            if (prevId) {
                const prevLetter = await ctx.db.diplomacyLetter.findFirst({
                    where: {
                        id: prevId,
                        OR: [
                            {
                                srcNationId: { in: [me.nationId, destNationId] },
                                destNationId: { in: [me.nationId, destNationId] },
                            },
                        ],
                    },
                });
                if (!prevLetter) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: '이전 문서가 없습니다.' });
                }

                const newer = await ctx.db.diplomacyLetter.findFirst({
                    where: {
                        prevId,
                        state: { not: 'CANCELLED' },
                    },
                    select: { id: true },
                });
                if (newer) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '해당 문서에 대한 새로운 문서가 이미 있습니다.',
                    });
                }

                if (prevLetter.state === 'PROPOSED') {
                    const aux = asRecord(prevLetter.aux);
                    aux.reason = {
                        who: me.id,
                        action: 'new_letter',
                        reason: 'new_letter',
                    };
                    await ctx.db.diplomacyLetter.update({
                        where: { id: prevId },
                        data: { state: 'REPLACED', aux: aux as GamePrisma.InputJsonValue },
                    });
                }

                destNationId =
                    prevLetter.srcNationId === me.nationId ? prevLetter.destNationId : prevLetter.srcNationId;
            }

            const nations = await ctx.db.nation.findMany({
                where: { id: { in: [me.nationId, destNationId] } },
                select: { id: true, name: true, color: true },
            });
            if (nations.length !== 2) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '올바르지 않은 국가입니다.' });
            }

            const srcNation = nations.find((nation) => nation.id === me.nationId);
            const destNation = nations.find((nation) => nation.id === destNationId);
            if (!srcNation || !destNation) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '올바르지 않은 국가입니다.' });
            }

            const srcTarget = buildActorTarget(me, srcNation);
            const destTarget = buildNationTarget(destNation);
            const aux = {
                src: {
                    nationName: srcNation.name,
                    nationColor: srcNation.color,
                    generalId: me.id,
                    generalName: me.name,
                    generalIcon: srcTarget.icon,
                },
                dest: {
                    nationName: destNation.name,
                    nationColor: destNation.color,
                },
            };
            const created = await ctx.db.diplomacyLetter.create({
                data: {
                    srcNationId: srcNation.id,
                    destNationId: destNation.id,
                    prevId,
                    state: 'PROPOSED',
                    textBrief: purifyDiplomacyHtml(input.brief),
                    textDetail: purifyDiplomacyHtml(input.detail),
                    srcSignerId: me.id,
                    aux: aux as GamePrisma.InputJsonValue,
                },
            });

            const letterIdText = String(created.id);
            const josaYi = JosaUtil.pick(letterIdText, '이');
            const text = prevId
                ? `문서 #${prevId}의 새로운 외교 문서 #${letterIdText}${josaYi} 준비되었습니다. 외교부에서 확인해주세요.`
                : `새로운 외교 문서 #${letterIdText}${josaYi} 준비되었습니다. 외교부에서 확인해주세요.`;
            await sendDocumentNotice({
                ctx,
                src: srcTarget,
                dest: destTarget,
                text,
                time: created.date,
            });

            return { id: created.id };
        }),
    respondLetter: accessAuthedInputProcedure(
            z.object({
                letterId: z.number().int().positive(),
                agree: z.boolean(),
                reason: z.string().trim().max(2000).optional(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);

            const permission = await resolvePermissionLevel(ctx, me.nationId);
            if (permission < 4) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }

            const letter = await ctx.db.diplomacyLetter.findFirst({
                where: {
                    id: input.letterId,
                    destNationId: me.nationId,
                    state: 'PROPOSED',
                },
            });
            if (!letter) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '서신이 없습니다.' });
            }

            const { srcNation, destNation } = await loadLetterNations(
                ctx,
                letter.srcNationId,
                letter.destNationId
            );
            const messageSrc = buildActorTarget(me, destNation);
            const messageDest = buildNationTarget(srcNation);
            const messageTime = await readDatabaseWallTime(ctx.db);
            const aux = asRecord(letter.aux);
            let messageText: string;
            if (input.agree) {
                const dest = asRecord(aux.dest);
                dest.generalId = me.id;
                dest.generalName = me.name;
                dest.generalIcon = messageSrc.icon;
                aux.dest = dest;

                await ctx.db.diplomacyLetter.update({
                    where: { id: letter.id },
                    data: {
                        state: 'ACTIVATED',
                        destSignerId: me.id,
                        aux: aux as GamePrisma.InputJsonValue,
                    },
                });

                let prevId = letter.prevId;
                while (prevId) {
                    const prevLetter = await ctx.db.diplomacyLetter.findFirst({ where: { id: prevId } });
                    if (!prevLetter) {
                        break;
                    }
                    await ctx.db.diplomacyLetter.update({
                        where: { id: prevId },
                        data: { state: 'REPLACED' },
                    });
                    prevId = prevLetter.prevId;
                }
                messageText = `외교 서신( #${letter.id})이 승인되었습니다.`;
            } else {
                aux.reason = {
                    who: me.id,
                    action: 'disagree',
                    reason: input.reason ?? '',
                };
                await ctx.db.diplomacyLetter.update({
                    where: { id: letter.id },
                    data: { state: 'CANCELLED', aux: aux as GamePrisma.InputJsonValue },
                });
                messageText = `외교 서신(#${letter.id})이 거부되었습니다.`;
                if (input.reason && input.reason !== '0') {
                    messageText += ` 이유 : ${input.reason}`;
                }
            }

            await sendDocumentNotice({
                ctx,
                src: messageSrc,
                dest: messageDest,
                text: messageText,
                time: messageTime,
                includeNational: true,
            });

            return { ok: true };
        }),
    rollbackLetter: accessAuthedInputProcedure(z.object({ letterId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);

            const permission = await resolvePermissionLevel(ctx, me.nationId);
            if (permission < 4) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }

            const letter = await ctx.db.diplomacyLetter.findFirst({
                where: {
                    id: input.letterId,
                    srcNationId: me.nationId,
                    state: 'PROPOSED',
                },
            });
            if (!letter) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '서신이 없습니다.' });
            }

            const { srcNation, destNation } = await loadLetterNations(
                ctx,
                letter.srcNationId,
                letter.destNationId
            );
            const messageSrc = buildActorTarget(me, srcNation);
            const messageDest = buildNationTarget(destNation);
            const messageTime = await readDatabaseWallTime(ctx.db);
            const aux = asRecord(letter.aux);
            aux.reason = {
                who: me.id,
                action: 'cancelled',
                reason: '회수',
            };

            await ctx.db.diplomacyLetter.update({
                where: { id: letter.id },
                data: { state: 'CANCELLED', aux: aux as GamePrisma.InputJsonValue },
            });

            await sendDocumentNotice({
                ctx,
                src: messageSrc,
                dest: messageDest,
                text: `외교 서신(#${letter.id})이 회수되었습니다.`,
                time: messageTime,
            });

            return { ok: true };
        }),
    destroyLetter: accessAuthedInputProcedure(z.object({ letterId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertNationAccess(me);

            const permission = await resolvePermissionLevel(ctx, me.nationId);
            if (permission < 4) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }

            const letter = await ctx.db.diplomacyLetter.findFirst({
                where: {
                    id: input.letterId,
                    state: 'ACTIVATED',
                    OR: [{ srcNationId: me.nationId }, { destNationId: me.nationId }],
                },
            });
            if (!letter) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '서신이 없습니다.' });
            }

            const aux = asRecord(letter.aux);
            const stateOpt = typeof aux.state_opt === 'string' ? aux.state_opt : null;
            const myStateOpt = letter.srcNationId === me.nationId ? 'try_destroy_src' : 'try_destroy_dest';

            if (stateOpt === myStateOpt) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 파기 신청을 했습니다.' });
            }

            const { srcNation, destNation } = await loadLetterNations(
                ctx,
                letter.srcNationId,
                letter.destNationId
            );
            const actorNation = letter.srcNationId === me.nationId ? srcNation : destNation;
            const otherNation = letter.srcNationId === me.nationId ? destNation : srcNation;
            const messageSrc = buildActorTarget(me, actorNation);
            const messageDest = buildNationTarget(otherNation);
            const messageTime = await readDatabaseWallTime(ctx.db);
            let resultState: 'ACTIVATED' | 'CANCELLED';
            let messageText: string;

            if (stateOpt && stateOpt !== myStateOpt) {
                await ctx.db.diplomacyLetter.update({
                    where: { id: letter.id },
                    data: { state: 'CANCELLED', aux: aux as GamePrisma.InputJsonValue },
                });
                resultState = 'CANCELLED';
                messageText = `외교 서신(#${letter.id})을 파기했습니다.`;
            } else {
                aux.state_opt = myStateOpt;
                await ctx.db.diplomacyLetter.update({
                    where: { id: letter.id },
                    data: { aux: aux as GamePrisma.InputJsonValue },
                });
                resultState = 'ACTIVATED';
                messageText = `외교 서신(#${letter.id})을 파기 요청합니다.`;
            }

            await sendDocumentNotice({
                ctx,
                src: messageSrc,
                dest: messageDest,
                text: messageText,
                time: messageTime,
            });
            return { state: resultState };
        }),
});
