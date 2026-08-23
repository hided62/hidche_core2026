import { TRPCError } from '@trpc/server';

import { asRecord, JosaUtil } from '@sammo-ts/common';
import {
    ActionLogger,
    buildNationFrontStatePatches,
    finalizeLogEntry,
    LogFormat,
    MESSAGE_MAILBOX_NATIONAL_BASE,
    orderLegacyActionLoggerFlush,
    resolveInstantDiplomacyResponse,
    sendMessage,
    type GeneralActionEffect,
    type InstantDiplomacyResponseAction,
    type LogEntryDraft,
    type MessageDraft,
    type MessageRecordDraft,
    type Nation as LogicNation,
} from '@sammo-ts/logic';

import type { DatabaseClient, GeneralRow, InputJsonValue, NationRow } from '../context.js';
import { loadMapDefinitionByName } from '../maps/mapDefinition.js';
import { resolveNationPermission } from '../router/nation/shared.js';
import { loadCurrentGameTime } from '../services/gameClock.js';
import { fetchMessageByIdForUpdate, insertMessage, invalidateMessages } from './store.js';

const ACTION_NAMES: Record<InstantDiplomacyResponseAction, string> = {
    noAggression: '불가침',
    cancelNA: '불가침 파기',
    stopWar: '종전',
};

const toLogicNation = (nation: NationRow): LogicNation => {
    const meta = asRecord(nation.meta);
    const power = typeof meta.power === 'number' && Number.isFinite(meta.power) ? meta.power : 0;
    return {
        id: nation.id,
        name: nation.name,
        color: nation.color,
        capitalCityId: nation.capitalCityId,
        chiefGeneralId: nation.chiefGeneralId,
        gold: nation.gold,
        rice: nation.rice,
        power,
        level: nation.level,
        typeCode: nation.typeCode,
        meta: meta as LogicNation['meta'],
    };
};

const parseAction = (value: unknown): InstantDiplomacyResponseAction | null =>
    value === 'noAggression' || value === 'cancelNA' || value === 'stopWar' ? value : null;

const parseInteger = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) ? value : null;

const persistLogs = async (
    db: DatabaseClient,
    logs: LogEntryDraft[],
    year: number,
    month: number,
    at: Date
): Promise<void> => {
    const data = logs.flatMap((entry) => {
        const record = finalizeLogEntry(entry, { year, month, at });
        if (!record) {
            return [];
        }
        return [
            {
                scope: record.scope,
                category: record.category,
                subType: record.subType ?? null,
                year: record.year,
                month: record.month,
                text: record.text,
                generalId: record.generalId ?? null,
                nationId: record.nationId ?? null,
                userId: record.userId ?? null,
                meta: (record.meta ?? {}) as InputJsonValue,
                createdAt: record.createdAt ?? at,
            },
        ];
    });
    if (data.length > 0) {
        await db.logEntry.createMany({ data });
    }
};

const persistEffects = async (
    db: DatabaseClient,
    effects: GeneralActionEffect[],
    year: number,
    month: number,
    at: Date
): Promise<void> => {
    const logs: LogEntryDraft[] = [];
    for (const effect of effects) {
        if (effect.type === 'diplomacy:patch') {
            await db.diplomacy.update({
                where: {
                    srcNationId_destNationId: {
                        srcNationId: effect.srcNationId,
                        destNationId: effect.destNationId,
                    },
                },
                data: {
                    ...(effect.patch.state !== undefined ? { stateCode: effect.patch.state } : {}),
                    ...(effect.patch.term !== undefined ? { term: effect.patch.term } : {}),
                    ...(effect.patch.meta !== undefined ? { meta: effect.patch.meta as InputJsonValue } : {}),
                },
            });
        } else if (effect.type === 'nation:patch' && effect.targetId !== undefined) {
            const patch = effect.patch;
            await db.nation.update({
                where: { id: effect.targetId },
                data: {
                    ...(patch.meta !== undefined ? { meta: patch.meta as InputJsonValue } : {}),
                },
            });
        } else if (effect.type === 'log') {
            logs.push(effect.entry);
        }
    }
    await persistLogs(db, orderLegacyActionLoggerFlush(logs), year, month, at);
};

