import { describe, expect, it, vi } from 'vitest';

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

const buildContext = (authenticated: boolean, generalAccessTracking = false) => {
    let generalName = '초기 장수';
    const redisValues = new Map<string, string>();
    const findGeneral = vi.fn(async () => ({
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
        turnTime: new Date('2026-08-11T00:10:00.000Z'),
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
    }));
    const findCity = vi.fn(async () => null);
    const findNation = vi.fn(async () => null);
    const findWorld = vi.fn(async () => ({
        currentYear: 185,
        currentMonth: 1,
        tickSeconds: 600,
        config: { const: {} },
        meta: { lastTurnTime: '2026-08-11T00:00:00.000Z' },
    }));
    const context = {
        auth: authenticated ? auth : null,
        profile: { id: 'hwe', scenario: 'default', name: 'hwe:default' },
        generalAccessTracking,
        redis: {
            get: async (key: string) => redisValues.get(key) ?? null,
            set: async (key: string, value: string) => {
                redisValues.set(key, value);
                return 'OK';
            },
        },
        db: {
            general: {
                findFirst: findGeneral,
            },
            city: { findUnique: findCity },
            nation: { findUnique: findNation },
            generalAccessLog: { findUnique: async () => null },
            worldState: { findFirst: findWorld },
        },
    } as unknown as GameApiContext;

    return {
        context,
        rename: (name: string) => {
            generalName = name;
        },
        findGeneral,
        findCity,
        findNation,
        findWorld,
    };
};

