import type { City, General, Nation, TriggerValue } from '../domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
    ConstraintResult,
    RequirementKey,
    StateView,
} from './types.js';

const allow = (): ConstraintResult => ({ kind: 'allow' });

const unknownOrDeny = (
    ctx: ConstraintContext,
    missing: RequirementKey[],
    reason: string
): ConstraintResult =>
    ctx.mode === 'precheck'
        ? { kind: 'unknown', missing }
        : { kind: 'deny', reason };

const readGeneral = (
    ctx: ConstraintContext,
    view: StateView
): General | null => {
    const req: RequirementKey = { kind: 'general', id: ctx.actorId };
    if (!view.has(req)) {
        return null;
    }
    return view.get(req) as General | null;
};

const readCity = (view: StateView, id?: number): City | null => {
    if (id === undefined) {
        return null;
    }
    const req: RequirementKey = { kind: 'city', id };
    if (!view.has(req)) {
        return null;
    }
    return view.get(req) as City | null;
};

const readDestGeneral = (
    ctx: ConstraintContext,
    view: StateView
): General | null => {
    const destGeneralId = resolveDestGeneralId(ctx);
    if (destGeneralId === undefined) {
        return null;
    }
    const req: RequirementKey = { kind: 'destGeneral', id: destGeneralId };
    if (!view.has(req)) {
        return null;
    }
    return view.get(req) as General | null;
};

const resolveDestCityId = (ctx: ConstraintContext): number | undefined => {
    if (ctx.destCityId !== undefined) {
        return ctx.destCityId;
    }
    const raw = ctx.args?.destCityId;
    return typeof raw === 'number' ? raw : undefined;
};

const resolveDestGeneralId = (ctx: ConstraintContext): number | undefined => {
    if (ctx.destGeneralId !== undefined) {
        return ctx.destGeneralId;
    }
    const raw = ctx.args?.destGeneralId;
    return typeof raw === 'number' ? raw : undefined;
};

const resolveDestNationId = (ctx: ConstraintContext): number | undefined => {
    if (ctx.destNationId !== undefined) {
        return ctx.destNationId;
    }
    const raw = ctx.args?.destNationId;
    return typeof raw === 'number' ? raw : undefined;
};

const readDestCity = (
    ctx: ConstraintContext,
    view: StateView
): City | null => {
    const destCityId = resolveDestCityId(ctx);
    return readCity(view, destCityId);
};

const readNation = (
    view: StateView,
    id?: number
): Nation | null => {
    if (id === undefined) {
        return null;
    }
    const req: RequirementKey = { kind: 'nation', id };
    if (!view.has(req)) {
        return null;
    }
    return view.get(req) as Nation | null;
};

const readMetaNumber = (
    meta: Record<string, TriggerValue>,
    key: string
): number | null => {
    const value = meta[key];
    return typeof value === 'number' ? value : null;
};

const readDiplomacyState = (
    view: StateView,
    srcNationId: number,
    destNationId: number
): number | null => {
    const req: RequirementKey = {
        kind: 'diplomacy',
        srcNationId,
        destNationId,
    };
    if (!view.has(req)) {
        return null;
    }
    const value = view.get(req);
    if (typeof value === 'number') {
        return value;
    }
    if (value && typeof value === 'object') {
        const state = (value as { state?: number; stateCode?: number }).state;
        const stateCode = (value as { state?: number; stateCode?: number }).stateCode;
        if (typeof state === 'number') {
            return state;
        }
        if (typeof stateCode === 'number') {
            return stateCode;
        }
    }
    return null;
};

const readMetaNumberFromUnknown = (
    meta: Record<string, unknown>,
    key: string
): number | null => {
    const value = meta[key];
    return typeof value === 'number' ? value : null;
};

const parsePercent = (value: string): number | null => {
    const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
    if (!match) {
        return null;
    }
    return Number(match[1]) / 100;
};

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

