import { allow } from './helpers.js';
import type { Constraint } from './types.js';

export const alwaysFail = (reason: string): Constraint => ({
    name: 'AlwaysFail',
    requires: () => [],
    test: () => ({ kind: 'deny', reason }),
});

export const notOpeningPart = (relYear: number, openingPartYear: number): Constraint => ({
    name: 'NotOpeningPart',
    requires: () => [],
    test: (_ctx) => {
        if (relYear >= openingPartYear) {
            return allow();
        }
        return { kind: 'deny', reason: '초반 제한 중에는 불가능합니다.' };
    },
});

export const beOpeningPart = (): Constraint => ({
    name: 'BeOpeningPart',
    requires: () => [
        { kind: 'env', key: 'world' },
        { kind: 'env', key: 'openingPartYear' },
    ],
    test: (_ctx, view) => {
        const world = view.get({ kind: 'env', key: 'world' }) as { currentYear: number } | null;
        const openingPartYear = view.get({ kind: 'env', key: 'openingPartYear' }) as number | null;
        if (!world || openingPartYear === null) {
            return {
                kind: 'unknown',
                missing: [
                    { kind: 'env', key: 'world' },
                    { kind: 'env', key: 'openingPartYear' },
                ],
            };
        }
        if (world.currentYear < openingPartYear) {
            return allow();
        }
        return { kind: 'deny', reason: '초반이 지났습니다.' };
    },
});
