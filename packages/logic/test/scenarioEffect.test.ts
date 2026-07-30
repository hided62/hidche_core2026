import { ConstantRNG, RandUtil } from '@sammo-ts/common';
import { describe, expect, it } from 'vitest';

import { createScenarioEffectActionModules } from '../src/actionModules/scenarioEffect.js';
import type { General } from '../src/domain/entities.js';
import { ActionLogger } from '../src/logging/actionLogger.js';
import { createWarTriggerEnv } from '../src/war/triggers.js';
import type { WarUnit } from '../src/war/units.js';
import { WarUnitCity } from '../src/war/units.js';

const generalContext = { general: {} as General };

const buildGeneralUnit = (isAttacker = true): WarUnit =>
    ({
        isAttacker: () => isAttacker,
    }) as unknown as WarUnit;

const buildCityUnit = (isAttacker = false): WarUnit => {
    const unit = Object.create(WarUnitCity.prototype) as WarUnit & {
        isAttacker: () => boolean;
    };
    unit.isAttacker = () => isAttacker;
    return unit;
};

describe('scenario effect action modules', () => {
    it.each(['event_UnlimitedDefenceThresholdChange', 'event_StrongAttacker', 'event_MoreEffect'])(
        '%s removes only the defence-setting train/atmos penalty',
        (key) => {
            const module = createScenarioEffectActionModules(key).general;
            expect(module?.onCalcDomestic?.(generalContext, 'changeDefenceTrain', 'train', -3)).toBe(0);
            expect(module?.onCalcDomestic?.(generalContext, 'changeDefenceTrain', 'atmos', -6)).toBe(0);
        }
    );

    it('doubles only the eight MoreEffect domestic score actions', () => {
        const module = createScenarioEffectActionModules('event_MoreEffect').general!;
        for (const action of ['상업', '농업', '치안', '기술', '성벽', '수비', '인구', '민심'] as const) {
            expect(module.onCalcDomestic?.(generalContext, action, 'score', 12.5)).toBe(25);
            expect(module.onCalcDomestic?.(generalContext, action, 'cost', 12.5)).toBe(12.5);
        }
        expect(module.onCalcDomestic?.(generalContext, '징병', 'score', 12.5)).toBe(12.5);
    });

    it('retains the dormant MoreEffect income hook contract without wiring it to monthly income', () => {
        const module = createScenarioEffectActionModules('event_MoreEffect').general!;
        expect(module.onCalcNationalIncome?.(generalContext, 'gold', 10)).toBe(20);
        expect(module.onCalcNationalIncome?.(generalContext, 'rice', 10)).toBe(20);
        expect(module.onCalcNationalIncome?.(generalContext, 'pop', 10)).toBe(20);
        expect(module.onCalcNationalIncome?.(generalContext, 'pop', -10)).toBe(-10);
    });

    it('preserves StrongAttacker city exclusions and the exact 0.7143 literal', () => {
        const strong = createScenarioEffectActionModules('event_StrongAttacker').war!;
        const more = createScenarioEffectActionModules('event_MoreEffect').war!;
        const attacker = buildGeneralUnit(true);
        const defender = buildGeneralUnit(false);
        const city = buildCityUnit(false);

        expect(strong.getWarPowerMultiplier?.(generalContext, attacker, defender)).toEqual([1.4, 0.7143]);
        expect(strong.getWarPowerMultiplier?.(generalContext, defender, attacker)).toEqual([1, 1]);
        expect(strong.getWarPowerMultiplier?.(generalContext, attacker, city)).toEqual([1, 1]);
        expect(strong.getWarPowerMultiplier?.(generalContext, city, attacker)).toEqual([1, 1]);
        expect(more.getWarPowerMultiplier?.(generalContext, attacker, city)).toEqual([1.4, 0.7143]);
    });

    it('adds one phase and the exact two logs only for a progressed unit facing a fresh opponent', () => {
        const selfLogger = new ActionLogger({ generalId: 1 });
        const opposeLogger = new ActionLogger({ generalId: 2 });
        let bonusPhase = 0;
        const self = {
            getUnitId: () => 'general:1',
            isAttacker: () => true,
            getPhase: () => 1,
            addBonusPhase: (count: number) => {
                bonusPhase += count;
            },
            getLogger: () => selfLogger,
        } as unknown as WarUnit;
        const oppose = {
            getUnitId: () => 'general:2',
            isAttacker: () => false,
            getPhase: () => 0,
            addBonusPhase: () => undefined,
            getLogger: () => opposeLogger,
        } as unknown as WarUnit;

        const module = createScenarioEffectActionModules('event_StrongAttacker').war!;
        const caller = module.getBattlePhaseTriggerList?.({ general: {} as General, unit: self });
        let rngCalls = 0;
        const source = new Proxy(new ConstantRNG(0), {
            get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver);
                if (typeof value !== 'function' || !String(property).startsWith('next')) {
                    return value;
                }
                return (...args: unknown[]) => {
                    rngCalls += 1;
                    return Reflect.apply(value, target, args);
                };
            },
        });
        caller?.fire({ rng: new RandUtil(source), attacker: self, defender: oppose }, createWarTriggerEnv());

        expect(bonusPhase).toBe(1);
        expect(rngCalls).toBe(0);
        expect(selfLogger.flush()).toContainEqual(
            expect.objectContaining({ text: '적군의 전멸에 <C>진격</>이 이어집니다!' })
        );
        expect(opposeLogger.flush()).toContainEqual(
            expect.objectContaining({ text: '아군의 전멸에 상대의 <R>진격</>이 이어집니다!' })
        );
    });

    it('returns no module for None/null and fails fast for an unknown effect', () => {
        expect(createScenarioEffectActionModules(null)).toEqual({ general: null, war: null });
        expect(createScenarioEffectActionModules('None')).toEqual({ general: null, war: null });
        expect(() => createScenarioEffectActionModules('event_Missing')).toThrow(
            'Unknown scenario effect: event_Missing'
        );
    });
});
