export type ConstraintResult =
    | { kind: 'allow' }
    | { kind: 'deny'; reason: string; code?: string; constraintName?: string }
    | { kind: 'unknown'; missing: RequirementKey[] };

export type RequirementKey =
    | { kind: 'general'; id: number }
    | { kind: 'generalList' }
    | { kind: 'city'; id: number }
    | { kind: 'nation'; id: number }
    | { kind: 'destGeneral'; id: number }
    | { kind: 'destCity'; id: number }
    | { kind: 'destNation'; id: number }
    | { kind: 'diplomacy'; srcNationId: number; destNationId: number }
    | { kind: 'diplomacyList' }
    | { kind: 'nationList' }
    | { kind: 'arg'; key: string }
    | { kind: 'env'; key: string };

export interface ConstraintContext {
    actorId: number;
    cityId?: number;
    nationId?: number;
    destGeneralId?: number;
    destCityId?: number;
    destNationId?: number;
    args: Record<string, unknown>;
    env: Record<string, unknown>;
    mode: 'full' | 'precheck';
}

export interface StateView {
    has(req: RequirementKey): boolean;
    get(req: RequirementKey): unknown | null;
}

export interface Constraint {
    name: string;
    requires(ctx: ConstraintContext): RequirementKey[];
    test(ctx: ConstraintContext, view: StateView): ConstraintResult;
}
