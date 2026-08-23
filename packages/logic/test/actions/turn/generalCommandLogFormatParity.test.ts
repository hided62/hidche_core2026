import { describe, expect, it } from 'vitest';

import type { City, General, Nation } from '../../../src/domain/entities.js';
import type { GeneralActionResolveContext } from '../../../src/actions/engine.js';
import { ActionDefinition as TradeAction } from '../../../src/actions/turn/general/che_군량매매.js';
import { ActionResolver as ResignAction } from '../../../src/actions/turn/general/che_하야.js';
import { ActionResolver as RetireAction } from '../../../src/actions/turn/general/che_은퇴.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import { finalizeLogEntry } from '../../../src/logging/entries.js';
import { LogCategory, type LogEntryDraft, LogFormat, LogScope } from '../../../src/logging/types.js';

const makeGeneral = (overrides: Partial<General> = {}): General =>
    ({
        id: 1,
        name: '검증장수',
        nationId: 2,
        cityId: 3,
        troopId: 0,
        npcState: 0,
        officerLevel: 1,
        experience: 100,
        dedication: 100,
        gold: 1_000,
        rice: 1_000,
        crew: 100,
        crewTypeId: 1,
        train: 100,
        atmos: 100,
        injury: 0,
        age: 60,
        stats: { leadership: 70, strength: 60, intelligence: 50 },
        role: {
            personality: null,
            specialDomestic: null,
            specialWar: null,
            items: { horse: null, weapon: null, book: null, item: null },
        },
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        meta: {},
        ...overrides,
    }) as General;

const nation = {
    id: 2,
    name: '검증국',
    color: '#ff0000',
    capitalCityId: 3,
    chiefGeneralId: 1,
    gold: 10_000,
    rice: 10_000,
    power: 0,
    level: 1,
    typeCode: 'che_def',
    meta: { gennum: 1 },
} satisfies Nation;

const city = {
    id: 3,
    name: '검증도시',
    nationId: nation.id,
    level: 1,
    state: 0,
    population: 20_000,
    populationMax: 50_000,
    agriculture: 500,
    agricultureMax: 1_000,
    commerce: 500,
    commerceMax: 1_000,
    security: 500,
    securityMax: 1_000,
    defence: 300,
    defenceMax: 1_000,
    wall: 300,
    wallMax: 1_000,
    supplyState: 1,
    frontState: 0,
    meta: { trade: 100 },
} satisfies City;

const createLogSink =
    (logs: LogEntryDraft[]): GeneralActionResolveContext['addLog'] =>
    (text, options = {}) => {
        const entry: LogEntryDraft = {
            scope: options.scope ?? LogScope.GENERAL,
            category: options.category ?? LogCategory.ACTION,
            text,
            ...options,
        };
        if (entry.scope === LogScope.GENERAL && entry.generalId === undefined) {
            entry.generalId = 1;
        }
        logs.push(entry);
    };

const expectMonthlyPersistence = (entry: LogEntryDraft, legacyWrongFormat: LogFormat): void => {
    expect(entry.format).toBe(LogFormat.MONTH);

    const persisted = finalizeLogEntry(entry, { year: 186, month: 9 });
    const mutant = finalizeLogEntry({ ...entry, format: legacyWrongFormat }, { year: 186, month: 9 });

    expect(persisted?.text).toMatch(/^<C>●<\/>9월:/u);
    expect(mutant?.text).not.toBe(persisted?.text);
    expect(mutant?.text).not.toMatch(/^<C>●<\/>9월:/u);
};

describe('general command Ref log format parity', () => {
    it.each([
        { buyRice: true, amount: 100 },
        { buyRice: false, amount: 100 },
    ])('keeps che_군량매매 action logs on the Ref monthly format for $buyRice', (args) => {
        const logs: LogEntryDraft[] = [];
        const action = new TradeAction();

        action.resolve(
            {
                general: makeGeneral(),
                city,
                nation: { ...nation },
                rng: { nextFloat1: () => 0 },
                addLog: createLogSink(logs),
            } as unknown as Parameters<typeof action.resolve>[0],
            args
        );

        expect(logs).toHaveLength(1);
        expectMonthlyPersistence(logs[0]!, LogFormat.PLAIN);
    });

    it('keeps the che_하야 system summary on the Ref monthly format', () => {
        const logs: LogEntryDraft[] = [];
        const action = new ResignAction({ defaultNpcGold: 1_000, defaultNpcRice: 1_000 } as TurnCommandEnv);

        action.resolve(
            {
                general: makeGeneral(),
                nation,
                troopMembers: [],
                rng: {},
                addLog: createLogSink(logs),
            } as unknown as Parameters<typeof action.resolve>[0],
            {}
        );

        const summary = logs.find((entry) => entry.scope === LogScope.SYSTEM && entry.category === LogCategory.SUMMARY);
        expect(summary).toBeDefined();
        expectMonthlyPersistence(summary!, LogFormat.RAWTEXT);
    });

    it('keeps the che_은퇴 system summary on the Ref monthly format', () => {
        const logs: LogEntryDraft[] = [];
        const action = new RetireAction();

        action.resolve(
            {
                general: makeGeneral(),
                rng: {},
                addLog: createLogSink(logs),
            } as unknown as Parameters<typeof action.resolve>[0],
            {}
        );

        const summary = logs.find((entry) => entry.scope === LogScope.SYSTEM && entry.category === LogCategory.SUMMARY);
        expect(summary).toBeDefined();
        expectMonthlyPersistence(summary!, LogFormat.RAWTEXT);
    });
});
