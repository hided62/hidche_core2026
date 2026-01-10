import { allow } from './helpers.js';
import type { Constraint } from './types.js';

export const alwaysFail = (reason: string): Constraint => ({
    name: 'alwaysFail',
    requires: () => [],
    test: () => ({ kind: 'deny', reason }),
});

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
