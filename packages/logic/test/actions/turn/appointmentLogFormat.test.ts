import { describe, expect, it } from 'vitest';

import type { General, Nation } from '../../../src/domain/entities.js';
import type { GeneralActionResolveContext } from '../../../src/actions/engine.js';
import { finalizeLogEntry } from '../../../src/logging/entries.js';
import { LogCategory, type LogEntryDraft, LogFormat, LogScope } from '../../../src/logging/types.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import { ActionDefinition as AppointmentAction } from '../../../src/actions/turn/general/che_임관.js';
import { ActionDefinition as RandomAppointmentAction } from '../../../src/actions/turn/general/che_랜덤임관.js';
import { ActionDefinition as FollowAppointmentAction } from '../../../src/actions/turn/general/che_장수대상임관.js';

const actor = {
    id: 1,
    name: '검증장수',
    nationId: 0,
    cityId: 1,
    npcState: 0,
    officerLevel: 1,
    experience: 100,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    meta: {},
} as General;

const nation = {
    id: 2,
    name: '검증국',
    capitalCityId: 2,
    meta: { gennum: 1 },
} as unknown as Nation;

const createLogSink =
    (logs: LogEntryDraft[]): GeneralActionResolveContext['addLog'] =>
    (text, options = {}) => {
        logs.push({
            scope: options.scope ?? LogScope.GENERAL,
            category: options.category ?? LogCategory.ACTION,
            text,
            format: options.format ?? LogFormat.MONTH,
        });
    };

const expectMonthlySummary = (logs: LogEntryDraft[]): void => {
    const summary = logs.find((entry) => entry.scope === LogScope.SYSTEM && entry.category === LogCategory.SUMMARY);
    expect(summary).toBeDefined();
    expect(summary?.format).toBe(LogFormat.MONTH);
    expect(finalizeLogEntry(summary!, { year: 186, month: 9 })?.text).toMatch(/^<C>●<\/>9월:/u);
};

describe('appointment global summary log format', () => {
    it('adds the legacy month prefix to direct appointment', () => {
        const logs: LogEntryDraft[] = [];
        const action = new AppointmentAction({} as TurnCommandEnv);

        action.resolve(
            {
                general: actor,
                destNation: nation,
                destNationGeneralCount: 1,
                destCityId: 2,
                addLog: createLogSink(logs),
            } as unknown as Parameters<typeof action.resolve>[0],
            { destNationId: nation.id }
        );

        expectMonthlySummary(logs);
    });

    it('adds the legacy month prefix to random appointment', () => {
        const action = new RandomAppointmentAction({} as TurnCommandEnv);
        const result = action.resolve(
            {
                general: actor,
                rng: {
                    nextFloat1: () => 0,
                    nextInt: () => 0,
                },
                candidateNations: [
                    {
                        nation,
                        generals: [],
                        generalCount: 1,
                        monarchCityId: 2,
                        monarchAffinity: 0,
                    },
                ],
                relYear: 1,
                initialNationGenLimit: 10,
                historicalNpcAffinityMode: false,
            } as unknown as Parameters<typeof action.resolve>[0],
            {}
        );
        const logs = result.effects.flatMap((effect) => (effect.type === 'log' ? [effect.entry] : []));

        expectMonthlySummary(logs);
    });

    it('keeps the same month prefix when following another general', () => {
        const logs: LogEntryDraft[] = [];
        const action = new FollowAppointmentAction();

        action.resolve(
            {
                general: actor,
                destNation: nation,
                destNationGeneralCount: 1,
                initialNationGenLimit: 10,
                addLog: createLogSink(logs),
            } as unknown as Parameters<typeof action.resolve>[0],
            { destGeneralID: 9 }
        );

        expectMonthlySummary(logs);
        expect(
            logs.find((entry) => entry.scope === LogScope.GENERAL && entry.category === LogCategory.HISTORY)?.format
        ).toBe(LogFormat.YEAR_MONTH);
    });
});
