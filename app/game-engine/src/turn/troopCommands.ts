import { JosaUtil } from '@sammo-ts/common';
import {
    isValidTroopNameWidth,
    LogCategory,
    LogFormat,
    LogScope,
    normalizeTroopName,
    resolveTroopSecretPermission,
} from '@sammo-ts/logic';

import type { TurnDaemonCommand, TurnDaemonCommandResult } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import {
    hasScenarioStaticEventHandler,
    IMMEDIATE_TROOP_JOIN_MOVE_HANDLER,
    LEGACY_TROOP_JOIN_EVENT,
} from './scenarioStaticEvents.js';

const TROOP_COMMAND_TYPES = ['troopCreate', 'troopJoin', 'troopExit', 'troopKick', 'troopRename'] as const;
const troopCommandTypes = new Set<TurnDaemonCommand['type']>(TROOP_COMMAND_TYPES);

export type TroopCommand = Extract<TurnDaemonCommand, { type: (typeof TROOP_COMMAND_TYPES)[number] }>;

export const isTroopCommand = (command: TurnDaemonCommand): command is TroopCommand =>
    troopCommandTypes.has(command.type);

export const handleTroopCommand = (world: InMemoryTurnWorld, command: TroopCommand): TurnDaemonCommandResult => {
    switch (command.type) {
        case 'troopCreate':
            return handleTroopCreate(world, command);
        case 'troopJoin':
            return handleTroopJoin(world, command);
        case 'troopExit':
            return handleTroopExit(world, command);
        case 'troopKick':
            return handleTroopKick(world, command);
        case 'troopRename':
            return handleTroopRename(world, command);
    }
};

function handleTroopJoin(
    world: InMemoryTurnWorld,
    command: Extract<TurnDaemonCommand, { type: 'troopJoin' }>
): TurnDaemonCommandResult {
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'troopJoin',
            ok: false,
            generalId: command.generalId,
            troopId: command.troopId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }
    if (general.troopId !== 0) {
        return {
            type: 'troopJoin',
            ok: false,
            generalId: command.generalId,
            troopId: command.troopId,
            reason: '이미 부대에 소속되어 있습니다.',
        };
    }
    if (general.nationId <= 0) {
        return {
            type: 'troopJoin',
            ok: false,
            generalId: command.generalId,
            troopId: command.troopId,
            reason: '국가에 소속되어 있지 않습니다.',
        };
    }

    const troop = world.getTroopById(command.troopId);
    if (!troop || troop.nationId !== general.nationId) {
        return {
            type: 'troopJoin',
            ok: false,
            generalId: command.generalId,
            troopId: command.troopId,
            reason: '부대가 올바르지 않습니다.',
        };
    }

    world.updateGeneral(command.generalId, {
        troopId: command.troopId,
    });
    if (
        hasScenarioStaticEventHandler(
            world.getScenarioConfig(),
            LEGACY_TROOP_JOIN_EVENT,
            IMMEDIATE_TROOP_JOIN_MOVE_HANDLER
        )
    ) {
        const leader = world.getGeneralById(troop.id);
        if (
            leader &&
            leader.troopId === leader.id &&
            leader.nationId === general.nationId &&
            leader.cityId !== general.cityId
        ) {
            const city = world.getCityById(leader.cityId);
            if (city) {
                world.updateGeneral(command.generalId, {
                    troopId: command.troopId,
                    cityId: leader.cityId,
                });
                const josaRo = JosaUtil.pick(city.name, '로');
                world.pushLog({
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                    text: `부대 주둔지인 <G><b>${city.name}</b></>${josaRo} 즉시 이동합니다.`,
                    generalId: general.id,
                    meta: {},
                });
            }
        }
    }
    return {
        type: 'troopJoin',
        ok: true,
        generalId: command.generalId,
        troopId: command.troopId,
    };
}

function handleTroopCreate(
    world: InMemoryTurnWorld,
    command: Extract<TurnDaemonCommand, { type: 'troopCreate' }>
): TurnDaemonCommandResult {
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }

    const troopName = normalizeTroopName(command.troopName);
    if (!troopName) {
        return { type: 'troopCreate', ok: false, generalId: command.generalId, reason: '부대 이름이 없습니다.' };
    }
    if (!isValidTroopNameWidth(troopName)) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '부대 이름은 전각 9자 또는 반각 18자 이하여야 합니다.',
        };
    }
    if (general.troopId !== 0 || world.getTroopById(general.id)) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '이미 부대에 소속되어 있습니다.',
        };
    }
    if (general.nationId <= 0 || !world.getNationById(general.nationId)) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '국가에 소속되어 있지 않습니다.',
        };
    }

    const troop = world.createTroop({
        id: general.id,
        nationId: general.nationId,
        name: troopName,
    });
    if (!troop) {
        return {
            type: 'troopCreate',
            ok: false,
            generalId: command.generalId,
            reason: '부대가 생성되지 않았습니다. 버그일 수 있습니다.',
        };
    }
    world.updateGeneral(general.id, { troopId: general.id });
    return {
        type: 'troopCreate',
        ok: true,
        generalId: general.id,
        troopId: troop.id,
        troopName: troop.name,
    };
}

