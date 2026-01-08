import type { General, Nation } from '@sammo-ts/logic/domain/entities.js';
import { allow, readGeneral, readMetaNumber, readNation, resolveDestNationId, unknownOrDeny } from './helpers.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from './types.js';

export const notWanderingNation = (): Constraint => ({
    name: 'NotWanderingNation',
    requires: (ctx) => (ctx.nationId !== undefined ? [{ kind: 'nation', id: ctx.nationId }] : []),
    test: (ctx, view) => {
        const nation = readNation(view, ctx.nationId);
        if (!nation) {
            if (ctx.nationId === undefined) {
                return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'nation', id: ctx.nationId };
            return unknownOrDeny(ctx, [req], '국가 정보가 없습니다.');
        }
        if (nation.level !== 0) {
            return allow();
        }
        return { kind: 'deny', reason: '방랑군은 불가능합니다.' };
    },
});

export const beWanderingNation = (): Constraint => ({
    name: 'BeWanderingNation',
    requires: (ctx) => (ctx.nationId !== undefined ? [{ kind: 'nation', id: ctx.nationId }] : []),
    test: (ctx, view) => {
        const nation = readNation(view, ctx.nationId);
        if (!nation) {
            if (ctx.nationId === undefined) {
                return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'nation', id: ctx.nationId };
            return unknownOrDeny(ctx, [req], '국가 정보가 없습니다.');
        }
        if (nation.level === 0) {
            return allow();
        }
        return { kind: 'deny', reason: '방랑군이 아닙니다.' };
    },
});

export const availableStrategicCommand = (allowTurnCnt = 0): Constraint => ({
    name: 'AvailableStrategicCommand',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        if (ctx.nationId !== undefined) {
            reqs.push({ kind: 'nation', id: ctx.nationId });
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
        const nationId = ctx.nationId ?? general.nationId;
        if (!nationId) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const nationReq: RequirementKey = { kind: 'nation', id: nationId };
        if (!view.has(nationReq)) {
            return unknownOrDeny(ctx, [nationReq], '국가 정보가 없습니다.');
        }
        const nation = view.get(nationReq) as Nation | null;
        if (!nation) {
            return unknownOrDeny(ctx, [nationReq], '국가 정보가 없습니다.');
        }
        const limit = readMetaNumber(nation.meta, 'strategic_cmd_limit');
        if (limit === null) {
            return unknownOrDeny(ctx, [nationReq], '전략기한 정보가 없습니다.');
        }
        if (limit <= allowTurnCnt) {
            return allow();
        }
        return { kind: 'deny', reason: '전략기한이 남았습니다.' };
    },
});

