import { asNumber, asRecord, isRecord, JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';
import { LogCategory, LogFormat, LogScope, type MessageDraft, type MessagePayload } from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import { createRaiseInvaderHandler } from './monthlyInvaderAction.js';
import type { ImmediateGeneralActionExecutor } from './reservedTurnHandler.js';
import { buildCommandEnv } from './reservedTurnCommands.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import type { TurnEvent } from './types.js';

type ActionableMessageType = 'scout' | 'raiseInvader';

interface MessageRow {
    id: number;
    mailbox: number;
    type: string;
    time: Date;
    validUntil: Date;
    message: unknown;
}

export interface ActionableMessageResponseResult {
    ok: boolean;
    action?: ActionableMessageType;
    reason: string;
}

const parsePayload = (value: unknown): MessagePayload | null => {
    let parsed: unknown;
    try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return null;
    }
    const payload = asRecord(parsed);
    const src = asRecord(payload.src);
    const dest = asRecord(payload.dest);
    const isTarget = (target: Record<string, unknown>): boolean =>
        Number.isSafeInteger(target.generalId) &&
        Number.isSafeInteger(target.nationId) &&
        typeof target.generalName === 'string' &&
        typeof target.nationName === 'string' &&
        typeof target.color === 'string' &&
        typeof target.icon === 'string';
    if (!isTarget(src) || !isTarget(dest) || typeof payload.text !== 'string') {
        return null;
    }
    if (payload.option !== undefined && payload.option !== null && !isRecord(payload.option)) {
        return null;
    }
    return payload as unknown as MessagePayload;
};

const systemTarget: MessageDraft['src'] = {
    generalId: 0,
    generalName: '',
    nationId: 0,
    nationName: 'System',
    color: '#000000',
    icon: '',
};

