import type { General } from '@sammo-ts/logic/domain/entities.js';
import { allow, unknownOrDeny } from './helpers.js';
import type { Constraint, RequirementKey } from './types.js';

export const mustBeTroopLeader = (): Constraint => ({
    name: 'mustBeTroopLeader',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        if (general.id === general.troopId) {
            return allow();
        }
        return { kind: 'deny', reason: '부대장이 아닙니다.' };
    },
});

export const reqTroopMembers = (): Constraint => ({
    name: 'reqTroopMembers',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }, { kind: 'generalList' }],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const listReq: RequirementKey = { kind: 'generalList' };
        if (!view.has(listReq)) {
            return unknownOrDeny(ctx, [listReq], '장수 정보가 없습니다.');
        }
        const generals = view.get(listReq) as General[] | null;
        if (!generals) {
            return unknownOrDeny(ctx, [listReq], '장수 정보가 없습니다.');
        }
        const hasMember = generals.some((entry) => entry.troopId === general.troopId && entry.id !== general.id);
        if (hasMember) {
            return allow();
        }
        return { kind: 'deny', reason: '집합 가능한 부대원이 없습니다.' };
    },
});
