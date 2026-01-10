import {
    allow,
    readDestCity,
    readDiplomacyState,
    readGeneral,
    resolveDestCityId,
    resolveDestNationId,
    unknownOrDeny,
} from './helpers.js';
import type { Constraint, RequirementKey } from './types.js';

const readDiplomacyEntry = (
    view: { has(req: RequirementKey): boolean; get(req: RequirementKey): unknown },
    srcNationId: number,
    destNationId: number
): { state: number | null; term: number | null } | null => {
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
        return { state: value, term: null };
    }
    if (value && typeof value === 'object') {
        const record = value as { state?: number; stateCode?: number; term?: number };
        const state =
            typeof record.state === 'number'
                ? record.state
                : typeof record.stateCode === 'number'
                  ? record.stateCode
                  : null;
        const term = typeof record.term === 'number' ? record.term : null;
        return { state, term };
    }
    return null;
};

export const disallowDiplomacyBetweenStatus = (disallowList: Record<number, string>): Constraint => ({
    name: 'disallowDiplomacyBetweenStatus',
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
        const destNationId = resolveDestNationId(ctx) ?? destCity?.nationId;
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

export const allowDiplomacyBetweenStatus = (allowList: number[], reason: string): Constraint => ({
    name: 'allowDiplomacyBetweenStatus',
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
        const destNationId = resolveDestNationId(ctx) ?? destCity?.nationId;
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
        if (!allowList.includes(state)) {
            return { kind: 'deny', reason };
        }
        return allow();
    },
});

export const allowDiplomacyWithTerm = (requiredState: number, minTerm: number, reason: string): Constraint => ({
    name: 'allowDiplomacyWithTerm',
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
        const destNationId = resolveDestNationId(ctx) ?? destCity?.nationId;
        if (destNationId === undefined) {
            return unknownOrDeny(ctx, [], '상대 국가 정보가 없습니다.');
        }
        const entry = readDiplomacyEntry(view, baseNationId, destNationId);
        if (!entry || entry.state === null || entry.term === null) {
            const req: RequirementKey = {
                kind: 'diplomacy',
                srcNationId: baseNationId,
                destNationId,
            };
            return unknownOrDeny(ctx, [req], '외교 정보가 없습니다.');
        }
        if (entry.state !== requiredState || entry.term < minTerm) {
            return { kind: 'deny', reason };
        }
        return allow();
    },
});

export const allowDiplomacyStatus = (allowList: number[], reason: string): Constraint => ({
    name: 'allowDiplomacyStatus',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        if (ctx.nationId !== undefined) {
            reqs.push({ kind: 'nation', id: ctx.nationId });
        }
        reqs.push({ kind: 'diplomacyList' });
        return reqs;
    },
    test: (ctx, view) => {
        const general = readGeneral(ctx, view);
        const baseNationId = ctx.nationId ?? general?.nationId;
        if (baseNationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const req: RequirementKey = { kind: 'diplomacyList' };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '외교 정보가 없습니다.');
        }
        const list = view.get(req);
        if (!Array.isArray(list)) {
            return unknownOrDeny(ctx, [req], '외교 정보가 없습니다.');
        }
        const matched = list.some((entry) => {
            if (!entry || typeof entry !== 'object') {
                return false;
            }
            const record = entry as { fromNationId?: number; state?: number };
            return (
                record.fromNationId === baseNationId &&
                typeof record.state === 'number' &&
                allowList.includes(record.state)
            );
        });
        if (!matched) {
            return { kind: 'deny', reason };
        }
        return allow();
    },
});
