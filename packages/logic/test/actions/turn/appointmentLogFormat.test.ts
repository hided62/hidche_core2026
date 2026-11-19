import { describe, expect, it, vi } from 'vitest';

import type { General, GeneralMeta, Nation } from '../../../src/domain/entities.js';
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
    meta: { killturn: 70 },
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

        const result = action.resolve(
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
        expect(result.effects).toContainEqual(
            expect.objectContaining({
                type: 'general:patch',
                patch: expect.objectContaining({ meta: expect.objectContaining({ joinedNations: [2] }) }),
            })
        );
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

        const result = action.resolve(
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
        expect(result.effects).toContainEqual(
            expect.objectContaining({
                type: 'general:patch',
                patch: expect.objectContaining({ meta: expect.objectContaining({ joinedNations: [2] }) }),
            })
        );
        expect(
            logs.find((entry) => entry.scope === LogScope.GENERAL && entry.category === LogCategory.HISTORY)?.format
        ).toBe(LogFormat.YEAR_MONTH);
    });
});

describe('random appointment nation history', () => {
    const action = new RandomAppointmentAction({} as TurnCommandEnv);
    const resolve = (meta: GeneralMeta, eligibleIds: number[], historicalNpcAffinityMode = false) => {
        const rng = { nextFloat1: vi.fn(() => 0.42), nextInt: vi.fn(() => 0) };
        const candidateNations = eligibleIds.map((id) => ({
            nation: { ...nation, id },
            generals: [],
            generalCount: 1,
            monarchCityId: 2,
            monarchAffinity: 0,
        }));
        const result = action.resolve(
            {
                general: { ...actor, meta },
                rng,
                candidateNations,
                relYear: 4,
                initialNationGenLimit: 10,
                historicalNpcAffinityMode,
            } as unknown as Parameters<typeof action.resolve>[0],
            {}
        );
        return { ...result, rng, actorPatch: result.effects.find((effect) => effect.type === 'general:patch')?.patch };
    };

    it.each([false, true])(
        'excludes visited nations and resets only when the eligible pool is exhausted (affinity: %s)',
        (affinity) => {
            const first = resolve(actor.meta, [2, 3], affinity);
            expect(first.actorPatch).toMatchObject({ nationId: 2, meta: { joinedNations: [2] } });
            expect(first.rng.nextFloat1).toHaveBeenCalledTimes(affinity ? 2 : 1);

            const second = resolve(first.actorPatch!.meta!, [2, 3], affinity);
            expect(second.actorPatch).toMatchObject({ nationId: 3, meta: { joinedNations: [2, 3] } });
            expect(second.rng.nextFloat1).toHaveBeenCalledTimes(1);
            expect(second.rng.nextInt).toHaveBeenCalledTimes(1);

            const third = resolve(second.actorPatch!.meta!, [2, 3], affinity);
            expect(third.actorPatch).toMatchObject({ nationId: 2, meta: { joinedNations: [2] } });
            expect(third.rng.nextFloat1).toHaveBeenCalledTimes(affinity ? 2 : 1);
        }
    );

    it('reads legacy IDs, resets for one eligible visited nation, and retains history when the pool is empty', () => {
        const meta = { ...actor.meta, joinedNations: ['2', 4, 4, 0, 'invalid'] };
        const unvisited = resolve(meta, [2, 3]);
        expect(unvisited.actorPatch).toMatchObject({ nationId: 3, meta: { joinedNations: [2, 4, 3] } });

        const restarted = resolve(meta, [2]);
        expect(restarted.actorPatch).toMatchObject({ nationId: 2, meta: { joinedNations: [2] } });
        expect(restarted.rng.nextFloat1).toHaveBeenCalledTimes(1);

        const unavailable = resolve(meta, []);
        expect(unavailable.actorPatch).toBeUndefined();
        expect(unavailable.alternative).toEqual({ commandKey: 'che_인재탐색', args: {} });
        expect(unavailable.rng.nextFloat1).not.toHaveBeenCalled();
        expect(meta.joinedNations).toEqual(['2', 4, 4, 0, 'invalid']);
    });
});
