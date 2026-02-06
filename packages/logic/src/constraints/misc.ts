import { allow, compareValues, type CompareOperator } from './helpers.js';
import type { Constraint } from './types.js';

export const denyWithReason = (reason: string): Constraint => ({
    name: 'denyWithReason',
    requires: () => [],
    test: () => ({ kind: 'deny', reason }),
});

// TODO: 점진 이전을 위해 유지. 신규 코드에서는 denyWithReason을 사용한다.
export const alwaysFail = denyWithReason;

export const notOpeningPart = (relYear: number, openingPartYear: number): Constraint => ({
    name: 'notOpeningPart',
    requires: () => [],
    test: (_ctx) => {
        if (relYear >= openingPartYear) {
            return allow();
        }
        return { kind: 'deny', reason: '초반 제한 중에는 불가능합니다.' };
    },
});

export const beOpeningPart = (): Constraint => ({
    name: 'beOpeningPart',
    requires: () => [
        { kind: 'env', key: 'relYear' },
        { kind: 'env', key: 'openingPartYear' },
    ],
    test: (_ctx, view) => {
        const relYear = view.get({ kind: 'env', key: 'relYear' }) as number | undefined;
        const openingPartYear = view.get({ kind: 'env', key: 'openingPartYear' }) as number | undefined;

        if (openingPartYear === undefined) {
            return { kind: 'deny', reason: '초반 제한 중에는 불가능합니다.' };
        }

        if (relYear === undefined) {
            return { kind: 'deny', reason: '초반 제한 중에는 불가능합니다.' };
        }

        if (relYear + 1 <= openingPartYear) {
            return allow();
        }

        return { kind: 'deny', reason: '초반 제한 중에는 불가능합니다.' };
    },
});

export const reqEnvValue = (
    key: string,
    comp: CompareOperator,
    reqVal: unknown,
    failMessage: string
): Constraint => ({
    name: 'reqEnvValue',
    requires: () => [{ kind: 'env', key }],
    test: (_ctx, view) => {
        const req = { kind: 'env', key } as const;
        if (!view.has(req)) {
            return { kind: 'deny', reason: failMessage };
        }
        const envValue = view.get(req);
        if (compareValues(envValue, comp, reqVal)) {
            return allow();
        }
        return { kind: 'deny', reason: failMessage };
    },
});
