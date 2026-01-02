import type { City, General } from '../domain/entities.js';
import {
    allow,
    parsePercent,
    readCity,
    readDestCity,
    readMetaNumberFromUnknown,
    resolveDestCityId,
    unknownOrDeny,
} from './helpers.js';
import type { Constraint, RequirementKey } from './types.js';

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
