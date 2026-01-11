import type { City, General, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import { getCityDistance } from '../world/distance.js';
import {
    allow,
    parsePercent,
    readCity,
    readDestCity,
    readDiplomacyState,
    readGeneral,
    readMetaNumberFromUnknown,
    resolveDestCityId,
    unknownOrDeny,
} from './helpers.js';
import type { Constraint, RequirementKey } from './types.js';

export const occupiedCity = (options: { allowNeutral?: boolean } = {}): Constraint => ({
    name: 'occupiedCity',
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
    name: 'occupiedDestCity',
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
    name: 'suppliedCity',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
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
    name: 'suppliedDestCity',
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

export const remainCityCapacity = (key: keyof City, label: string): Constraint => ({
    name: 'remainCityCapacity',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const maxKey = `${String(key)}Max` as keyof City;
        const current = city[key];
        const max = city[maxKey];
        if (typeof current !== 'number' || typeof max !== 'number') {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }
        if (current < max) {
            return allow();
        }
        return { kind: 'deny', reason: `${label}이 충분합니다.` };
    },
});

export const remainCityCapacityByMax = (key: keyof City, maxKey: keyof City, label: string): Constraint => ({
    name: 'remainCityCapacityByMax',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const current = city[key];
        const max = city[maxKey];
        if (typeof current !== 'number' || typeof max !== 'number') {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }
        if (current < max) {
            return allow();
        }
        return { kind: 'deny', reason: `${label}이 충분합니다.` };
    },
});

export const reqCityCapacity = (key: keyof City, label: string, required: number | string): Constraint => ({
    name: 'reqCityCapacity',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const current = city[key];
        if (typeof current !== 'number') {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }
        if (typeof required === 'string') {
            const ratio = parsePercent(required);
            const maxKey = `${String(key)}Max` as keyof City;
            const max = city[maxKey];
            if (ratio === null || typeof max !== 'number') {
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
    name: 'reqCityTrust',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const trust = readMetaNumberFromUnknown(city.meta, 'trust') ?? null;
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
    name: 'existsDestCity',
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
    name: 'notOccupiedDestCity',
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
    name: 'notNeutralDestCity',
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

export const notSameDestCity = (): Constraint => ({
    name: 'notSameDestCity',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        const destCityId = resolveDestCityId(ctx);
        if (destCityId !== undefined) {
            reqs.push({ kind: 'destCity', id: destCityId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const general = readGeneral(ctx, view);
        if (!general) {
            const req: RequirementKey = { kind: 'general', id: ctx.actorId };
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const destCityId = resolveDestCityId(ctx);
        if (destCityId === undefined) {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }
        if (general.cityId !== destCityId) {
            return allow();
        }
        return { kind: 'deny', reason: '같은 도시입니다.' };
    },
});

export const hasRouteWithEnemy = (): Constraint => ({
    name: 'hasRouteWithEnemy',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        const destCityId = resolveDestCityId(ctx);
        if (destCityId !== undefined) {
            reqs.push({ kind: 'destCity', id: destCityId });
        }
        reqs.push({ kind: 'env', key: 'map' });
        reqs.push({ kind: 'env', key: 'cities' });
        reqs.push({ kind: 'env', key: 'nations' });
        return reqs;
    },
    test: (ctx, view) => {
        const general = readGeneral(ctx, view);
        if (!general) {
            const req: RequirementKey = { kind: 'general', id: ctx.actorId };
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const destCity = readDestCity(ctx, view);
        if (!destCity) {
            const destCityId = resolveDestCityId(ctx);
            if (destCityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'destCity', id: destCityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        const map = view.get({ kind: 'env', key: 'map' }) as MapDefinition | null;
        const cities = view.get({ kind: 'env', key: 'cities' }) as City[] | null;
        const nations = view.get({ kind: 'env', key: 'nations' }) as Array<{ id: number }> | null;
        if (!map || !cities || !nations) {
            return unknownOrDeny(ctx, [], '경로 정보가 없습니다.');
        }

        const allowedNationIds = new Set<number>();
        allowedNationIds.add(general.nationId);
        allowedNationIds.add(0);
        for (const nation of nations) {
            const state = readDiplomacyState(view, general.nationId, nation.id);
            if (state === 0) {
                allowedNationIds.add(nation.id);
            }
        }

        if (
            destCity.nationId !== 0 &&
            destCity.nationId !== general.nationId &&
            !allowedNationIds.has(destCity.nationId)
        ) {
            return { kind: 'deny', reason: '교전중인 국가가 아닙니다.' };
        }

        const allowedCityIds = new Set<number>();
        for (const city of cities) {
            if (allowedNationIds.has(city.nationId)) {
                allowedCityIds.add(city.id);
            }
        }
        if (!allowedCityIds.has(destCity.id)) {
            return { kind: 'deny', reason: '경로에 도달할 방법이 없습니다.' };
        }
        return allow();
    },
});

export const beNeutralCity = (): Constraint => ({
    name: 'beNeutralCity',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        if (city.nationId === 0) {
            return allow();
        }
        const general = readGeneral(ctx, view);
        if (general && city.nationId === general.nationId) {
            const nationReq: RequirementKey = { kind: 'nation', id: general.nationId };
            const nation = view.get(nationReq) as Nation | null;
            if (nation && nation.level === 0) {
                // 방랑군 본인 도시면 건국 가능
                return allow();
            }
        }
        return { kind: 'deny', reason: '공백지가 아닙니다.' };
    },
});

export const reqCityLevel = (levels: number[]): Constraint => ({
    name: 'reqCityLevel',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
    test: (ctx, view) => {
        const city = readCity(view, ctx.cityId);
        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }
        if (levels.includes(city.level)) {
            return allow();
        }
        return { kind: 'deny', reason: '규모가 맞지 않습니다.' };
    },
});

export const nearCity = (maxDistance: number): Constraint => ({
    name: 'nearCity',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'env', key: 'map' }];
        const destCityId = resolveDestCityId(ctx);
        if (destCityId !== undefined) {
            reqs.push({ kind: 'destCity', id: destCityId });
        }
        if (ctx.cityId !== undefined) {
            reqs.push({ kind: 'city', id: ctx.cityId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const map = view.get({ kind: 'env', key: 'map' }) as MapDefinition | null;
        if (!map) {
            return unknownOrDeny(ctx, [], '지도 정보가 없습니다.');
        }

        const destCityId = resolveDestCityId(ctx);
        if (destCityId === undefined) {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }

        const city = readCity(view, ctx.cityId);

        if (!city) {
            if (ctx.cityId === undefined) {
                return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
            }
            const req: RequirementKey = { kind: 'city', id: ctx.cityId };
            return unknownOrDeny(ctx, [req], '도시 정보가 없습니다.');
        }

        const distance = getCityDistance(map, city.id, destCityId);
        if (distance <= maxDistance) {
            return allow();
        }

        return { kind: 'deny', reason: '너무 멉니다.' };
    },
});

export const notCapital = (checkCurrentCity = false): Constraint => ({
    name: 'notCapital',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        if (checkCurrentCity) {
            if (ctx.cityId !== undefined) {
                reqs.push({ kind: 'city', id: ctx.cityId });
            }
        } else {
            // If checking dest, we need destCityId
            const destCityId = resolveDestCityId(ctx);
            if (destCityId !== undefined) {
                reqs.push({ kind: 'destCity', id: destCityId });
            }
        }
        // Need nation to know capital
        reqs.push({ kind: 'nation', id: ctx.nationId ?? 0 });
        return reqs;
    },
    test: (ctx, view) => {
        const nationReq: RequirementKey = { kind: 'nation', id: ctx.nationId ?? 0 };
        if (!view.has(nationReq)) return unknownOrDeny(ctx, [nationReq], '국가 정보가 없습니다.');
        const nation = view.get(nationReq) as Nation | null;
        if (!nation) return unknownOrDeny(ctx, [nationReq], '국가 정보가 없습니다.');

        let targetCityId: number | undefined;

        if (checkCurrentCity) {
            targetCityId = ctx.cityId;
            if (targetCityId === undefined) {
                const general = readGeneral(ctx, view);
                targetCityId = general?.cityId;
            }
        } else {
            targetCityId = resolveDestCityId(ctx);
        }

        if (targetCityId === undefined) {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }

        if (targetCityId === nation.capitalCityId) {
            return { kind: 'deny', reason: '수도입니다.' };
        }
        return allow();
    },
});