const refreshFrontStates = async (db: DatabaseClient, mapName: string, nationIds: number[]): Promise<number[]> => {
    const [map, cities, diplomacy] = await Promise.all([
        loadMapDefinitionByName(mapName),
        db.city.findMany({
            select: { id: true, nationId: true, frontState: true },
        }),
        db.diplomacy.findMany({
            select: { srcNationId: true, destNationId: true, stateCode: true, term: true },
        }),
    ]);
    const connections = new Map<number, readonly number[]>(map.cities.map((city) => [city.id, city.connections]));
    const patches = buildNationFrontStatePatches({
        cities,
        diplomacy: diplomacy.map((entry) => ({
            fromNationId: entry.srcNationId,
            toNationId: entry.destNationId,
            state: entry.stateCode,
            term: entry.term,
        })),
        connections,
        nationIds,
    });
    for (const patch of patches) {
        await db.city.update({
            where: { id: patch.id },
            data: { frontState: patch.frontState },
        });
    }
    return patches.map((patch) => patch.id);
};

const buildFailureLog = (generalId: number, reason: string, actionName: string, response: boolean): LogEntryDraft[] => {
    const logger = new ActionLogger({ generalId });
    logger.pushGeneralActionLog(
        response ? `${reason} ${actionName} 실패` : `${reason} ${actionName} 거절 불가.`,
        LogFormat.PLAIN
    );
    return logger.flush();
};

export interface DiplomaticMessageResponseResult {
    result: boolean;
    reason: string;
    affectedMailboxes: number[];
    affectedGeneralRecordIds: number[];
    affectedNationIds: number[];
    affectedCityIds: number[];
}