const installSourceRevisionState = (
    context: GameApiContext,
    initial: Partial<{
        coverageVersion: number;
        generalRevision: bigint;
        cityRevision: bigint;
        nationRevision: bigint;
        worldRevision: bigint;
        accessRevision: bigint;
    }> = {}
) => {
    let row = {
        generalId: 7,
        cityId: 0,
        nationId: 0,
        coverageVersion: 1,
        globalRevision: 1n,
        generalRevision: 1n,
        cityRevision: 0n,
        nationRevision: 0n,
        worldRevision: 1n,
        accessRevision: 1n,
        ...initial,
    };
    const queryRaw = vi.fn(async () => [row]);
    Object.assign(context.db, { $queryRaw: queryRaw });
    context.realtimeAccessGeneralId = 7;
    return {
        queryRaw,
        update: (next: Partial<typeof row>) => {
            row = { ...row, ...next };
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

    it('uses an all-false bundle as an access-only gate without projecting dashboard context', async () => {
        const fixture = buildContext(true, true);
        const queryRaw = vi.fn(async (_query: unknown) => []);
        Object.assign(fixture.context.db, { $queryRaw: queryRaw });
        await expect(
            dashboardRouter.createCaller(fixture.context).getContextBundleDelta({
                include: { context: false, commandTable: false, boardAccess: false },
            })
        ).resolves.toEqual({ context: undefined, commandTable: undefined, boardAccess: undefined });
        expect(fixture.findGeneral).toHaveBeenCalledTimes(1);
        expect(fixture.findGeneral).toHaveBeenCalledWith({
            where: { userId: auth.user.id },
            orderBy: { id: 'asc' },
            select: { id: true, turnTime: true },
        });
        expect(queryRaw).not.toHaveBeenCalled();
    });

    it('returns revision-first unchanged without running the projection loader', async () => {
        const fixture = buildContext(true);
        const source = installSourceRevisionState(fixture.context);
        const caller = dashboardRouter.createCaller(fixture.context);
        const initial = await caller.getContextBundleDelta({ ...contextOnly, forceSnapshot: true });
        if (!initial.context || initial.context.kind !== 'snapshot' || !initial.context.sourceRevision) {
            throw new Error('initial source revision missing');
        }

        fixture.findGeneral.mockClear();
        fixture.findCity.mockClear();
        fixture.findNation.mockClear();
        fixture.findWorld.mockClear();
        const unchanged = await caller.getContextBundleDelta({
            ...contextOnly,
            known: { context: initial.context.revision },
            knownSource: { context: initial.context.sourceRevision },
        });

        expect(unchanged.context).toEqual({
            kind: 'unchanged',
            revision: initial.context.revision,
            sourceRevision: initial.context.sourceRevision,
        });
        expect(source.queryRaw).toHaveBeenCalledTimes(2);
        expect(fixture.findGeneral).not.toHaveBeenCalled();
        expect(fixture.findCity).not.toHaveBeenCalled();
        expect(fixture.findNation).not.toHaveBeenCalled();
        expect(fixture.findWorld).not.toHaveBeenCalled();
    });

    it('falls back to full computation while coverage is zero', async () => {
        const fixture = buildContext(true);
        installSourceRevisionState(fixture.context, { coverageVersion: 0 });
        const caller = dashboardRouter.createCaller(fixture.context);
        const initial = await caller.getContextBundleDelta({ ...contextOnly, forceSnapshot: true });
        if (!initial.context || initial.context.kind !== 'snapshot' || !initial.context.sourceRevision) {
            throw new Error('initial source revision missing');
        }

        fixture.findGeneral.mockClear();
        const unchanged = await caller.getContextBundleDelta({
            ...contextOnly,
            known: { context: initial.context.revision },
            knownSource: { context: initial.context.sourceRevision },
        });

        expect(unchanged.context).toMatchObject({ kind: 'unchanged', revision: initial.context.revision });
        expect(fixture.findGeneral).toHaveBeenCalledTimes(1);
    });

    it('advances source revision when source changes but canonical content does not', async () => {
        const fixture = buildContext(true);
        const source = installSourceRevisionState(fixture.context);
        const caller = dashboardRouter.createCaller(fixture.context);
        const initial = await caller.getContextBundleDelta({ ...contextOnly, forceSnapshot: true });
        if (!initial.context || initial.context.kind !== 'snapshot' || !initial.context.sourceRevision) {
            throw new Error('initial source revision missing');
        }

        source.update({ generalRevision: 2n });
        fixture.findGeneral.mockClear();
        const unchanged = await caller.getContextBundleDelta({
            ...contextOnly,
            known: { context: initial.context.revision },
            knownSource: { context: initial.context.sourceRevision },
        });

        expect(unchanged.context).toMatchObject({ kind: 'unchanged', revision: initial.context.revision });
        expect(unchanged.context?.sourceRevision).not.toBe(initial.context.sourceRevision);
        expect(fixture.findGeneral).toHaveBeenCalledTimes(1);
    });

    it('keeps old content-only clients on the existing full-computation path', async () => {
        const fixture = buildContext(true);
        installSourceRevisionState(fixture.context);
        const caller = dashboardRouter.createCaller(fixture.context);
        const initial = await caller.getContextBundleDelta({ ...contextOnly, forceSnapshot: true });
        if (!initial.context || initial.context.kind !== 'snapshot') throw new Error('initial snapshot missing');

        fixture.findGeneral.mockClear();
        const unchanged = await caller.getContextBundleDelta({
            ...contextOnly,
            known: { context: initial.context.revision },
        });

        expect(unchanged.context).toMatchObject({ kind: 'unchanged', revision: initial.context.revision });
        expect(fixture.findGeneral).toHaveBeenCalledTimes(1);
    });

    it('falls back to full computation when the revision-head query fails', async () => {
        const fixture = buildContext(true);
        Object.assign(fixture.context.db, {
            $queryRaw: vi.fn(async () => Promise.reject(new Error('revision table unavailable'))),
        });
        fixture.context.realtimeAccessGeneralId = 7;

        const result = await dashboardRouter.createCaller(fixture.context).getContextBundleDelta({
            ...contextOnly,
            known: { context: 'A'.repeat(22) },
            knownSource: { context: 'B'.repeat(22) },
        });

        expect(result.context?.kind).toBe('snapshot');
        expect(fixture.findGeneral).toHaveBeenCalledTimes(1);
    });
});
