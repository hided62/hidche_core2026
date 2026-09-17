import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildScenarioBootstrap, type ConstraintContext } from '@sammo-ts/logic';
import { ActionDefinition as Sortie } from '@sammo-ts/logic/actions/turn/general/che_출병.js';
import { loadScenarioDefinitionById, resolveScenarioDefaultsPath } from '../src/scenario/scenarioLoader.js';
import { loadMapDefinitionByName } from '../src/scenario/mapLoader.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import { resolveConstraintEnv } from '../src/turn/ai/generalAi/constraint.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnEvent, TurnWorldState } from '../src/turn/types.js';

const files = await fs.readdir(path.dirname(resolveScenarioDefaultsPath()));
const ids = files
    .flatMap((file) => {
        const match = /^scenario_(\d+)\.json$/.exec(file);
        return match ? [Number(match[1])] : [];
    })
    .sort((a, b) => a - b);

const isSortieNotice = (raw: unknown): raw is unknown[] =>
    Array.isArray(raw) && JSON.stringify(raw).includes('출병 제한');

const build = async (id: number, openingPartYear?: number) => {
    const scenario = await loadScenarioDefinitionById(id);
    if (openingPartYear !== undefined) scenario.config.const.openingPartYear = openingPartYear;
    const map = await loadMapDefinitionByName(scenario.config.environment.mapName);
    return { scenario, ...buildScenarioBootstrap({ scenario, map, options: { hiddenSeed: 'start-year-regression' } }) };
};

describe('scenario calendar and opening contract', () => {
    it.each(ids)('scenario %i preserves raw appearance rules and resolves its game calendar', async (id) => {
        const { scenario, seed, snapshot } = await build(id);
        const startYear = scenario.startYear ?? 180;
        expect(seed.scenarioMeta.startYear).toBe(startYear);
        expect(snapshot.scenarioMeta?.startYear).toBe(startYear);
        if (scenario.startYear === null) {
            expect(seed.generals).toHaveLength(
                scenario.generals.length + scenario.generalsEx.length + scenario.generalsNeutral.length
            );
        }
        const command = new Sortie();
        const commandEnv = buildCommandEnv(scenario.config);
        const opening = commandEnv.openingPartYear as number;
        const dates = [
            { year: startYear - 1, month: 4, reserve: false, execute: false },
            { year: startYear + opening - 3, month: 12, reserve: false, execute: false },
            { year: startYear + opening - 1, month: 12, reserve: true, execute: false },
            { year: startYear + opening, month: 1, reserve: true, execute: true },
        ];
        for (const date of dates) {
            const state: TurnWorldState = {
                id: 1,
                meta: {},
                currentYear: date.year,
                currentMonth: date.month,
                tickSeconds: 60,
                lastTurnTime: new Date('2030-01-01T00:00:00Z'),
            };
            const ctx: ConstraintContext = {
                actorId: 1,
                args: { destCityId: 2 },
                mode: 'full',
                env: resolveConstraintEnv(state, snapshot.scenarioMeta, commandEnv),
            };
            const view = { has: () => false, get: () => null };
            expect(command.buildMinConstraints(ctx, { destCityId: 2 })[0]!.test(ctx, view).kind).toBe(
                date.reserve ? 'allow' : 'deny'
            );
            expect(command.buildConstraints(ctx, { destCityId: 2 })[0]!.test(ctx, view).kind).toBe(
                date.execute ? 'allow' : 'deny'
            );
        }
    });

    it.each([2020, 1031, 915])(
        'scenario %i announces unlock at the same execution boundary after reload',
        async (id) => {
            const { scenario, seed, snapshot } = await build(id);
            const startYear = seed.scenarioMeta.startYear!;
            const opening = buildCommandEnv(scenario.config).openingPartYear as number;
            const events: TurnEvent[] = seed.events.filter(isSortieNotice).map((raw, index) => ({
                id: index + 1,
                targetCode: String(raw[0]).toLowerCase(),
                priority: Number(raw[1]),
                condition: raw[2],
                action: raw.slice(3),
                meta: {},
            }));
            expect(events).toHaveLength(4);
            const notices: string[] = [];
            const state: TurnWorldState = {
                id: 1,
                meta: {},
                currentYear: startYear + opening - 1,
                currentMonth: 11,
                tickSeconds: 60,
                lastTurnTime: new Date('2030-01-01T00:00:00Z'),
            };
            let world: InMemoryTurnWorld | null = null;
            const handler = createMonthlyEventHandler({
                getWorld: () => world,
                startYear,
                actions: new Map([
                    [
                        'NoticeToHistoryLog',
                        (args) => {
                            notices.push(String(args[0]));
                        },
                    ],
                ]),
            });
            world = new InMemoryTurnWorld(
                state,
                {
                    ...snapshot,
                    diplomacy: [],
                    initialEvents: [],
                    generals: [],
                    events: JSON.parse(JSON.stringify(events)) as TurnEvent[],
                },
                { schedule: { entries: [{ startMinute: 0, tickMinutes: 1 }] }, calendarHandler: handler }
            );
            await world.advanceMonth(new Date('2030-01-01T00:01:00Z'));
            expect(notices).toEqual([]);
            await world.advanceMonth(new Date('2030-01-01T00:02:00Z'));
            expect(notices).toEqual(['<S>출병 제한이 풀렸습니다.</>']);
            expect(
                world.listEvents().some((event) => JSON.stringify(event.action).includes('출병 제한이 풀렸습니다'))
            ).toBe(false);
        }
    );

    it('moves default notices with an explicitly configured opening period', async () => {
        const { seed } = await build(2020, 5);
        expect(seed.events.filter(isSortieNotice).map((event) => event[2])).toEqual([
            ['DateRelative', '==', 3, 1],
            ['DateRelative', '==', 4, 1],
            ['DateRelative', '==', 4, 7],
            ['DateRelative', '==', 5, 1],
        ]);
    });
});
