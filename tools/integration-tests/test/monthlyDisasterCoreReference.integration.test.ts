import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { loadActionModuleBundle, type City, type GeneralActionModule, type MapDefinition } from '@sammo-ts/logic';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';
import { createRaiseDisasterHandler } from '@sammo-ts/game-engine/turn/monthlyDisasterAction.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '@sammo-ts/game-engine/turn/types.js';

import { findTurnDifferentialWorkspaceRoot } from '../src/turn-differential/referenceSnapshot.js';

type ReferenceGeneral = {
    id: number;
    injury: number;
    crew: number;
    train: number;
    atmos: number;
    item: string;
};

type ReferenceCity = {
    id: number;
    state: number;
    population: number;
    agriculture: number;
    commerce: number;
    security: number;
    trust: number;
    defence: number;
    wall: number;
};

type ReferenceLog = {
    generalId?: number;
    text: string;
    scope?: string;
    category?: string;
};

type ReferenceMonthlyTrace = {
    action: string;
    before: {
        watermarks: {
            logId: number;
        };
    };
    after: {
        logs: ReferenceLog[];
    };
    beforeDetails: {
        generals: ReferenceGeneral[];
        cities: ReferenceCity[];
        worldHistory: ReferenceLog[];
    };
    afterDetails: {
        generals: ReferenceGeneral[];
        cities: ReferenceCity[];
        worldHistory: ReferenceLog[];
    };
};

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');

const fixtureRelativePath = 'fixtures/monthly-differential/raise-disaster-january.json';

const runReferenceMonthlyTrace = (): ReferenceMonthlyTrace => {
    const stackDirectory = path.join(workspaceRoot!, 'docker_compose_files/reference');
    const fixture = fs.readFileSync(path.join(stackDirectory, fixtureRelativePath), 'utf8');
    const runnerScript =
        process.env.MONTHLY_DIFFERENTIAL_RUNNER_SCRIPT ??
        path.join(workspaceRoot!, 'ref/sam/hwe/compare/monthly_event_trace.php');
    const stdout = execFileSync('./scripts/run-turn-differential-case.sh', ['-'], {
        cwd: stackDirectory,
        input: fixture,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...process.env,
            TURN_DIFFERENTIAL_RUNNER_SCRIPT: runnerScript,
        },
    });
    return JSON.parse(stdout) as ReferenceMonthlyTrace;
};

const map: MapDefinition = {
    id: 'monthly-disaster-reference',
    name: 'monthly-disaster-reference',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const city: City = {
    id: 1,
    name: '재난도시',
    nationId: 0,
    level: 1,
    state: 5,
    population: 1_001,
    populationMax: 2_000,
    agriculture: 501,
    agricultureMax: 1_000,
    commerce: 499,
    commerceMax: 1_000,
    security: 0,
    securityMax: 100,
    supplyState: 1,
    frontState: 2,
    defence: 99,
    defenceMax: 1_000,
    wall: 101,
    wallMax: 1_000,
    conflict: {},
    meta: { trust: 99.5, trade: 100 },
};

const buildGeneral = (id: number, name: string, injury: number, item: string | null): TurnGeneral => ({
    id,
    name,
    nationId: 0,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item },
    },
    injury,
    gold: 1_000,
    rice: 1_000,
    crew: 99,
    crewTypeId: 1_100,
    train: 51,
    atmos: 50,
    age: 20,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
});

const projectReferenceGenerals = (generals: ReferenceGeneral[]) =>
    generals.map((general) => ({
        id: general.id,
        injury: general.injury,
        crew: general.crew,
        train: general.train,
        atmos: general.atmos,
        item: general.item === 'None' ? null : general.item,
    }));

const projectCoreGenerals = (world: InMemoryTurnWorld) =>
    world
        .listGenerals()
        .sort((left, right) => left.id - right.id)
        .map((general) => ({
            id: general.id,
            injury: general.injury,
            crew: general.crew,
            train: general.train,
            atmos: general.atmos,
            item: general.role.items.item,
        }));