function handleTroopExit(
    world: InMemoryTurnWorld,
    command: Extract<TurnDaemonCommand, { type: 'troopExit' }>
): TurnDaemonCommandResult {
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return {
            type: 'troopExit',
            ok: false,
            generalId: command.generalId,
            reason: '장수 정보를 찾을 수 없습니다.',
        };
    }
    if (general.troopId === 0) {
        return {
            type: 'troopExit',
            ok: false,
            generalId: command.generalId,
            reason: '부대에 소속되어 있지 않습니다.',
        };
    }

    if (general.troopId !== general.id) {
        world.updateGeneral(command.generalId, {
            troopId: 0,
        });
        return {
            type: 'troopExit',
            ok: true,
            generalId: command.generalId,
            wasLeader: false,
        };
    }

    const troopId = general.troopId;
    const members = world.listGenerals().filter((entry) => entry.troopId === troopId);
    for (const member of members) {
        world.updateGeneral(member.id, { troopId: 0 });
    }
    world.removeTroop(troopId);
    return {
        type: 'troopExit',
        ok: true,
        generalId: command.generalId,
        wasLeader: true,
    };
}

function handleTroopKick(
    world: InMemoryTurnWorld,
    command: Extract<TurnDaemonCommand, { type: 'troopKick' }>
): TurnDaemonCommandResult {
    const fail = (reason: string): TurnDaemonCommandResult => ({
        type: 'troopKick',
        ok: false,
        generalId: command.generalId,
        troopId: command.troopId,
        targetGeneralId: command.targetGeneralId,
        reason,
    });
    const actor = world.getGeneralById(command.generalId);
    if (!actor) {
        return fail('장수 정보를 찾을 수 없습니다.');
    }
    const troop = world.getTroopById(command.troopId);
    if (
        command.generalId !== command.troopId ||
        actor.troopId !== actor.id ||
        !troop ||
        troop.id !== actor.id ||
        troop.nationId !== actor.nationId
    ) {
        return fail('권한이 부족합니다.');
    }

    const target = world.getGeneralById(command.targetGeneralId);
    if (!target) {
        return fail('장수 정보를 찾을 수 없습니다.');
    }
    if (target.troopId === 0) {
        return fail('부대에 소속되어 있지 않습니다.');
    }
    if (target.troopId !== command.troopId) {
        return fail('다른 부대에 소속되어 있습니다.');
    }
    if (target.id === command.troopId) {
        return fail('부대장을 추방할 수 없습니다.');
    }

    world.updateGeneral(target.id, { troopId: 0 });
    return {
        type: 'troopKick',
        ok: true,
        generalId: actor.id,
        troopId: troop.id,
        targetGeneralId: target.id,
    };
}

function handleTroopRename(
    world: InMemoryTurnWorld,
    command: Extract<TurnDaemonCommand, { type: 'troopRename' }>
): TurnDaemonCommandResult {
    const fail = (reason: string): TurnDaemonCommandResult => ({
        type: 'troopRename',
        ok: false,
        generalId: command.generalId,
        troopId: command.troopId,
        reason,
    });
    const actor = world.getGeneralById(command.generalId);
    if (!actor) {
        return fail('장수 정보를 찾을 수 없습니다.');
    }

    const nation = world.getNationById(actor.nationId);
    const permission = resolveTroopSecretPermission(actor, nation?.meta ?? {}, false);
    if (actor.id !== command.troopId && permission < 4) {
        return fail('권한이 부족합니다.');
    }

    const troopName = normalizeTroopName(command.troopName);
    if (!troopName) {
        return fail('부대 이름이 없습니다.');
    }
    if (!isValidTroopNameWidth(troopName)) {
        return fail('부대 이름은 전각 9자 또는 반각 18자 이하여야 합니다.');
    }

    const troop = world.getTroopById(command.troopId);
    if (!troop || actor.nationId <= 0 || troop.nationId !== actor.nationId) {
        return fail('부대가 없습니다.');
    }
    world.updateTroop(troop.id, { name: troopName });
    return {
        type: 'troopRename',
        ok: true,
        generalId: actor.id,
        troopId: troop.id,
        troopName,
    };
}
