import { describe, expect, it } from 'vitest';

import {
    parseTurnCommandProfile,
    resolveScenarioTurnCommandProfile,
    type TurnCommandProfile,
} from '../src/actions/turn/commandProfile.js';

const fallback: TurnCommandProfile = {
    general: ['휴식', 'che_훈련'],
    nation: ['휴식', 'che_발령'],
};

describe('scenario turn command profile', () => {
    it('fails closed for malformed, duplicate, or rest-less base profiles', () => {
        expect(() => parseTurnCommandProfile({ general: ['휴식'], nation: '휴식' })).toThrow(
            'Invalid turn command profile'
        );
        expect(() => parseTurnCommandProfile({ general: ['휴식', '휴식'], nation: ['휴식'] })).toThrow(
            'Duplicate general command key'
        );
        expect(() => parseTurnCommandProfile({ general: ['che_훈련'], nation: ['휴식'] })).toThrow('must include 휴식');
    });

    it('keeps the base profile when the scenario does not override command groups', () => {
        expect(resolveScenarioTurnCommandProfile({}, fallback)).toEqual({
            profile: fallback,
            generalGroups: null,
            nationGroups: null,
        });
    });

    it('flattens Ref command groups while preserving category and command order', () => {
        const result = resolveScenarioTurnCommandProfile(
            {
                availableGeneralCommand: {
                    개인: ['휴식'],
                    군사: ['cr_맹훈련', 'che_훈련'],
                },
                availableChiefCommand: {
                    휴식: ['휴식'],
                    연구: ['event_대검병연구'],
                },
            },
            fallback
        );

        expect(result.profile).toEqual({
            general: ['휴식', 'cr_맹훈련', 'che_훈련'],
            nation: ['휴식', 'event_대검병연구'],
        });
        expect(result.generalGroups).toEqual([
            { category: '개인', commands: ['휴식'] },
            { category: '군사', commands: ['cr_맹훈련', 'che_훈련'] },
        ]);
        expect(result.nationGroups).toEqual([
            { category: '휴식', commands: ['휴식'] },
            { category: '연구', commands: ['event_대검병연구'] },
        ]);
    });

    it('fails closed for unknown, duplicate, or fallback-less scenario commands', () => {
        expect(() => resolveScenarioTurnCommandProfile('invalid', fallback)).toThrow(
            'Scenario const must be an object'
        );
        expect(() =>
            resolveScenarioTurnCommandProfile(
                { availableGeneralCommand: { 개인: ['휴식', 'unknown-command'] } },
                fallback
            )
        ).toThrow('Unknown scenario general command key');
        expect(() =>
            resolveScenarioTurnCommandProfile({ availableChiefCommand: { 휴식: ['휴식'], 기타: ['휴식'] } }, fallback)
        ).toThrow('Duplicate scenario nation command key');
        expect(() =>
            resolveScenarioTurnCommandProfile({ availableGeneralCommand: { 군사: ['che_훈련'] } }, fallback)
        ).toThrow('must include 휴식');
    });
});
