import { describe, expect, it } from 'vitest';
import type { RandomGenerator } from '@sammo-ts/common';
import { produce } from 'immer';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import type { TestCommand } from '../testEnv.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import { buildScenarioBootstrap } from '../../src/world/bootstrap.js';
import type { ScenarioDefinition } from '../../src/scenario/types.js';
import type { Nation } from '../../src/domain/entities.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';
import type { TurnSchedule } from '../../src/turn/calendar.js';
import { getNextTurnAt } from '../../src/turn/calendar.js';
import { resolveGeneralAction } from '../../src/actions/engine.js';

// Import Command Specs
import { commandSpec as agricultureSpec } from '../../src/actions/turn/general/che_농지개간.js';
import { commandSpec as commerceSpec } from '../../src/actions/turn/general/che_상업투자.js';
import { commandSpec as trainSpec } from '../../src/actions/turn/general/che_훈련.js';
import { commandSpec as moveSpec } from '../../src/actions/turn/general/che_이동.js';
import { commandSpec as uprisingSpec } from '../../src/actions/turn/general/che_거병.js';
import { commandSpec as appointmentSpec } from '../../src/actions/turn/general/che_임관.js';
import { commandSpec as foundNationSpec } from '../../src/actions/turn/general/che_건국.js';

// Define Command System Env
const systemEnv: TurnCommandEnv = {
    develCost: 50,
    trainDelta: 5,
    atmosDelta: 5,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    sabotageDefaultProb: 0.5,
    sabotageProbCoefByStat: 0.1,
    sabotageDefenceCoefByGeneralCount: 0.1,
    sabotageDamageMin: 10,
    sabotageDamageMax: 20,
    openingPartYear: 200,
    maxGeneral: 10,
    defaultNpcGold: 1000,
    defaultNpcRice: 1000,
    defaultCrewTypeId: 1,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    initialNationGenLimit: 10,
    maxTechLevel: 10,
    baseGold: 1000,
    baseRice: 1000,
    maxResourceActionAmount: 1000,
};

// --- Helper Types for Reserved Turn ---

interface ReservedCommand {
    commandKey: string;
    args: unknown;
}

type ReservedTurnMap = Record<number, ReservedCommand[]>;

class ReservedTurnRunner extends TestGameRunner {
    private schedule: TurnSchedule;

    constructor(world: InMemoryWorld, startYear: number, startMonth: number, turnMinutes: number = 60) {
        super(world, startYear, startMonth);
        this.schedule = {
            entries: [{ startMinute: 0, tickMinutes: turnMinutes }],
        };
    }

    // Override runTurn to throw error or handle differently if needed,
    // but here we define a new method for scheduled execution.
    async runScheduler(reservedTurns: ReservedTurnMap, limitTurns: number = 10) {
        let turnsProcessed = 0;

        // Clone reservedTurns to consume them
        const queues: Record<number, ReservedCommand[]> = {};
        for (const [genId, cmds] of Object.entries(reservedTurns)) {
            queues[Number(genId)] = [...cmds];
        }

        while (turnsProcessed < limitTurns) {
            // Determine next turn time
            const nextTurnAt = getNextTurnAt(this.currentDate, this.schedule);

            // Collect commands for this turn
            const turnCommands: TestCommand[] = [];
            const activeGenerals = this.world.getAllGenerals();

            for (const general of activeGenerals) {
                const queue = queues[general.id];
                if (queue && queue.length > 0) {
                    const cmd = queue.shift()!; // Dequeue the first command

                    // Resolve spec helper
                    let resolver;
                    if (cmd.commandKey === 'che_농지개간') resolver = agricultureSpec.createDefinition(systemEnv);
                    else if (cmd.commandKey === 'che_상업투자') resolver = commerceSpec.createDefinition(systemEnv);
                    else if (cmd.commandKey === 'che_훈련') resolver = trainSpec.createDefinition(systemEnv);
                    else if (cmd.commandKey === 'che_이동') resolver = moveSpec.createDefinition(systemEnv);
                    else if (cmd.commandKey === 'che_거병') resolver = uprisingSpec.createDefinition(systemEnv);
                    else if (cmd.commandKey === 'che_임관') resolver = appointmentSpec.createDefinition(systemEnv);
                    else if (cmd.commandKey === 'che_건국') resolver = foundNationSpec.createDefinition(systemEnv);
                    else throw new Error(`Unknown command key: ${cmd.commandKey}`);

                    turnCommands.push({
                        generalId: general.id,
                        commandKey: cmd.commandKey,
                        resolver,
                        args: cmd.args,
                    });
                }
            }

            // Execute the commands
            for (const cmd of turnCommands) {
                const general = this.world.getGeneral(cmd.generalId);
                if (!general) continue;

                const city = this.world.getCity(general.cityId);
                if (!city) throw new Error(`General ${general.id} is in non-existent city ${general.cityId}`);
                const nation = general.nationId ? this.world.getNation(general.nationId) : null;

                // Simple RNG mock
                const rng: RandomGenerator = {
                    nextFloat: () => 0.5,
                    nextBool: () => true,
                    nextInt: (min: number, _max: number) => min,
                };

                const inputContext = {
                    general,
                    city,
                    nation: nation || null,
                    rng,
                    year: this.currentDate.getFullYear(),
                    month: this.currentDate.getMonth() + 1,
                    season: Math.floor(this.currentDate.getMonth() / 3),
                    map: this.world.snapshot.map,
                    unitSet: this.world.snapshot.unitSet,
                    cities: this.world.snapshot.cities,
                    ...cmd.context,
                };

                const scheduleContext = {
                    now: this.currentDate,
                    schedule: this.schedule,
                };

                const resolution = resolveGeneralAction(cmd.resolver, inputContext as any, scheduleContext, cmd.args);
                await this.world.applyResolution(resolution);
            }

            // Advance time
            this.currentDate = nextTurnAt;
            turnsProcessed++;
        }
    }
}

