import { createHash } from 'node:crypto';

import { asRecord, formatServerDateTime, type TurnDaemonCommand, type TurnDaemonCommandResult } from '@sammo-ts/common';
import { resolveTroopSecretPermission } from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';

type SetNationSettingCommand = Extract<TurnDaemonCommand, { type: 'setNationSetting' }>;
type SetNationSettingResult = Extract<TurnDaemonCommandResult, { type: 'setNationSetting' }>;

const MAX_AVAILABLE_WAR_SETTING_COUNT = 10;

const reject = (
    code: Extract<SetNationSettingResult, { ok: false }>['code'],
    reason: string,
    nationId?: number
): SetNationSettingResult => ({
    type: 'setNationSetting',
    ok: false,
    code,
    reason,
    ...(nationId === undefined ? {} : { nationId }),
});

const readInteger = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.floor(parsed) : null;
    }
    return null;
};

const readWarSettingRemain = (meta: Record<string, unknown>): number => {
    const legacy = readInteger(meta.available_war_setting_cnt);
    const migrated = readInteger(meta.availableWarSettingCnt);
    // Ref treats an absent counter as zero. The monthly refill creates it;
    // a missing legacy migration value must not grant ten extra changes.
    const value = legacy ?? migrated ?? 0;
    return Math.max(0, Math.min(MAX_AVAILABLE_WAR_SETTING_COUNT, value));
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

const buildRevision = (acceptedAt: Date, requestId: string): string => {
    const suffix = createHash('sha256').update(requestId).digest('hex').slice(0, 16);
    return `${acceptedAt.toISOString()}#${suffix}`;
};

export const applyNationSettingMutation = (options: {
    world: InMemoryTurnWorld;
    command: SetNationSettingCommand;
    acceptedAt: Date;
}): SetNationSettingResult => {
    const { world, command, acceptedAt } = options;
    const actor = world.getGeneralById(command.generalId);
    if (!actor) {
        return reject('NOT_FOUND', '장수 정보를 찾을 수 없습니다.');
    }
    if (actor.userId !== command.userId) {
        return reject('FORBIDDEN', '인증된 사용자와 장수의 소유자가 일치하지 않습니다.');
    }
    if (actor.nationId <= 0 || actor.nationId !== command.nationId) {
        return reject('PRECONDITION_FAILED', '국가에 소속되어있지 않거나 소속 국가가 변경되었습니다.');
    }

    const nation = world.getNationById(command.nationId);
    if (!nation) {
        return reject('NOT_FOUND', '국가 정보를 찾을 수 없습니다.', command.nationId);
    }
    const permission = resolveTroopSecretPermission(actor, nation.meta, false);
    if (permission < 0 || (actor.officerLevel < 5 && permission !== 4)) {
        return reject('FORBIDDEN', '권한이 부족합니다.', command.nationId);
    }

    const currentMeta = asRecord(nation.meta);
    let updates: Record<string, unknown>;
    let availableCnt: number | undefined;
    switch (command.mutation.kind) {
        case 'notice': {
            const message = command.mutation.message;
            if (Array.from(message).length > 16_384) {
                return reject('BAD_REQUEST', '올바른 국가 방침을 입력해주세요.', command.nationId);
            }
            updates = {
                notice: message,
                nationNotice: {
                    date: formatServerDateTime(world.getGameNow(acceptedAt)),
                    msg: message,
                    author: actor.name,
                    authorID: actor.id,
                },
            };
            break;
        }
        case 'scoutMessage': {
            const message = command.mutation.message;
            if (Array.from(message).length > 1_000) {
                return reject('BAD_REQUEST', '올바른 임관 권유문을 입력해주세요.', command.nationId);
            }
            updates = { infoText: message };
            break;
        }
        case 'rate':
            if (!Number.isInteger(command.mutation.amount) || command.mutation.amount < 5 || command.mutation.amount > 30) {
                return reject('BAD_REQUEST', '올바른 세율을 입력해주세요.', command.nationId);
            }
            updates = { rate: command.mutation.amount };
            break;
        case 'bill':
            if (
                !Number.isInteger(command.mutation.amount) ||
                command.mutation.amount < 20 ||
                command.mutation.amount > 200
            ) {
                return reject('BAD_REQUEST', '올바른 지급률을 입력해주세요.', command.nationId);
            }
            updates = { bill: command.mutation.amount };
            break;
        case 'secretLimit':
            if (!Number.isInteger(command.mutation.amount) || command.mutation.amount < 1 || command.mutation.amount > 99) {
                return reject('BAD_REQUEST', '올바른 기밀 공개 기준을 입력해주세요.', command.nationId);
            }
            updates = { secretlimit: command.mutation.amount };
            break;
        case 'blockWar': {
            const remain = readWarSettingRemain(currentMeta);
            if (remain <= 0) {
                return reject('BAD_REQUEST', '잔여 횟수가 부족합니다.', command.nationId);
            }
            availableCnt = remain - 1;
            updates = {
                war: command.mutation.value ? 1 : 0,
                available_war_setting_cnt: availableCnt,
            };
            break;
        }
        case 'blockScout':
            if (isLegacyTruthy(asRecord(world.getState().meta).block_change_scout)) {
                return reject('FORBIDDEN', '임관 설정을 바꿀 수 없도록 설정되어 있습니다.', command.nationId);
            }
            updates = { scout: command.mutation.value ? 1 : 0 };
            break;
    }

    const updatedAt = buildRevision(acceptedAt, command.requestId ?? `${command.type}:${command.generalId}`);
    world.updateNation(command.nationId, {
        meta: {
            ...nation.meta,
            ...updates,
            _updatedAt: updatedAt,
        },
    });
    return {
        type: 'setNationSetting',
        ok: true,
        nationId: command.nationId,
        updatedAt,
        ...(availableCnt === undefined ? {} : { availableCnt }),
    };
};