export const alwaysFail = (reason: string): Constraint => ({
    name: 'AlwaysFail',
    requires: () => [],
    test: () => ({ kind: 'deny', reason }),
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

export const notWanderingNation = (): Constraint => ({
    name: 'NotWanderingNation',
    requires: (ctx) =>
        ctx.nationId !== undefined
            ? [{ kind: 'nation', id: ctx.nationId }]
            : [],
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

export const availableStrategicCommand = (
    allowTurnCnt = 0
): Constraint => ({
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
        const missing = [nationReq, ...requirements].filter(
            (req) => !view.has(req)
        );
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
        const missing = [nationReq, ...requirements].filter(
            (req) => !view.has(req)
        );
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

export const notOpeningPart = (
    relYear: number,
    openingPartYear: number
): Constraint => ({
    name: 'NotOpeningPart',
    requires: () => [],
    test: (_ctx) => {
        if (relYear >= openingPartYear) {
            return allow();
        }
        return { kind: 'deny', reason: '초반 제한 중에는 불가능합니다.' };
    },
});

export const occupiedCity = (
    options: { allowNeutral?: boolean } = {}
): Constraint => ({
    name: 'OccupiedCity',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        if (ctx.cityId !== undefined) {
            reqs.push({ kind: 'city', id: ctx.cityId });
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
        if (options.allowNeutral && general.nationId === 0) {
            return allow();
        }
        const cityId = ctx.cityId ?? general.cityId;
        const cityReq: RequirementKey = { kind: 'city', id: cityId };
        if (!view.has(cityReq)) {
            return unknownOrDeny(ctx, [cityReq], '도시 정보가 없습니다.');
        }
        const city = view.get(cityReq) as City | null;
        if (!city) {
            return unknownOrDeny(ctx, [cityReq], '도시 정보가 없습니다.');
        }
        if (city.nationId === general.nationId) {
            return allow();
        }
        return { kind: 'deny', reason: '아국이 아닙니다.' };
    },
});

export const occupiedDestCity = (): Constraint => ({
    name: 'OccupiedDestCity',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        const destCityId = resolveDestCityId(ctx);
        if (destCityId !== undefined) {
            reqs.push({ kind: 'destCity', id: destCityId });
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
        const destCity = readDestCity(ctx, view);
        if (!destCity) {
            const destCityId = resolveDestCityId(ctx);
            if (destCityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = {
                kind: 'destCity',
                id: destCityId,
            };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const baseNationId = ctx.nationId ?? general.nationId;
        if (destCity.nationId === baseNationId) {
            return allow();
        }
        return { kind: 'deny', reason: '아국이 아닙니다.' };
    },
});

export const suppliedCity = (): Constraint => ({
    name: 'SuppliedCity',
    requires: (ctx) =>
        ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : [],
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        if (city.supplyState) {
            return allow();
        }
        return { kind: 'deny', reason: '고립된 도시입니다.' };
    },
});

export const suppliedDestCity = (): Constraint => ({
    name: 'SuppliedDestCity',
    requires: (ctx) =>
        resolveDestCityId(ctx) !== undefined
            ? [
                  {
                      kind: 'destCity',
                      id: resolveDestCityId(ctx) ?? 0,
                  },
              ]
            : [],
    test: (ctx, view) => {
        const destCity = readDestCity(ctx, view);
        if (!destCity) {
            const destCityId = resolveDestCityId(ctx);
            if (destCityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = {
                kind: 'destCity',
                id: destCityId,
            };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        if (destCity.supplyState) {
            return allow();
        }
        return { kind: 'deny', reason: '고립된 도시입니다.' };
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

export const remainCityCapacity = (
    key: string,
    label: string
): Constraint => ({
    name: 'RemainCityCapacity',
    requires: (ctx) =>
        ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : [],
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const record = city as unknown as Record<string, number | undefined>;
        const maxKey = `${key}_max`;
        const current = record[key];
        const max = record[maxKey];
        if (current === undefined || max === undefined) {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }
        if (current < max) {
            return allow();
        }
        return { kind: 'deny', reason: `${label}이 충분합니다.` };
    },
});

export const remainCityCapacityByMax = (
    key: string,
    maxKey: string,
    label: string
): Constraint => ({
    name: 'RemainCityCapacityByMax',
    requires: (ctx) =>
        ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : [],
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const record = city as unknown as Record<string, number | undefined>;
        const current = record[key];
        const max = record[maxKey];
        if (current === undefined || max === undefined) {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }
        if (current < max) {
            return allow();
        }
        return { kind: 'deny', reason: `${label}이 충분합니다.` };
    },
});

export const reqCityCapacity = (
    key: string,
    label: string,
    required: number | string
): Constraint => ({
    name: 'ReqCityCapacity',
    requires: (ctx) =>
        ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : [],
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const record = city as unknown as Record<string, number | undefined>;
        const current = record[key];
        if (current === undefined) {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }
        if (typeof required === 'string') {
            const ratio = parsePercent(required);
            const maxKey = `${key}Max`;
            const max = record[maxKey];
            if (ratio === null || max === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            if (current >= max * ratio) {
                return allow();
            }
        } else if (current >= required) {
            return allow();
        }
        return { kind: 'deny', reason: `${label}이 부족합니다.` };
    },
});

export const reqCityTrust = (minTrust: number): Constraint => ({
    name: 'ReqCityTrust',
    requires: (ctx) =>
        ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : [],
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const trust =
            readMetaNumberFromUnknown(
                city.meta as Record<string, unknown>,
                'trust'
            ) ?? null;
        if (trust === null) {
            return unknownOrDeny(ctx, [], '민심 정보가 없습니다.');
        }
        if (trust >= minTrust) {
            return allow();
        }
        return { kind: 'deny', reason: '민심이 낮아 주민들이 도망갑니다.' };
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

export const existsDestCity = (): Constraint => ({
    name: 'ExistsDestCity',
    requires: (ctx) =>
        resolveDestCityId(ctx) !== undefined
            ? [
                  {
                      kind: 'destCity',
                      id: resolveDestCityId(ctx) ?? 0,
                  },
              ]
            : [],
    test: (ctx, view) => {
        const destCityId = resolveDestCityId(ctx);
        if (destCityId === undefined) {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }
        const req: RequirementKey = { kind: 'destCity', id: destCityId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const city = view.get(req) as City | null;
        if (!city) {
            return { kind: 'deny', reason: '도시 정보가 없습니다.' };
        }
        return allow();
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

export const notOccupiedDestCity = (): Constraint => ({
    name: 'NotOccupiedDestCity',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        const destCityId = resolveDestCityId(ctx);
        if (destCityId !== undefined) {
            reqs.push({ kind: 'destCity', id: destCityId });
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
        const destCity = readDestCity(ctx, view);
        if (!destCity) {
            const destCityId = resolveDestCityId(ctx);
            if (destCityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = {
                kind: 'destCity',
                id: destCityId,
            };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        if (destCity.nationId !== general.nationId) {
            return allow();
        }
        return { kind: 'deny', reason: '아국입니다.' };
    },
});

export const notNeutralDestCity = (): Constraint => ({
    name: 'NotNeutralDestCity',
    requires: (ctx) =>
        resolveDestCityId(ctx) !== undefined
            ? [
                  {
                      kind: 'destCity',
                      id: resolveDestCityId(ctx) ?? 0,
                  },
              ]
            : [],
    test: (ctx, view) => {
        const destCity = readDestCity(ctx, view);
        if (!destCity) {
            const destCityId = resolveDestCityId(ctx);
            if (destCityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = {
                kind: 'destCity',
                id: destCityId,
            };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        if (destCity.nationId !== 0) {
            return allow();
        }
        return { kind: 'deny', reason: '공백지입니다.' };
    },
});

export const disallowDiplomacyBetweenStatus = (
    disallowList: Record<number, string>
): Constraint => ({
    name: 'DisallowDiplomacyBetweenStatus',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [];
        if (ctx.nationId !== undefined) {
            reqs.push({ kind: 'nation', id: ctx.nationId });
        }
        const destNationId = resolveDestNationId(ctx);
        if (destNationId !== undefined) {
            reqs.push({ kind: 'destNation', id: destNationId });
            if (ctx.nationId !== undefined) {
                reqs.push({
                    kind: 'diplomacy',
                    srcNationId: ctx.nationId,
                    destNationId,
                });
            }
        }
        const destCityId = resolveDestCityId(ctx);
        if (destCityId !== undefined) {
            reqs.push({ kind: 'destCity', id: destCityId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const general = readGeneral(ctx, view);
        const baseNationId = ctx.nationId ?? general?.nationId;
        if (baseNationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const destCity = readDestCity(ctx, view);
        const destNationId =
            resolveDestNationId(ctx) ?? destCity?.nationId;
        if (destNationId === undefined) {
            return unknownOrDeny(ctx, [], '상대 국가 정보가 없습니다.');
        }
        const state = readDiplomacyState(view, baseNationId, destNationId);
        if (state === null) {
            const req: RequirementKey = {
                kind: 'diplomacy',
                srcNationId: baseNationId,
                destNationId,
            };
            return unknownOrDeny(ctx, [req], '외교 정보가 없습니다.');
        }
        const reason = disallowList[state];
        if (reason !== undefined) {
            return { kind: 'deny', reason };
        }
        return allow();
    },
});
