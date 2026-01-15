import { describe, expect, it } from 'vitest';

import type { CityRow, GeneralRow, NationRow, WorldStateRow } from '../src/context.js';
import { buildTurnCommandTable } from '../src/turns/commandTable.js';

const buildWorldState = (): WorldStateRow =>
    ({
        id: 1,
        scenarioCode: 'default',
        currentYear: 3,
        currentMonth: 1,
        tickSeconds: 600,
        config: {
            const: {
                baseGold: 1000,
                baseRice: 1000,
                develCost: 100,
            },
        },
        meta: {
            scenarioMeta: {
                startYear: 1,
            },
        },
        updatedAt: new Date('2026-01-01T00:00:00Z'),
    }) as unknown as WorldStateRow;

const buildGeneral = (): GeneralRow =>
    ({
        id: 1,
        name: 'TestGeneral',
        nationId: 1,
        cityId: 1,
        troopId: 0,
        leadership: 70,
        strength: 60,
        intel: 60,
        experience: 0,
        dedication: 0,
        officerLevel: 6,
        personalCode: null,
        specialCode: null,
        special2Code: null,
        horseCode: null,
        weaponCode: null,
        bookCode: null,
        itemCode: null,
        injury: 0,
        gold: 0,
        rice: 0,
        crew: 100,
        crewTypeId: 1100,
        train: 0,
        atmos: 0,
        age: 25,
        npcState: 0,
        meta: {},
    }) as unknown as GeneralRow;

const buildCity = (): CityRow =>
    ({
        id: 1,
        name: 'TestCity',
        nationId: 1,
        level: 5,
        population: 100000,
        populationMax: 200000,
        agriculture: 1000,
        agricultureMax: 2000,
        commerce: 1000,
        commerceMax: 2000,
        security: 1000,
        securityMax: 2000,
        supplyState: 1,
        frontState: 0,
        defence: 0,
        defenceMax: 0,
        wall: 0,
        wallMax: 0,
        meta: {},
        trust: 50,
        trade: 0,
        region: 0,
    }) as unknown as CityRow;

const buildNation = (): NationRow =>
    ({
        id: 1,
        name: 'TestNation',
        color: '#000000',
        capitalCityId: 1,
        gold: 0,
        rice: 0,
        level: 1,
        typeCode: 'default',
        tech: 0,
        meta: {},
    }) as unknown as NationRow;

describe('buildTurnCommandTable', () => {
    it('uses min-condition constraints for availability', async () => {
        const table = await buildTurnCommandTable({
            worldState: buildWorldState(),
            general: buildGeneral(),
            city: buildCity(),
            nation: buildNation(),
            nationGenerals: null,
        });

        const nationCommand = table.nation
            .flatMap((group) => group.values)
            .find((command) => command.key === 'che_포상');

        expect(nationCommand).toBeDefined();
        expect(nationCommand?.possible).toBe(true);
        expect(nationCommand?.status).not.toBe('blocked');
    });
});
