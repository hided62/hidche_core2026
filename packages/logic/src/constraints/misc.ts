import { allow } from './helpers.js';
import type { Constraint } from './types.js';

export const alwaysFail = (reason: string): Constraint => ({
    name: 'AlwaysFail',
    requires: () => [],
    test: () => ({ kind: 'deny', reason }),
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
