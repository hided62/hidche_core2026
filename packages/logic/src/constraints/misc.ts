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
        { kind: 'env', key: 'year' },
        { kind: 'env', key: 'openingPartYear' },
    ],
    test: (_ctx, view) => {
        const year = view.get({ kind: 'env', key: 'year' }) as number | undefined;
        const openingPartYear = view.get({ kind: 'env', key: 'openingPartYear' }) as number | undefined;

        if (year === undefined || openingPartYear === undefined) {
            // 정보가 없으면 제약을 무시하거나 알림
            return allow();
        }

        if (year <= openingPartYear) {
            return allow();
        }
        return { kind: 'deny', reason: '초반이 지났습니다.' };
    },
});