export const respondToDiplomaticMessage = async (options: {
    db: DatabaseClient;
    actor: GeneralRow;
    messageId: number;
    response: boolean;
}): Promise<DiplomaticMessageResponseResult> => {
    const { db, actor, messageId, response } = options;
    const message = await fetchMessageByIdForUpdate(db, messageId);
    if (!message) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '존재하지 않는 메시지입니다.' });
    }

    const world = await db.worldState.findFirst({
        select: { currentYear: true, currentMonth: true, config: true },
    });
    if (!world) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '게임 상태가 없습니다.' });
    }
    const now = (await loadCurrentGameTime(db)).now;
    const action = parseAction(message.payload.option?.action);
    if (message.msgType !== 'diplomacy' || !action || message.payload.option?.used) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '응답할 수 없는 메시지입니다.' });
    }
    const actionName = ACTION_NAMES[action];
    const fail = async (reason: string): Promise<DiplomaticMessageResponseResult> => {
        await persistLogs(
            db,
            buildFailureLog(actor.id, reason, actionName, response),
            world.currentYear,
            world.currentMonth,
            now
        );
        return {
            result: false,
            reason,
            affectedMailboxes: [],
            affectedGeneralRecordIds: [actor.id],
            affectedNationIds: [],
            affectedCityIds: [],
        };
    };

    const actorNationId = actor.nationId;
    if (
        actorNationId <= 0 ||
        message.mailbox !== MESSAGE_MAILBOX_NATIONAL_BASE + actorNationId ||
        message.payload.dest.nationId !== actorNationId
    ) {
        return fail('송신자가 외교서신을 처리할 수 없습니다.');
    }

    const proposerNationId = message.payload.src.nationId;
    const proposerGeneralId = message.payload.src.generalId;
    if (
        proposerNationId <= 0 ||
        proposerNationId === actorNationId ||
        proposerGeneralId <= 0 ||
        proposerGeneralId === actor.id
    ) {
        return fail('유효하지 않은 외교서신입니다.');
    }

    await db.$queryRaw`
        SELECT id
        FROM nation
        WHERE id = ${actorNationId}
        FOR UPDATE
    `;
    const actorNation = await db.nation.findUnique({ where: { id: actorNationId } });
    if (!actorNation) {
        return fail('해당 국가의 외교권자가 아닙니다.');
    }
    if (actor.officerLevel <= 4) {
        return fail('수뇌가 아닙니다.');
    }
    if (resolveNationPermission(actor, actorNation.meta, false) < 4) {
        return fail('해당 국가의 외교권자가 아닙니다.');
    }

    if (!response) {
        let declinedAidProposalNationId: number | null = null;
        if (action === 'noAggression') {
            await db.$queryRaw`
                SELECT id
                FROM nation
                WHERE id = ${proposerNationId}
                FOR UPDATE
            `;
            const proposerNation = await db.nation.findUnique({ where: { id: proposerNationId } });
            if (proposerNation) {
                const proposerMeta = asRecord(proposerNation.meta);
                const respAssistTry = asRecord(proposerMeta.resp_assist_try);
                const assistKey = `n${actorNationId}`;
                if (Object.prototype.hasOwnProperty.call(respAssistTry, assistKey)) {
                    const respAssistDeclined = asRecord(proposerMeta.resp_assist_declined);
                    await db.nation.update({
                        where: { id: proposerNationId },
                        data: {
                            meta: {
                                ...proposerMeta,
                                resp_assist_declined: {
                                    ...respAssistDeclined,
                                    [assistKey]: [actorNationId, world.currentYear * 12 + world.currentMonth - 1],
                                },
                            } as InputJsonValue,
                        },
                    });
                    declinedAidProposalNationId = proposerNationId;
                }
            }
        }
        const actorLogger = new ActionLogger({ generalId: actor.id });
        const proposerLogger = new ActionLogger({ generalId: proposerGeneralId });
        const receiverNationName = message.payload.dest.nationName;
        const receiverJosaYi = JosaUtil.pick(receiverNationName, '이');
        actorLogger.pushGeneralActionLog(
            `<D>${message.payload.src.nationName}</>의 ${actionName} 제안을 거절했습니다.`,
            LogFormat.PLAIN
        );
        proposerLogger.pushGeneralActionLog(
            `<Y>${receiverNationName}</>${receiverJosaYi} ${actionName} 제안을 거절했습니다.`,
            LogFormat.PLAIN
        );
        await persistLogs(
            db,
            [...actorLogger.flush(), ...proposerLogger.flush()],
            world.currentYear,
            world.currentMonth,
            now
        );
        await invalidateMessages(db, [message.id]);
        return {
            result: true,
            reason: 'success',
            affectedMailboxes: [MESSAGE_MAILBOX_NATIONAL_BASE + actorNationId],
            affectedGeneralRecordIds: [actor.id, proposerGeneralId],
            affectedNationIds: declinedAidProposalNationId === null ? [] : [declinedAidProposalNationId],
            affectedCityIds: [],
        };
    }

    await db.$queryRaw`
        SELECT id
        FROM nation
        WHERE id = ${proposerNationId}
        FOR UPDATE
    `;
    await db.$queryRaw`
        SELECT id
        FROM diplomacy
        WHERE (src_nation_id = ${actorNationId} AND dest_nation_id = ${proposerNationId})
           OR (src_nation_id = ${proposerNationId} AND dest_nation_id = ${actorNationId})
        ORDER BY id
        FOR UPDATE
    `;

    const [proposerNation, proposer, actorCity, actorDiplomacy, reverseDiplomacy] = await Promise.all([
        db.nation.findUnique({ where: { id: proposerNationId } }),
        db.general.findUnique({ where: { id: proposerGeneralId } }),
        db.city.findUnique({ where: { id: actor.cityId } }),
        db.diplomacy.findUnique({
            where: {
                srcNationId_destNationId: {
                    srcNationId: actorNationId,
                    destNationId: proposerNationId,
                },
            },
        }),
        db.diplomacy.findUnique({
            where: {
                srcNationId_destNationId: {
                    srcNationId: proposerNationId,
                    destNationId: actorNationId,
                },
            },
        }),
    ]);

    if (
        !proposerNation ||
        !proposer ||
        proposer.nationId !== proposerNationId ||
        !actorDiplomacy ||
        !reverseDiplomacy
    ) {
        return fail('제의 장수가 국가 소속이 아닙니다');
    }

    const invalidStateReason =
        action === 'noAggression'
            ? actorDiplomacy.stateCode === 0
                ? '아국과 이미 교전중입니다.'
                : actorDiplomacy.stateCode === 1
                  ? '아국과 이미 선포중입니다.'
                  : null
            : action === 'cancelNA'
              ? actorDiplomacy.stateCode === 7
                  ? null
                  : '불가침 중인 상대국에게만 가능합니다.'
              : actorDiplomacy.stateCode === 0 || actorDiplomacy.stateCode === 1
                ? null
                : '상대국과 선포, 전쟁중이지 않습니다.';
    if (invalidStateReason) {
        return fail(invalidStateReason);
    }

    const treatyYear = parseInteger(message.payload.option?.year);
    const treatyMonth = parseInteger(message.payload.option?.month);
    if (action === 'noAggression') {
        if (!actorCity || actorCity.nationId !== actorNationId) {
            return fail('아국이 아닙니다.');
        }
        if (!actorCity.supplyState) {
            return fail('고립된 도시입니다.');
        }
        if (
            treatyYear === null ||
            treatyMonth === null ||
            treatyMonth < 1 ||
            treatyMonth > 12 ||
            treatyYear * 12 + treatyMonth <= world.currentYear * 12 + world.currentMonth - 1
        ) {
            return fail('이미 기한이 지났습니다.');
        }
    }

    const resolution = resolveInstantDiplomacyResponse(
        {
            actor: { id: actor.id, name: actor.name, nationId: actorNationId },
            actorNation: toLogicNation(actorNation),
            proposer: { id: proposer.id, name: proposer.name, nationId: proposerNationId },
            proposerNation: toLogicNation(proposerNation),
            currentYear: world.currentYear,
            currentMonth: world.currentMonth,
        },
        {
            action,
            ...(action === 'noAggression' ? { treatyYear: treatyYear!, treatyMonth: treatyMonth! } : {}),
        }
    );
    await persistEffects(db, resolution.effects, world.currentYear, world.currentMonth, now);
    let affectedCityIds: number[] = [];
    if (resolution.refreshFront) {
        const worldConfig = asRecord(world.config);
        const environment = asRecord(worldConfig.environment);
        const mapName = typeof environment.mapName === 'string' ? environment.mapName : 'che';
        affectedCityIds = await refreshFrontStates(db, mapName, [actorNationId, proposerNationId]);
    }

    const proposerMessageNationName = message.payload.src.nationName;
    const actorMessageNationName = message.payload.dest.nationName;
    const proposerJosaYi = JosaUtil.pick(proposerMessageNationName, '이');
    const resultText =
        `【외교】${world.currentYear}년 ${world.currentMonth}월: ` +
        `${proposerMessageNationName}${proposerJosaYi} ${actorMessageNationName}에게 제안한 ${resolution.diplomacyDetail}`;
    const actorTarget = {
        ...message.payload.dest,
        generalId: actor.id,
        generalName: actor.name,
    };
    const proposerTarget = message.payload.src;
    const draftBase = {
        src: actorTarget,
        dest: proposerTarget,
        text: resultText,
        time: now,
        validUntil: new Date('9999-12-31T00:00:00Z'),
        option: {
            delete: message.id,
            silence: true,
            deletable: false,
        },
    };

    await invalidateMessages(db, [message.id]);
    const store = {
        insertMessage: (draft: MessageRecordDraft) => insertMessage(db, draft),
    };
    await sendMessage(store, { ...draftBase, msgType: 'national' } satisfies MessageDraft);
    await sendMessage(store, { ...draftBase, msgType: 'diplomacy' } satisfies MessageDraft);

    return {
        result: true,
        reason: 'success',
        affectedMailboxes: [
            MESSAGE_MAILBOX_NATIONAL_BASE + actorNationId,
            MESSAGE_MAILBOX_NATIONAL_BASE + proposerNationId,
        ],
        affectedGeneralRecordIds: [actor.id, proposerGeneralId],
        affectedNationIds: [actorNationId, proposerNationId],
        affectedCityIds,
    };
};