export const reqNationGold = (
    getRequiredGold: (ctx: ConstraintContext, view: StateView) => number,
    requirements: RequirementKey[] = []
): Constraint => ({
    name: 'ReqNationGold',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [...requirements];
        if (ctx.nationId !== undefined) {
            reqs.push({ kind: 'nation', id: ctx.nationId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const nationId = ctx.nationId;
        if (nationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const nationReq: RequirementKey = { kind: 'nation', id: nationId };
        const missing = [nationReq, ...requirements].filter((req) => !view.has(req));
        if (missing.length > 0) {
            return unknownOrDeny(ctx, missing, '국가 정보가 없습니다.');
        }
        const nation = view.get(nationReq) as Nation | null;
        if (!nation) {
            return unknownOrDeny(ctx, [nationReq], '국가 정보가 없습니다.');
        }
        const required = getRequiredGold(ctx, view);
        if (nation.gold >= required) {
            return allow();
        }
        return { kind: 'deny', reason: '자금이 모자랍니다.' };
    },
});

export const reqNationRice = (
    getRequiredRice: (ctx: ConstraintContext, view: StateView) => number,
    requirements: RequirementKey[] = []
): Constraint => ({
    name: 'ReqNationRice',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [...requirements];
        if (ctx.nationId !== undefined) {
            reqs.push({ kind: 'nation', id: ctx.nationId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const nationId = ctx.nationId;
        if (nationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const nationReq: RequirementKey = { kind: 'nation', id: nationId };
        const missing = [nationReq, ...requirements].filter((req) => !view.has(req));
        if (missing.length > 0) {
            return unknownOrDeny(ctx, missing, '국가 정보가 없습니다.');
        }
        const nation = view.get(nationReq) as Nation | null;
        if (!nation) {
            return unknownOrDeny(ctx, [nationReq], '국가 정보가 없습니다.');
        }
        const required = getRequiredRice(ctx, view);
        if (nation.rice >= required) {
            return allow();
        }
        return { kind: 'deny', reason: '군량이 모자랍니다.' };
    },
});

export const existsDestNation = (): Constraint => ({
    name: 'ExistsDestNation',
    requires: (ctx) =>
        resolveDestNationId(ctx) !== undefined
            ? [
                  {
                      kind: 'destNation',
                      id: resolveDestNationId(ctx) ?? 0,
                  },
              ]
            : [],
    test: (ctx, view) => {
        const destNationId = resolveDestNationId(ctx);
        if (destNationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const req: RequirementKey = { kind: 'destNation', id: destNationId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '국가 정보가 없습니다.');
        }
        const nation = view.get(req) as Nation | null;
        if (!nation) {
            return unknownOrDeny(ctx, [req], '국가 정보가 없습니다.');
        }
        return allow();
    },
});

export const differentDestNation = (): Constraint => ({
    name: 'DifferentDestNation',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [];
        if (ctx.nationId !== undefined) {
            reqs.push({ kind: 'nation', id: ctx.nationId });
        } else {
            reqs.push({ kind: 'general', id: ctx.actorId });
        }
        const destNationId = resolveDestNationId(ctx);
        if (destNationId !== undefined) {
            reqs.push({ kind: 'destNation', id: destNationId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const destNationId = resolveDestNationId(ctx);
        if (destNationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        let baseNationId = ctx.nationId;
        if (baseNationId === undefined) {
            const general = readGeneral(ctx, view);
            if (!general) {
                const req: RequirementKey = {
                    kind: 'general',
                    id: ctx.actorId,
                };
                return unknownOrDeny(ctx, [req], '국가 정보가 없습니다.');
            }
            baseNationId = general.nationId;
        }
        if (baseNationId === destNationId) {
            return { kind: 'deny', reason: '같은 국가입니다.' };
        }
        return allow();
    },
});

export const reqNationGeneralCount = (min: number): Constraint => ({
    name: 'ReqNationGeneralCount',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'generalList' }];
        if (ctx.nationId !== undefined) {
            reqs.push({ kind: 'nation', id: ctx.nationId });
        } else {
            reqs.push({ kind: 'general', id: ctx.actorId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const listReq: RequirementKey = { kind: 'generalList' };
        if (!view.has(listReq)) {
            return unknownOrDeny(ctx, [listReq], '장수가 없습니다.');
        }
        const generals = view.get(listReq) as General[] | null;
        if (!generals) {
            return unknownOrDeny(ctx, [listReq], '장수가 없습니다.');
        }

        let baseNationId = ctx.nationId;
        if (baseNationId === undefined) {
            const general = readGeneral(ctx, view);
            if (!general) {
                const req: RequirementKey = {
                    kind: 'general',
                    id: ctx.actorId,
                };
                return unknownOrDeny(ctx, [req], '장수가 없습니다.');
            }
            baseNationId = general.nationId;
        }

        const count = generals.filter((g) => g.nationId === baseNationId).length;
        if (count >= min) {
            return allow();
        }
        return { kind: 'deny', reason: `국가 소속 장수가 부족합니다. (필요: ${min}, 현재: ${count})` };
    },
});

export const checkNationNameDuplicate = (name: string): Constraint => ({
    name: 'CheckNationNameDuplicate',
    requires: () => [{ kind: 'nationList' }],
    test: (_ctx, view) => {
        const nations = view.get({ kind: 'nationList' }) as Nation[] | null;
        if (!nations) {
            return { kind: 'unknown', missing: [{ kind: 'nationList' }] };
        }
        if (nations.some((n) => n.name === name)) {
            return { kind: 'deny', reason: '이미 존재하는 국가 이름입니다.' };
        }
        return allow();
    },
});
