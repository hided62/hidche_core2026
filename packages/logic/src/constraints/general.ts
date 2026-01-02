import type { General } from '../domain/entities.js';
import { allow, readDestGeneral, resolveDestGeneralId, unknownOrDeny } from './helpers.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from './types.js';

export const notBeNeutral = (): Constraint => ({
    name: 'NotBeNeutral',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general.nationId !== 0) {
            return allow();
        }
        return { kind: 'deny', reason: '재야입니다.' };
    },
});

export const beNeutral = (): Constraint => ({
    name: 'BeNeutral',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general.nationId === 0) {
            return allow();
        }
        return { kind: 'deny', reason: '이미 국가에 속해 있습니다.' };
    },
});

export const beChief = (): Constraint => ({
    name: 'BeChief',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general.officerLevel > 4) {
            return allow();
        }
        return { kind: 'deny', reason: '수뇌가 아닙니다.' };
    },
});

export const reqGeneralGold = (
    getRequiredGold: (ctx: ConstraintContext, view: StateView) => number,
    requirements: RequirementKey[] = []
): Constraint => ({
    name: 'ReqGeneralGold',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }, ...requirements],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        const missing = [generalReq, ...requirements].filter(
            (req) => !view.has(req)
        );
        if (missing.length > 0) {
            return unknownOrDeny(ctx, missing, '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const required = getRequiredGold(ctx, view);
        if (general.gold >= required) {
            return allow();
        }
        return { kind: 'deny', reason: '자금이 모자랍니다.' };
    },
});

export const reqGeneralRice = (
    getRequiredRice: (ctx: ConstraintContext, view: StateView) => number,
    requirements: RequirementKey[] = []
): Constraint => ({
    name: 'ReqGeneralRice',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }, ...requirements],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        const missing = [generalReq, ...requirements].filter(
            (req) => !view.has(req)
        );
        if (missing.length > 0) {
            return unknownOrDeny(ctx, missing, '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const required = getRequiredRice(ctx, view);
        if (general.rice >= required) {
            return allow();
        }
        return { kind: 'deny', reason: '군량이 모자랍니다.' };
    },
});

export const reqGeneralCrewMargin = (
    getCrewTypeId: (ctx: ConstraintContext, view: StateView) => number | null,
    requirements: RequirementKey[] = []
): Constraint => ({
    name: 'ReqGeneralCrewMargin',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }, ...requirements],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        const missing = [generalReq, ...requirements].filter(
            (req) => !view.has(req)
        );
        if (missing.length > 0) {
            return unknownOrDeny(ctx, missing, '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const crewTypeId = getCrewTypeId(ctx, view);
        if (crewTypeId === null) {
            return unknownOrDeny(ctx, requirements, '병종 정보가 없습니다.');
        }
        if (crewTypeId !== general.crewTypeId) {
            return allow();
        }
        const maxCrew = general.stats.leadership * 100;
        if (maxCrew > general.crew) {
            return allow();
        }
        return { kind: 'deny', reason: '이미 많은 병력을 보유하고 있습니다.' };
    },
});

export const existsDestGeneral = (): Constraint => ({
    name: 'ExistsDestGeneral',
    requires: (ctx) =>
        resolveDestGeneralId(ctx) !== undefined
            ? [
                  {
                      kind: 'destGeneral',
                      id: resolveDestGeneralId(ctx) ?? 0,
                  },
              ]
            : [],
    test: (ctx, view) => {
        const destGeneralId = resolveDestGeneralId(ctx);
        if (destGeneralId === undefined) {
            return unknownOrDeny(ctx, [], '장수 정보가 없습니다.');
        }
        const req: RequirementKey = { kind: 'destGeneral', id: destGeneralId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return { kind: 'deny', reason: '장수 정보가 없습니다.' };
        }
        return allow();
    },
});

export const friendlyDestGeneral = (): Constraint => ({
    name: 'FriendlyDestGeneral',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        const destGeneralId = resolveDestGeneralId(ctx);
        if (destGeneralId !== undefined) {
            reqs.push({ kind: 'destGeneral', id: destGeneralId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const destGeneral = readDestGeneral(ctx, view);
        if (!destGeneral) {
            const destGeneralId = resolveDestGeneralId(ctx);
            if (destGeneralId === undefined) {
                return unknownOrDeny(ctx, [], '장수 정보가 없습니다.');
            }
            const req: RequirementKey = {
                kind: 'destGeneral',
                id: destGeneralId,
            };
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (destGeneral.nationId === general.nationId) {
            return allow();
        }
        return { kind: 'deny', reason: '아군이 아닙니다.' };
    },
});
