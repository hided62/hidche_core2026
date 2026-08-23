import { ConstantRNG, RandUtil } from '@sammo-ts/common';
import { describe, expect, it } from 'vitest';

import type { City, General, Nation } from '../../../src/domain/entities.js';
import { resolveGeneralAction, type TurnScheduleContext } from '../../../src/actions/engine.js';
import { ActionDefinition as TroopKickAction } from '../../../src/actions/turn/nation/che_부대탈퇴지시.js';
import { ActionDefinition as PopulationMoveAction } from '../../../src/actions/turn/nation/cr_인구이동.js';
import { ActionResolver as MobilizePeopleAction } from '../../../src/actions/turn/nation/che_백성동원.js';
import {
    ActionResolver as VolunteerRecruitAction,
    type VolunteerRecruitEnvironment,
} from '../../../src/actions/turn/nation/che_의병모집.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import { orderLegacyActionLoggerFlush } from '../../../src/logging/actionLogger.js';
import { finalizeLogEntry } from '../../../src/logging/entries.js';
import { LogCategory, type LogEntryDraft, LogFormat, LogScope } from '../../../src/logging/types.js';

const scheduleContext: TurnScheduleContext = {
    now: new Date('2026-08-23T00:00:00.000Z'),
    schedule: { entries: [{ startMinute: 0, tickMinutes: 60 }] },
};

