import { describe, expect, it } from 'vitest';

import {
    DOMESTIC_TRAIT_KEYS,
    EVENT_GYEONGO_RAISE_TYPE,
    EVENT_DOMESTIC_TRAIT_KEYS,
    isWarTraitKey,
    loadEventDomesticTraitModules,
    type WarTraitKey,
    WarTraitLoader,
} from '../src/actionModules/traits/index.js';
import { GYEONGO_RAISE_TYPE } from '../src/actionModules/traits/war/che_견고.js';
import { createWarTriggerEnv } from '../src/war/triggers.js';
import type { WarActionContext } from '../src/war/actions.js';
import type { WarUnit } from '../src/war/units.js';

const canonicalKey = (eventKey: string): WarTraitKey => {
    const key = eventKey.replace(/^che_event_/, 'che_');
    if (!isWarTraitKey(key)) {
        throw new Error(`Missing canonical war trait for ${eventKey}`);
    }
    return key;
};

describe('Ref event domestic traits', () => {
    it('loads all 20 exact DB keys without contaminating ordinary domestic selection keys', async () => {
        const modules = await loadEventDomesticTraitModules([...EVENT_DOMESTIC_TRAIT_KEYS]);
        const warLoader = new WarTraitLoader();

        expect(modules).toHaveLength(20);
        expect(DOMESTIC_TRAIT_KEYS).toHaveLength(8);
        expect(DOMESTIC_TRAIT_KEYS.some((key) => key.startsWith('che_event_'))).toBe(false);
        for (const module of modules) {
            const canonical = await warLoader.load(canonicalKey(module.key));
            expect(module.key).toMatch(/^che_event_/);
            expect(module.kind).toBe('domestic');
            expect(module.name).toBe(canonical.name);
            expect(module.info).toBe(canonical.info);
            expect(module.getName?.()).toBe(canonical.getName?.());
            expect(module.getInfo?.()).toBe(canonical.getInfo?.());
            expect(module.selection).toBeUndefined();
        }
    });

    it('suppresses only the duplicate event multiplier for dual-slot 무쌍', async () => {
        const [eventMusang] = await loadEventDomesticTraitModules(['che_event_무쌍']);
        const unit = {
            getGeneral: () => ({
                role: { specialWar: 'che_무쌍' },
                meta: { rank_killnum: 40 },
            }),
        } as unknown as WarUnit;
        const context = { unit } as unknown as WarActionContext;

        expect(eventMusang!.getWarPowerMultiplier?.(context, unit, unit)).toEqual([1, 1]);
    });

    it('keeps event and ordinary 견고 injury-prevention triggers distinct by raise type', async () => {
        const [eventGyeongo] = await loadEventDomesticTraitModules(['che_event_견고']);
        const canonical = await new WarTraitLoader().load('che_견고');
        const activated: string[] = [];
        const unit = {
            getUnitId: () => 7,
            isAttacker: () => true,
            activateSkill: (name: string) => activated.push(name),
        } as unknown as WarUnit;
        const oppose = {
            getUnitId: () => 8,
            isAttacker: () => false,
        } as unknown as WarUnit;
        const context = { unit } as unknown as WarActionContext;
        const caller = canonical.getBattleInitTriggerList?.(context);
        caller?.merge(eventGyeongo!.getBattleInitTriggerList?.(context));
        caller?.fire(
            { rng: null as never, attacker: unit, defender: oppose },
            createWarTriggerEnv()
        );

        expect(GYEONGO_RAISE_TYPE).toBe(413696);
        expect(EVENT_GYEONGO_RAISE_TYPE).toBe(1);
        expect(activated).toEqual(['부상무효', '부상무효']);
    });
});
