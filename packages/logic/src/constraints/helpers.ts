import type { City, General, Nation, TriggerValue } from '@sammo-ts/logic/domain/entities.js';
import type { ConstraintContext, ConstraintResult, RequirementKey, StateView } from './types.js';

export const allow = (): ConstraintResult => ({ kind: 'allow' });

export const unknownOrDeny = (ctx: ConstraintContext, missing: RequirementKey[], reason: string): ConstraintResult =>
    ctx.mode === 'precheck' ? { kind: 'unknown', missing } : { kind: 'deny', reason };

export const readGeneral = (ctx: ConstraintContext, view: StateView): General | null => {
    const req: RequirementKey = { kind: 'general', id: ctx.actorId };
    if (!view.has(req)) {
        return null;
    }
    return view.get(req) as General | null;
};

export const readCity = (view: StateView, id?: number): City | null => {
    if (id === undefined) {
        return null;
    }
    const req: RequirementKey = { kind: 'city', id };
    if (!view.has(req)) {
        return null;
    }
    return view.get(req) as City | null;
};

export const resolveDestGeneralId = (ctx: ConstraintContext): number | undefined => {
    if (ctx.destGeneralId !== undefined) {
        return ctx.destGeneralId;
    }
    const raw = ctx.args?.destGeneralId;
    return typeof raw === 'number' ? raw : undefined;
};

export const readDestGeneral = (ctx: ConstraintContext, view: StateView): General | null => {
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

export const resolveDestCityId = (ctx: ConstraintContext): number | undefined => {
    if (ctx.destCityId !== undefined) {
        return ctx.destCityId;
    }
    const raw = ctx.args?.destCityId;
    return typeof raw === 'number' ? raw : undefined;
};

export const resolveDestNationId = (ctx: ConstraintContext): number | undefined => {
    if (ctx.destNationId !== undefined) {
        return ctx.destNationId;
    }
    const raw = ctx.args?.destNationId;
    return typeof raw === 'number' ? raw : undefined;
};

export const readDestCity = (ctx: ConstraintContext, view: StateView): City | null => {
    const destCityId = resolveDestCityId(ctx);
    return readCity(view, destCityId);
};

export const readNation = (view: StateView, id?: number): Nation | null => {
    if (id === undefined) {
        return null;
    }
    const req: RequirementKey = { kind: 'nation', id };
    if (!view.has(req)) {
        return null;
    }
    return view.get(req) as Nation | null;
};

export const readMetaNumber = (meta: Record<string, TriggerValue>, key: string): number | null => {
    const value = meta[key];
    return typeof value === 'number' ? value : null;
};

export const readDiplomacyState = (view: StateView, srcNationId: number, destNationId: number): number | null => {
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

export const readMetaNumberFromUnknown = (meta: Record<string, unknown>, key: string): number | null => {
    const value = meta[key];
    return typeof value === 'number' ? value : null;
};

export const parsePercent = (value: string): number | null => {
    const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
    if (!match) {
        return null;
    }
    return Number(match[1]) / 100;
};
