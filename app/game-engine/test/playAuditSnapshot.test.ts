import { describe, expect, it } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';
import type { TurnGeneral } from '../src/turn/types.js';
import { buildAuditSnapshot } from '../src/playAudit/snapshot.js';

const turnTime = new Date('0200-01-01T00:00:00.000Z');

const buildGeneral = (id: number, nationId: number): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId,
    cityId: nationId,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 1_000,
    dedication: 900,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 2_000,
    rice: 2_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: nationId === 0 ? 2 : 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    turnTime,
});

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: `도시${id}`,
    nationId,
    level: 1,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
});

const buildNation = (id: number, power: number, meta: Nation['meta']): Nation => ({
    id,
    name: id === 0 ? '재야' : `국가${id}`,
    color: '#777777',
    capitalCityId: id === 0 ? null : id,
    chiefGeneralId: null,
    gold: 10_000,
    rice: 20_000,
    power,
    level: id === 0 ? 0 : 1,
    typeCode: 'che_중립',
    meta,
});

describe('play audit monthly projection', () => {
    it('separates humans, NPCs and troop NPCs and retains empty nations and neutral generals', () => {
        const humans = [buildGeneral(1, 1), { ...buildGeneral(2, 1), npcState: 1, gold: 0 }];
        humans[0]!.meta.dex1 = 10;
        const result = buildAuditSnapshot({
            nations: [buildNation(0, 0, {}), buildNation(1, 0, {}), buildNation(2, 0, {})],
            cities: [buildCity(1, 2)],
            generals: [
                ...humans,
                { ...buildGeneral(3, 1), npcState: 2 },
                { ...buildGeneral(4, 1), npcState: 5 },
                buildGeneral(5, 0),
            ],
            settlements: [],
            settlementsComplete: true,
        });
        const nation = result.nations.find((row) => row.id === 1)!;
        expect(nation.populations.human).toMatchObject({
            count: 2,
            gold: 2000,
            averageGold: 1000,
            averageDex: { dex1: 5 },
        });
        expect(nation.populations.npc.count).toBe(1);
        expect(nation.populations.troopNpc.count).toBe(1);
        expect(result.nations.find((row) => row.id === 2)!.populations.human.averageGold).toBeNull();
        expect(result.nations.find((row) => row.id === 0)!.populations.npc.count).toBe(1);
        expect(result.cities[0]!.nationId).toBe(2);
        expect(result.generals[0]!.nationId).toBe(1);
        expect(result.generals[0]!.cityId).toBe(1);
    });

    it('uses observed settlements, preserves fractions and does not reuse stale income', () => {
        const input = {
            nations: [buildNation(1, 0, { prev_income_gold: 999999 })],
            cities: [],
            generals: [],
            settlements: [{ nationId: 1, resource: 'gold' as const, income: 943.5, paid: 123 }],
        };
        expect(buildAuditSnapshot({ ...input, settlementsComplete: true }).nations[0]).toMatchObject({
            incomeGold: 943.5,
            paidGold: 123,
            incomeRice: 0,
            paidRice: 0,
        });
        expect(
            buildAuditSnapshot({ ...input, settlements: [], settlementsComplete: true }).nations[0]!.incomeGold
        ).toBe(0);
        expect(buildAuditSnapshot({ ...input, settlementsComplete: false }).nations[0]).toMatchObject({
            incomeGold: null,
            paidGold: null,
            incomeRice: null,
            paidRice: null,
        });
    });

    it('takes detached allowlisted state without credentials or mutable metadata', () => {
        const general = buildGeneral(1, 1);
        general.userId = 'owner';
        general.meta.secret = 'must-not-copy';
        general.role.items.horse = 'horse';
        const city = buildCity(1, 1);
        const result = buildAuditSnapshot({
            nations: [buildNation(1, 0, {})],
            cities: [city],
            generals: [general],
            settlements: [],
            settlementsComplete: true,
        });
        general.name = 'renamed';
        general.stats.strength = 1;
        general.role.items.horse = null;
        city.population = 0;
        expect(result.generals[0]).toMatchObject({
            name: '장수1',
            userId: 'owner',
            stats: { strength: 70 },
            role: { items: { horse: 'horse' } },
        });
        expect(JSON.stringify(result)).not.toContain('must-not-copy');
        expect(result.cities[0]!.population).toBe(10000);
    });

    it('consumes each source once without per-nation scans', () => {
        function once<T>(rows: T[]): Iterable<T> {
            let used = false;
            return {
                *[Symbol.iterator]() {
                    if (used) throw new Error('second full scan');
                    used = true;
                    yield* rows;
                },
            };
        }
        const result = buildAuditSnapshot({
            nations: once([buildNation(1, 0, {})]),
            cities: once([buildCity(1, 1)]),
            generals: once([buildGeneral(1, 1)]),
            settlements: once([]),
            settlementsComplete: true,
        });
        expect(result.generals).toHaveLength(1);
    });
});
