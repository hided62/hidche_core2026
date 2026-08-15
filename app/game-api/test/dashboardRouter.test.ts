import { describe, expect, it } from 'vitest';

import { applyReadModelDelta } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

import type { GameApiContext } from '../src/context.js';
import { dashboardRouter } from '../src/router/dashboard/index.js';

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'hwe:default',
    issuedAt: '2026-08-11T00:00:00.000Z',
    expiresAt: '2026-08-12T00:00:00.000Z',
    sessionId: 'dashboard-delta-session',
    user: {
        id: 'viewer-1',
        username: 'dashboard-viewer',
        displayName: '대시보드 사용자',
        roles: [],
    },
    sanctions: {},
};

const buildContext = (authenticated: boolean) => {
    let generalName = '초기 장수';
    const redisValues = new Map<string, string>();
    const context = {
        auth: authenticated ? auth : null,
        profile: { id: 'hwe', scenario: 'default', name: 'hwe:default' },
        redis: {
            get: async (key: string) => redisValues.get(key) ?? null,
            set: async (key: string, value: string) => {
                redisValues.set(key, value);
                return 'OK';
            },
        },
        db: {
            general: {
                findFirst: async () => ({
                    id: 7,
                    name: generalName,
                    npcState: 0,
                    nationId: 0,
                    cityId: 0,
                    troopId: 0,
                    picture: null,
                    imageServer: 0,
                    leadership: 70,
                    strength: 60,
                    intel: 50,
                    officerLevel: 0,
                    gold: 1_000,
                    rice: 2_000,
                    crew: 300,
                    train: 80,
                    atmos: 90,
                    injury: 0,
                    experience: 100,
                    dedication: 200,
                    age: 20,
                    turnTime: new Date('2026-08-11T00:00:00.000Z'),
                    crewTypeId: 0,
                    personalCode: 'None',
                    specialCode: 'None',
                    special2Code: 'None',
                    weaponCode: 'None',
                    horseCode: 'None',
                    bookCode: 'None',
                    itemCode: 'None',
                    meta: {},
                    penalty: {},
                }),
            },
            city: { findUnique: async () => null },
            nation: { findUnique: async () => null },
            generalAccessLog: { findUnique: async () => null },
            worldState: { findFirst: async () => ({ config: { const: {} } }) },
        },
    } as unknown as GameApiContext;

    return {
        context,
        rename: (name: string) => {
            generalName = name;
        },
    };
};

const contextOnly = {
    include: { context: true, commandTable: false, boardAccess: false },
};

describe('dashboardRouter.getContextBundleDelta', () => {
    it('returns a snapshot, unchanged revision, and applicable patch for the authenticated viewer', async () => {
        const fixture = buildContext(true);
        const caller = dashboardRouter.createCaller(fixture.context);

        const initial = await caller.getContextBundleDelta({ ...contextOnly, forceSnapshot: true });
        expect(initial.context?.kind).toBe('snapshot');
        if (!initial.context || initial.context.kind !== 'snapshot') throw new Error('initial snapshot missing');
        if (!initial.context.data) throw new Error('initial general context missing');
        const initialData = initial.context.data;
        const initialRevision = initial.context.revision;

        const unchanged = await caller.getContextBundleDelta({
            ...contextOnly,
            known: { context: initialRevision },
        });
        expect(unchanged.context).toEqual({ kind: 'unchanged', revision: initialRevision });

        fixture.rename('갱신된 장수');
        const changed = await caller.getContextBundleDelta({
            ...contextOnly,
            known: { context: initialRevision },
        });
        expect(changed.context?.kind).toBe('patch');
        if (!changed.context) throw new Error('context delta missing');
        const applied = applyReadModelDelta(initialData, initialRevision, changed.context).data;
        if (!applied) throw new Error('patched general context missing');
        expect(applied.general.name).toBe('갱신된 장수');
        expect(Buffer.byteLength(JSON.stringify(changed))).toBeLessThan(1_000);
    });

    it('rejects anonymous requests before reading dashboard data', async () => {
        const fixture = buildContext(false);
        await expect(
            dashboardRouter.createCaller(fixture.context).getContextBundleDelta(contextOnly)
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('rejects an empty bundle request', async () => {
        const fixture = buildContext(true);
        await expect(
            dashboardRouter.createCaller(fixture.context).getContextBundleDelta({
                include: { context: false, commandTable: false, boardAccess: false },
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
});