// --- Test Setup ---

const MOCK_SCENARIO: ScenarioDefinition = {
    title: 'Reserved Turn Scenario',
    startYear: 189,
    life: null,
    fiction: 0,
    history: [],
    ignoreDefaultEvents: false,
    nations: [],
    diplomacy: [],
    generals: [],
    generalsEx: [],
    generalsNeutral: [],
    cities: [],
    events: [],
    initialEvents: [],
    config: {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
        iconPath: '',
        map: {},
        const: {},
        environment: {
            mapName: 'minimal_map',
            unitSet: 'test_set',
        },
    },
};

const MOCK_GENERALS = Array.from({ length: 3 }, (_, i) => ({
    name: `General_${i}`,
    nation: null,
    city: MINIMAL_MAP.cities[0]?.name || 'Unknown', // Start at City 1 (소성A)
    officerLevel: 0,
    birthYear: 160,
    deathYear: 220,
    strength: 80,
    intelligence: 80,
    leadership: 80,
    personality: null,
    special: null,
    specialWar: null,
    affinity: 0,
    picture: null,
    horse: null,
    weapon: null,
    book: null,
    item: null,
    text: null,
}));

const scenarioWithGenerals = produce(MOCK_SCENARIO, (draft) => {
    draft.generalsNeutral = MOCK_GENERALS;
});

describe('Reserved Turn Execution', () => {
    it('should execute queued commands for multiple generals over time without intervention', async () => {
        // 1. Initialize World
        const bootstrapResult = buildScenarioBootstrap({
            scenario: scenarioWithGenerals,
            map: MINIMAL_MAP,
            options: {
                includeNeutralNation: true,
                defaultGeneralGold: 2000,
                defaultGeneralRice: 2000,
            },
        });

        // Ensure City 1 has enough defaults so actions work
        const snapshot = produce(bootstrapResult.snapshot, (draft) => {
            const city1 = draft.cities.find((c) => c.id === 1)!;
            city1.agriculture = 100;
            city1.agricultureMax = 2000;
            city1.commerce = 100;
            city1.commerceMax = 2000;

            // Make generals belong to a nation so they can do domestic actions if needed
            const nation: Nation = {
                id: 1,
                name: 'TestNation',
                color: '#FF0000',
                capitalCityId: 1,
                chiefGeneralId: draft.generals[0]!.id,
                gold: 10000,
                rice: 10000,
                power: 0,
                level: 1,
                typeCode: 'che_def',
                meta: {},
            };
            draft.nations.push(nation);

            draft.generals.forEach((g) => {
                g.nationId = 1;
                g.officerLevel = 5; // General
            });
            if (draft.cities[0]) draft.cities[0].nationId = 1;
            if (draft.cities[1]) draft.cities[1].nationId = 1;
        });

        const mutableSnapshot = JSON.parse(JSON.stringify(snapshot));
        const world = new InMemoryWorld(mutableSnapshot);

        // 2. Setup Runner with 10 minute turns
        // This is where "Setting turn time" happens
        const runner = new ReservedTurnRunner(world, 189, 1, 10);

        // 3. Define Reserved Turns
        // This is "Setting all generals' reserved turns"
        const gen0 = world.getAllGenerals().find((g) => g.name === 'General_0')!;
        const gen1 = world.getAllGenerals().find((g) => g.name === 'General_1')!;
        const gen2 = world.getAllGenerals().find((g) => g.name === 'General_2')!;

        const reservedTurns: ReservedTurnMap = {
            [gen0.id]: [
                { commandKey: 'che_농지개간', args: {} },
                { commandKey: 'che_농지개간', args: {} },
                { commandKey: 'che_이동', args: { destCityId: 2 } },
            ],
            [gen1.id]: [
                { commandKey: 'che_상업투자', args: {} },
                { commandKey: 'che_상업투자', args: {} },
                { commandKey: 'che_훈련', args: {} },
            ],
            [gen2.id]: [],
        };

        // 4. Run Scheduler for 3 turns
        // This is "'Not touching it' and execute"
        await runner.runScheduler(reservedTurns, 3);

        // 5. Verify Results

        // Timer Check: 3 turns of 10 mins = 30 mins elapsed?
        // 189-01-01 00:00 -> 00:10 -> 00:20 -> 00:30.
        expect(runner.currentDate.getMinutes()).toBe(30);

        const finalGen0 = world.getGeneral(gen0.id)!;
        const finalGen1 = world.getGeneral(gen1.id)!;
        const finalCity1 = world.getCity(1)!;

        // Gen 0 moved to City 2
        expect(finalGen0.cityId).toBe(2);

        // Gen 1 stayed in City 1
        expect(finalGen1.cityId).toBe(1);

        // City 1 Agric/Commerce increased
        // Agric is fixed +100 per turn: 100 -> 200 -> 300.
        expect(finalCity1.agriculture).toBeGreaterThanOrEqual(300);
        // Commerce depends on trust/stats. Default trust 50, so ~40 per turn.
        // 100 -> 140 -> 180.
        expect(finalCity1.commerce).toBeGreaterThanOrEqual(180);

        // Gen 1 Trained
        expect(finalGen1.train).toBeGreaterThan(0);
    });
});