const makeGeneral = (overrides: Partial<General> = {}): General =>
    ({
        id: 1,
        name: '군주',
        nationId: 1,
        cityId: 1,
        troopId: 0,
        npcState: 0,
        officerLevel: 12,
        experience: 1_000,
        dedication: 1_000,
        gold: 1_000,
        rice: 1_000,
        crew: 100,
        crewTypeId: 1,
        train: 100,
        atmos: 100,
        injury: 0,
        age: 30,
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

const makeNation = (overrides: Partial<Nation> = {}): Nation => ({
    id: 1,
    name: '검증국',
    color: '#ff0000',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 10_000,
    rice: 10_000,
    power: 0,
    level: 1,
    typeCode: 'che_def',
    meta: { gennum: 2, strategic_cmd_limit: 0 },
    ...overrides,
});

const makeCity = (overrides: Partial<City> = {}): City => ({
    id: 1,
    name: '성도',
    nationId: 1,
    level: 1,
    state: 0,
    population: 50_000,
    populationMax: 100_000,
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
    meta: {},
    ...overrides,
});

const makeRng = (): RandUtil => new RandUtil(new ConstantRNG(0));

const expectMonthlyPersistence = (entry: LogEntryDraft, wrongFormat: LogFormat): void => {
    expect(entry.format).toBe(LogFormat.MONTH);
    const persisted = finalizeLogEntry(entry, { year: 186, month: 9 });
    const mutant = finalizeLogEntry({ ...entry, format: wrongFormat }, { year: 186, month: 9 });

    expect(persisted?.text).toMatch(/^<C>●<\/>9월:/u);
    expect(mutant?.text).not.toBe(persisted?.text);
    expect(mutant?.text).not.toMatch(/^<C>●<\/>9월:/u);
};

describe('nation command Ref log parity', () => {
    it('flushes che_부대탈퇴지시 actor then target with the Ref monthly format', () => {
        const actor = makeGeneral();
        const target = makeGeneral({ id: 2, name: '부대원', troopId: 3 });
        const resolution = resolveGeneralAction(
            new TroopKickAction(),
            {
                general: actor,
                nation: makeNation(),
                city: makeCity(),
                destGeneral: target,
                rng: makeRng(),
            } as never,
            scheduleContext,
            { destGeneralId: target.id }
        );
        const logs = orderLegacyActionLoggerFlush(resolution.logs);

        expect(logs).toHaveLength(2);
        expect(logs.map((entry) => entry.generalId)).toEqual([actor.id, target.id]);
        expect(logs.map((entry) => entry.text)).toEqual([
            '<Y>부대원</>에게 부대 탈퇴를 지시했습니다.',
            '<Y>군주</>에게 부대 탈퇴를 지시 받았습니다.',
        ]);
        expect(logs[1]?.legacyFlushGroup).toBe(1);
        expectMonthlyPersistence(logs[1]!, LogFormat.PLAIN);
    });

    it('keeps cr_인구이동 population text ungrouped like PHP integer interpolation', () => {
        const actor = makeGeneral();
        const source = makeCity();
        const destination = makeCity({ id: 2, name: '락양', population: 10_000 });
        const resolution = resolveGeneralAction(
            new PopulationMoveAction({ develCost: 100, baseGold: 1_000, baseRice: 1_000 } as TurnCommandEnv),
            {
                general: actor,
                nation: makeNation(),
                city: source,
                destCity: destination,
                destNation: makeNation(),
                rng: makeRng(),
            } as never,
            scheduleContext,
            { destCityId: destination.id, amount: 10_000 }
        );
        const [entry] = resolution.logs;

        expect(entry).toMatchObject({
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            generalId: actor.id,
            format: LogFormat.MONTH,
            text: '<G><b>락양</b></>으로 인구 <C>10000</>명을 옮겼습니다.',
        });
        expect(entry?.text).not.toBe('<G><b>락양</b></>으로 인구 <C>10,000</>명을 옮겼습니다.');
    });

    it('keeps che_백성동원 notification and history streams distinct in Ref flush order', () => {
        const actor = makeGeneral();
        const target = makeGeneral({ id: 2, name: '동료' });
        const nation = makeNation();
        const destination = makeCity();
        const resolution = resolveGeneralAction(
            new MobilizePeopleAction([], 10),
            {
                general: actor,
                nation,
                city: makeCity(),
                destCity: destination,
                friendlyGenerals: [actor, target],
                rng: makeRng(),
            } as never,
            scheduleContext,
            { destCityId: destination.id }
        );
        const logs = orderLegacyActionLoggerFlush(resolution.logs);

        expect(logs.map((entry) => [entry.scope, entry.category, entry.generalId, entry.nationId])).toEqual([
            [LogScope.GENERAL, LogCategory.ACTION, target.id, undefined],
            [LogScope.GENERAL, LogCategory.HISTORY, actor.id, undefined],
            [LogScope.GENERAL, LogCategory.ACTION, actor.id, undefined],
            [LogScope.NATION, LogCategory.HISTORY, undefined, nation.id],
        ]);
        expect(logs[0]).toMatchObject({
            text: '<Y>군주</>가 <G><b>성도</b></>에 <M>백성동원</>을 하였습니다.',
            format: LogFormat.PLAIN,
            legacyFlushGroup: -1,
        });
        expect(logs[3]).toMatchObject({
            text: '<Y>군주</>가 <G><b>성도</b></>에 <M>백성동원</>을 발동',
            format: LogFormat.YEAR_MONTH,
        });
        expect(logs[3]?.text).not.toBe(logs[0]?.text);
    });

    it('preserves che_의병모집 actor history markup and Ref flush order', () => {
        const actor = makeGeneral();
        const target = makeGeneral({ id: 2, name: '동료' });
        const nation = makeNation();
        const environment: VolunteerRecruitEnvironment = {
            openingPartYear: 0,
            initialNationGenLimit: 10,
            defaultNpcGold: 1_000,
            defaultNpcRice: 1_000,
            defaultCrewTypeId: 1,
            defaultSpecialDomestic: null,
            defaultSpecialWar: null,
            createCountBase: 0,
            createCountDivisor: 8,
        };
        const resolution = resolveGeneralAction(
            new VolunteerRecruitAction([], environment),
            {
                general: actor,
                nation,
                city: makeCity(),
                rng: makeRng(),
                currentYear: 190,
                currentMonth: 1,
                startYear: 180,
                centennialRules: {
                    defaultStatMin: 15,
                    defaultStatMax: 80,
                    defaultStatTotal: 165,
                    maxStatLevel: 255,
                    defaultSpecialDomestic: null,
                    dexLimit: 1_000_000,
                },
                centennialNpcDexTargetRatio: 0.4,
                averageNationGeneralCount: 0,
                nationAverageStats: { leadership: 50, strength: 50, intelligence: 50 },
                nationAverageExperience: 0,
                nationAverageDedication: 0,
                nationAverageDex: [100, 100, 100, 100, 100],
                friendlyGenerals: [actor, target],
                createGeneralId: () => 3,
                turnTermSeconds: 60,
                turnTimeBase: new Date('0190-01-01T00:00:00.000Z'),
                ticksPerSecond: 1,
            } as never,
            scheduleContext,
            {}
        );
        const logs = orderLegacyActionLoggerFlush(resolution.logs);

        expect(logs.map((entry) => [entry.scope, entry.category, entry.generalId, entry.nationId])).toEqual([
            [LogScope.GENERAL, LogCategory.ACTION, target.id, undefined],
            [LogScope.GENERAL, LogCategory.HISTORY, actor.id, undefined],
            [LogScope.GENERAL, LogCategory.ACTION, actor.id, undefined],
            [LogScope.NATION, LogCategory.HISTORY, undefined, nation.id],
        ]);
        expect(logs[0]).toMatchObject({
            text: '<Y>군주</>가 <M>의병모집</>을 발동하였습니다.',
            format: LogFormat.PLAIN,
            legacyFlushGroup: -1,
        });
        expect(logs[1]).toMatchObject({
            text: '<M>의병모집</>을 발동',
            format: LogFormat.YEAR_MONTH,
        });
        expect(logs[1]?.text).not.toBe('의병모집 발동');
    });
});
