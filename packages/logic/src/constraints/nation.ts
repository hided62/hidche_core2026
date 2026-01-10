import type { City, General, Nation } from '@sammo-ts/logic/domain/entities.js';
import { allow, readGeneral, readMetaNumber, readNation, resolveDestNationId, unknownOrDeny } from './helpers.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from './types.js';

export const notWanderingNation = (): Constraint => ({
    name: 'notWanderingNation',
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
    name: 'beWanderingNation',
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
    name: 'availableStrategicCommand',
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
    name: 'reqNationGold',
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
    name: 'reqNationRice',
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
    name: 'existsDestNation',
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
    name: 'differentDestNation',
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
    name: 'reqNationGeneralCount',
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
    name: 'checkNationNameDuplicate',
    requires: () => [{ kind: 'nationList' }],
    test: (ctx, view) => {
        const nations = view.get({ kind: 'nationList' }) as Nation[] | null;
        if (!nations) {
            return { kind: 'unknown', missing: [{ kind: 'nationList' }] };
        }
        if (nations.some((n) => n.name === name && n.id !== ctx.nationId)) {
            return { kind: 'deny', reason: '이미 존재하는 국가 이름입니다.' };
        }
        return allow();
    },
});

export const nearNation = (): Constraint => ({
    name: 'nearNation',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [
            { kind: 'env', key: 'cities' },
            { kind: 'env', key: 'map' },
        ];
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
        const cities = view.get({ kind: 'env', key: 'cities' }) as City[] | null;
        const map = view.get({ kind: 'env', key: 'map' }) as {
            cities: Array<{ id: number; connections: number[] }>;
        } | null;
        if (!cities || !map) {
            return unknownOrDeny(ctx, [], '지도 정보가 없습니다.');
        }

        const destNationId = resolveDestNationId(ctx);
        if (destNationId === undefined) {
            return unknownOrDeny(ctx, [], '상대 국가 정보가 없습니다.');
        }

        let baseNationId = ctx.nationId;
        if (baseNationId === undefined) {
            const general = readGeneral(ctx, view);
            if (!general) {
                return unknownOrDeny(ctx, [], '아국 정보가 없습니다.');
            }
            baseNationId = general.nationId;
        }

        const baseNationCityIds = new Set(cities.filter((c) => c.nationId === baseNationId).map((c) => c.id));
        const destNationCityIds = new Set(cities.filter((c) => c.nationId === destNationId).map((c) => c.id));

        if (baseNationCityIds.size === 0) {
            return { kind: 'deny', reason: '아국 도시가 없습니다.' };
        }
        if (destNationCityIds.size === 0) {
            return { kind: 'deny', reason: '상대 국가 도시가 없습니다.' };
        }

        for (const cityId of baseNationCityIds) {
            const cityDef = map.cities.find((c) => c.id === cityId);
            if (!cityDef) continue;
            for (const neighborId of cityDef.connections) {
                if (destNationCityIds.has(neighborId)) {
                    return allow();
                }
            }
        }

        return { kind: 'deny', reason: '인접 국가가 아닙니다.' };
    },
});