const projectReferenceCity = (citySnapshot: ReferenceCity) => ({
    state: citySnapshot.state,
    population: citySnapshot.population,
    agriculture: citySnapshot.agriculture,
    commerce: citySnapshot.commerce,
    security: citySnapshot.security,
    trust: citySnapshot.trust,
    defence: citySnapshot.defence,
    wall: citySnapshot.wall,
});

const projectCoreCity = (citySnapshot: City) => ({
    state: citySnapshot.state,
    population: citySnapshot.population,
    agriculture: citySnapshot.agriculture,
    commerce: citySnapshot.commerce,
    security: citySnapshot.security,
    trust: citySnapshot.meta.trust,
    defence: citySnapshot.defence,
    wall: citySnapshot.wall,
});

const normalizeStoredLogText = (value: string): string =>
    value.replace(/^(?:<C>●<\/>|<S>◆<\/>|<R>★<\/>)(?:(?:\d+년 )?\d+월:|\d+년:)?/, '');

const projectReferenceLogs = (trace: ReferenceMonthlyTrace) => [
    ...trace.afterDetails.worldHistory.map((entry) => ({
        scope: 'system',
        category: 'history',
        generalId: null,
        text: normalizeStoredLogText(entry.text),
    })),
    ...trace.after.logs
        .filter((entry) => entry.generalId !== undefined)
        .map((entry) => ({
            scope: entry.scope,
            category: entry.category,
            generalId: entry.generalId ?? null,
            text: normalizeStoredLogText(entry.text),
        })),
];

const buildCoreWorld = async (generalActionModules: ReadonlyArray<GeneralActionModule>): Promise<InMemoryTurnWorld> => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 193,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
        meta: { hiddenSeed: 'disaster-test-6' },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: map.id, unitSet: 'default' },
        },
        scenarioMeta: {
            title: 'monthly disaster reference',
            startYear: 190,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
        map,
        diplomacy: [],
        events: [],
        initialEvents: [],
        generals: [
            buildGeneral(1, '보호장수', 0, 'che_부적_태현청생부'),
            buildGeneral(3, '부상장수', 0, null),
            buildGeneral(5, '중상장수', 70, null),
        ],
        cities: [city],
        nations: [],
        troops: [],
    };
    const world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
    const event: TurnEvent = {
        id: 1,
        targetCode: 'month',
        priority: 1_000,
        condition: true,
        action: [['RaiseDisaster']],
        meta: {},
    };
    await createRaiseDisasterHandler({
        getWorld: () => world,
        generalActionModules,
    })([], { year: 193, month: 1, startyear: 190, currentEventID: event.id, turnTime: state.lastTurnTime }, event);
    return world;
};

integration('RaiseDisaster core ↔ legacy database snapshot', () => {
    it('matches city damage, item-aware injury, and persisted logs', async () => {
        const reference = runReferenceMonthlyTrace();
        expect(reference.action).toBe('RaiseDisaster');
        expect(projectReferenceGenerals(reference.beforeDetails.generals)).toEqual([
            { id: 1, injury: 0, crew: 99, train: 51, atmos: 50, item: 'che_부적_태현청생부' },
            { id: 3, injury: 0, crew: 99, train: 51, atmos: 50, item: null },
            { id: 5, injury: 70, crew: 99, train: 51, atmos: 50, item: null },
        ]);

        const moduleBundle = await loadActionModuleBundle();
        const core = await buildCoreWorld(moduleBundle.general);
        const coreCity = projectCoreCity(core.getCityById(1)!);
        const referenceCity = projectReferenceCity(reference.afterDetails.cities[0]!);
        expect({ ...coreCity, trust: undefined }).toEqual({ ...referenceCity, trust: undefined });
        expect(coreCity.trust).toBeCloseTo(referenceCity.trust);
        expect(projectCoreGenerals(core)).toEqual(projectReferenceGenerals(reference.afterDetails.generals));

        const coreLogs = core.peekDirtyState().logs.map((entry) => ({
            scope: String(entry.scope).toLowerCase(),
            category: String(entry.category).toLowerCase(),
            generalId: entry.generalId ?? null,
            text: entry.text,
        }));
        expect(coreLogs).toEqual(projectReferenceLogs(reference));
    }, 120_000);
});
