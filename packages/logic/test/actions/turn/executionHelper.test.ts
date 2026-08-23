import { describe, it, expect, vi } from 'vitest';
import { processGeneralActionWithFallback, type CommandLoader } from '../../../src/actions/turn/executionHelper.js';
import {
    type GeneralActionResolver,
    type GeneralActionResolveInputContext,
    type TurnScheduleContext,
} from '../../../src/actions/engine.js';

describe('processGeneralActionWithFallback', () => {
    const mockContext = {
        general: { id: 100, name: 'TestGeneral' } as any,
    } as GeneralActionResolveInputContext;
    const mockSchedule = {
        now: new Date('2025-01-01T00:00:00Z'),
        schedule: {
            entries: [{ startMinute: 0, tickMinutes: 1 }],
        },
    } as TurnScheduleContext;

    // Mock Resolvers
    const successResolver: GeneralActionResolver = {
        key: 'successCmd',
        resolve: () => ({
            effects: [],
        }),
    };

    const fallbackResolver: GeneralActionResolver = {
        key: 'fallbackCmd',
        resolve: (context) => {
            context.addPostProgressionLog?.('Primary post-progression');
            return {
                effects: [
                    {
                        type: 'log',
                        entry: { text: 'Primary failed', scope: 'general', category: 'action', format: 'month' },
                    } as any,
                ],
                alternative: {
                    commandKey: 'alternativeCmd',
                    args: { foo: 'bar' },
                },
            };
        },
    };

    const alternativeResolver: GeneralActionResolver = {
        key: 'alternativeCmd',
        resolve: (_, args) => ({
            effects: [
                {
                    type: 'log',
                    entry: {
                        text: `Alternative executed with ${JSON.stringify(args)}`,
                        scope: 'general',
                        category: 'action',
                        format: 'month',
                    },
                } as any,
            ],
        }),
    };

    const infiniteResolver: GeneralActionResolver = {
        key: 'infiniteCmd',
        resolve: () => ({
            effects: [],
            alternative: {
                commandKey: 'infiniteCmd',
                args: {},
            },
        }),
    };

    // Mock Loader
    const mockLoader: CommandLoader = {
        load: vi.fn(async (key: string) => {
            if (key === 'alternativeCmd') return alternativeResolver;
            if (key === 'infiniteCmd') return infiniteResolver;
            return null;
        }),
    };

    it('should execute a simple command successfully', async () => {
        const resolution = await processGeneralActionWithFallback(
            successResolver,
            mockContext,
            mockSchedule,
            {},
            mockLoader
        );

        expect(resolution.effects).toHaveLength(0);
        expect(resolution.alternative).toBeUndefined();
    });

    it('should handle alternative command fallback', async () => {
        const resolution = await processGeneralActionWithFallback(
            fallbackResolver,
            mockContext,
            mockSchedule,
            {},
            mockLoader
        );

        expect(resolution.logs).toHaveLength(2); // 'Primary failed' + 'Alternative executed...'
        expect(resolution.postProgressionLogs.map((entry) => entry.text)).toEqual(['Primary post-progression']);
        expect(resolution.alternative).toBeUndefined(); // The final one succeeded
        expect(mockLoader.load).toHaveBeenCalledWith('alternativeCmd');
    });

    it('should prevent infinite loops', async () => {
        await expect(
            processGeneralActionWithFallback(infiniteResolver, mockContext, mockSchedule, {}, mockLoader)
        ).rejects.toThrow('Command fallback loop limit exceeded');
    });
});