const isLegacyTruthy = (value: unknown): boolean => {
    if (value === undefined || value === null || value === false || value === 0 || value === '' || value === '0') {
        return false;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    return true;
};

const queuePrivateNotice = (
    world: InMemoryTurnWorld,
    destination: MessagePayload['dest'],
    text: string,
    time: Date
): void => {
    world.queueMessage({
        msgType: 'private',
        src: systemTarget,
        dest: destination,
        text,
        time,
        validUntil: new Date('9999-12-31T00:00:00.000Z'),
        option: {},
        sendDestOnly: true,
    });
};

const invalidateMessageIds = async (
    db: GamePrisma.TransactionClient,
    world: InMemoryTurnWorld,
    ids: number[],
    now: Date
): Promise<void> => {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (uniqueIds.length === 0) return;
    await db.message.updateMany({
        where: { id: { in: uniqueIds } },
        data: {
            validUntil: now,
            validUntilTick: BigInt(world.dateToGameTick(now)),
        },
    });
};

const validateActor = async (options: {
    db: GamePrisma.TransactionClient;
    world: InMemoryTurnWorld;
    requestId?: string;
    userId: string;
    generalId: number;
}): Promise<Date> => {
    const actor = options.world.getGeneralById(options.generalId);
    if (!actor || actor.userId !== options.userId) {
        throw new Error('messageRespond general owner does not match command user.');
    }
    if (!options.requestId) return new Date();
    const event = await options.db.inputEvent.findUnique({
        where: { requestId: options.requestId },
        select: { actorUserId: true, target: true, eventType: true, createdAt: true },
    });
    if (!event) throw new Error(`ENGINE input event ${options.requestId} is missing.`);
    if (event.actorUserId !== options.userId || event.target !== 'ENGINE' || event.eventType !== 'messageRespond') {
        throw new Error('ENGINE input event actor or type does not match messageRespond.');
    }
    return event.createdAt;
};

const fetchMessageForUpdate = async (
    db: GamePrisma.TransactionClient,
    world: InMemoryTurnWorld,
    messageId: number,
    now: Date
): Promise<MessageRow | null> => {
    const currentTick = BigInt(world.dateToGameTick(now));
    const rows = await db.$queryRaw<MessageRow[]>(GamePrisma.sql`
        SELECT id, mailbox, type, time, valid_until AS "validUntil", message
        FROM message
        WHERE id = ${messageId}
          AND (
              (valid_until_tick IS NOT NULL AND valid_until_tick > ${currentTick})
              OR (valid_until_tick IS NULL AND valid_until > ${now})
          )
        LIMIT 1
        FOR UPDATE
    `);
    return rows[0] ?? null;
};

const respondToScout = async (options: {
    db: GamePrisma.TransactionClient;
    world: InMemoryTurnWorld;
    executor: ImmediateGeneralActionExecutor;
    actorId: number;
    response: boolean;
    row: MessageRow;
    payload: MessagePayload;
    now: Date;
}): Promise<ActionableMessageResponseResult> => {
    const { db, world, executor, actorId, response, row, payload, now } = options;
    if (row.type !== 'private' || row.mailbox !== actorId || payload.dest.generalId !== actorId) {
        return { ok: false, action: 'scout', reason: '올바른 수신자가 아닙니다.' };
    }
    if (row.validUntil.getTime() <= row.time.getTime() || isLegacyTruthy(asRecord(payload.option).used)) {
        return { ok: false, action: 'scout', reason: '유효하지 않은 등용장입니다.' };
    }

    const sourceNationName = payload.src.nationName;
    const sourceNationJosaRo = JosaUtil.pick(sourceNationName, '로');
    if (response) {
        const execution = await executor.execute({
            actionKey: 'che_등용수락',
            generalId: actorId,
            args: {
                destNationId: payload.src.nationId,
                destGeneralId: payload.src.generalId,
            },
            rng: new RandUtil(new LiteHashDRBG(`messageRespond:scout:${row.id}`)),
        });
        if (!execution.ok) {
            return { ok: true, action: 'scout', reason: execution.reason ?? '등용 수락 불가.' };
        }

        const otherRows = await db.$queryRaw<Array<{ id: number }>>(GamePrisma.sql`
            SELECT id
            FROM message
            WHERE mailbox = ${payload.src.generalId}
              AND type = 'private'
              AND dest = mailbox
              AND id <> ${row.id}
              AND (
                  (valid_until_tick IS NOT NULL AND valid_until_tick > ${BigInt(world.dateToGameTick(now))})
                  OR (valid_until_tick IS NULL AND valid_until > ${now})
              )
              AND message->'option'->>'action' = 'scout'
            FOR UPDATE
        `);
        await invalidateMessageIds(db, world, [row.id, ...otherRows.map(({ id }) => id)], now);
        world.queueMessage({
            msgType: 'private',
            src: payload.src,
            dest: payload.dest,
            text: `${sourceNationName}${sourceNationJosaRo} 등용 제의 수락`,
            time: now,
            validUntil: new Date('9999-12-31T00:00:00.000Z'),
            option: { delete: row.id },
            sendDestOnly: true,
        });
        return { ok: true, action: 'scout', reason: 'success' };
    }

    const destinationJosaYi = JosaUtil.pick(payload.dest.generalName, '이');
    world.pushLog({
        scope: LogScope.GENERAL,
        category: LogCategory.ACTION,
        format: LogFormat.PLAIN,
        generalId: actorId,
        text: `${sourceNationName}${sourceNationJosaRo} 망명을 거부했습니다.`,
    });
    world.pushLog({
        scope: LogScope.GENERAL,
        category: LogCategory.ACTION,
        format: LogFormat.PLAIN,
        generalId: payload.src.generalId,
        text: `<Y>${payload.dest.generalName}</>${destinationJosaYi} 등용을 거부했습니다.`,
    });
    await invalidateMessageIds(db, world, [row.id], now);
    world.queueMessage({
        msgType: 'private',
        src: payload.src,
        dest: payload.dest,
        text: `${sourceNationName}${sourceNationJosaRo} 등용 제의 거부`,
        time: now,
        validUntil: new Date('9999-12-31T00:00:00.000Z'),
        option: { delete: row.id },
        sendDestOnly: true,
    });
    return { ok: true, action: 'scout', reason: 'success' };
};

const respondToRaiseInvader = async (options: {
    db: GamePrisma.TransactionClient;
    world: InMemoryTurnWorld;
    reservedTurns?: InMemoryReservedTurnStore;
    actorId: number;
    response: boolean;
    row: MessageRow;
    payload: MessagePayload;
    now: Date;
    loadArchivedNationMaxId?: (serverId: string) => Promise<number>;
}): Promise<ActionableMessageResponseResult> => {
    const { db, world, reservedTurns, actorId, response, row, payload, now } = options;
    if (row.type !== 'private' || row.mailbox !== actorId || payload.dest.generalId !== actorId) {
        return { ok: false, action: 'raiseInvader', reason: '올바른 수신자가 아닙니다.' };
    }
    if (asRecord(payload.option).used === true) {
        return { ok: false, action: 'raiseInvader', reason: '이미 사용하였습니다.' };
    }
    if (!response) {
        await invalidateMessageIds(db, world, [row.id], now);
        return { ok: true, action: 'raiseInvader', reason: 'success' };
    }
    const state = world.getState();
    if (asNumber(state.meta.isunited ?? state.meta.isUnited, 0) !== 2) {
        const reason = '천하통일이 되지 않았습니다.';
        queuePrivateNotice(world, payload.dest, `${reason} 이민족 등장 불가.`, now);
        return { ok: false, action: 'raiseInvader', reason };
    }
    if (!reservedTurns) {
        throw new Error('RaiseInvader message response requires the reserved-turn store.');
    }
    const args = asRecord(payload.option).args;
    if (!Array.isArray(args) || args.length !== 4 || args.some((value) => typeof value !== 'number')) {
        return { ok: false, action: 'raiseInvader', reason: '이민족 소환 인자가 올바르지 않습니다.' };
    }
    const handler = createRaiseInvaderHandler({
        getWorld: () => world,
        reservedTurns,
        env: buildCommandEnv(world.getScenarioConfig(), world.getUnitSet()),
        loadArchivedNationMaxId: options.loadArchivedNationMaxId,
    });
    const event: TurnEvent = { id: 0, targetCode: 'month', priority: 0, condition: true, action: [], meta: {} };
    await handler(
        args,
        {
            year: state.currentYear,
            month: state.currentMonth,
            startyear: asNumber(state.meta.startYear, state.currentYear),
            currentEventID: 0,
            // Ref uses the frozen game_env.turntime while unification is paused.
            // `now` is the realtime game projection and can be hours ahead after
            // a long response wait, delaying every newly summoned invader turn.
            turnTime: state.lastTurnTime,
        },
        event
    );
    return { ok: true, action: 'raiseInvader', reason: 'success' };
};

export const respondToActionableMessage = async (options: {
    db: GamePrisma.TransactionClient;
    world: InMemoryTurnWorld;
    reservedTurns?: InMemoryReservedTurnStore;
    executor: ImmediateGeneralActionExecutor;
    requestId?: string;
    userId: string;
    generalId: number;
    messageId: number;
    response: boolean;
    loadArchivedNationMaxId?: (serverId: string) => Promise<number>;
}): Promise<ActionableMessageResponseResult> => {
    const acceptedAt = await validateActor(options);
    const now = options.world.getGameNow(acceptedAt);
    const row = await fetchMessageForUpdate(options.db, options.world, options.messageId, now);
    if (!row) return { ok: false, reason: '존재하지 않는 메시지입니다.' };
    const payload = parsePayload(row.message);
    if (!payload) return { ok: false, reason: '응답할 수 없는 메시지입니다.' };
    const action = asRecord(payload.option).action;
    if (action === 'scout') {
        return await respondToScout({ ...options, actorId: options.generalId, row, payload, now });
    }
    if (action === 'raiseInvader') {
        return await respondToRaiseInvader({ ...options, actorId: options.generalId, row, payload, now });
    }
    return { ok: false, reason: '응답할 수 없는 메시지입니다.' };
};
