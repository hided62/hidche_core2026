import { describe, expect, it } from 'vitest';

import type { General } from '../src/domain/entities.js';
import {
    CENTENNIAL_ALL_STAR_AUX_KEY,
    applyCentennialAllStarTarget,
    calculateCentennialGeneratedNpcInitialStats,
    calculateCentennialLegacyUserGrant,
    calculateCentennialProgress,
    calculateCentennialUserInitialStats,
    initialCentennialAllStarAux,
    prepareCentennialLegacyUserReselection,
    readCentennialAllStarPoolTarget,
    readCentennialAllStarAux,
    reconcileCentennialDexConversion,
    type CentennialAllStarRules,
    type CentennialAllStarTarget,
} from '../src/scenario/centennialAllStar.js';

const rules: CentennialAllStarRules = {
    defaultStatMin: 15,
    defaultStatMax: 80,
    defaultStatTotal: 165,
    maxStatLevel: 255,
    defaultSpecialDomestic: 'None',
    dexLimit: 1_000_000,
};

const target = (overrides: Partial<CentennialAllStarTarget> = {}): CentennialAllStarTarget => ({
    uniqueName: 'A1000001',
    generalName: '1·조민',
    leadership: 100,
    strength: 80,
    intel: 10,
    dex: [900_000, 800_000, 700_000, 600_000, 500_000],
    specialDomestic: 'che_event_무쌍',
    ...overrides,
});

const general = (overrides: Partial<General> = {}): General => ({
    id: 1,
    name: '장수',
    nationId: 0,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 15, strength: 15, intelligence: 10 },
    experience: 0,
    dedication: 0,
    officerLevel: 0,
    role: {
        personality: 'che_안전',
        specialDomestic: 'None',
        specialWar: 'None',
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 5, dex1: 0, dex2: 0, dex3: 0, dex4: 0, dex5: 0 },
    ...overrides,
});

const metaWithAux = (aux: ReturnType<typeof initialCentennialAllStarAux>, killturn = 5): General['meta'] => {
    const meta: General['meta'] = { killturn, dex1: 0, dex2: 0, dex3: 0, dex4: 0, dex5: 0 };
    const mutable: Record<string, unknown> = meta;
    mutable[CENTENNIAL_ALL_STAR_AUX_KEY] = aux;
    return meta;
};

describe('100기 올스타 성장 계약', () => {
    it('uses the Ref 15-year linear milestones and shaped user allocation', () => {
        expect(calculateCentennialProgress({ startYear: 180, year: 180, month: 1 })).toBe(0);
        expect(calculateCentennialProgress({ startYear: 180, year: 183, month: 1 })).toBeCloseTo(0.2);
        expect(calculateCentennialProgress({ startYear: 180, year: 186, month: 1 })).toBeCloseTo(0.4);
        expect(calculateCentennialProgress({ startYear: 180, year: 195, month: 1 })).toBe(1);
        expect(calculateCentennialProgress({ startYear: 180, year: 220, month: 1 }, 0.9)).toBe(0.9);
        expect(calculateCentennialUserInitialStats(target({ leadership: 80, strength: 70, intel: 50 }), rules)).toEqual(
            { leadership: 65, strength: 58, intel: 42 }
        );
    });

    it('recognizes only the S100 source marker as a Centennial pool target', () => {
        expect(
            readCentennialAllStarPoolTarget({
                uniqueName: target().uniqueName,
                name: target().generalName!,
                sourceInfo: { ...target(), event100Growth: true },
            })
        ).toMatchObject(target());
        expect(
            readCentennialAllStarPoolTarget({
                uniqueName: 'legacy',
                name: 'legacy',
                sourceInfo: { ...target(), event100Growth: false },
            })
        ).toBeNull();
    });

    it('marks the legacy creation range as replaceable before first reselection', () => {
        expect(calculateCentennialLegacyUserGrant(90, 10, rules)).toBe(75);
        const legacyMeta = metaWithAux({
            ...initialCentennialAllStarAux(target(), rules),
            granted: {
                ...initialCentennialAllStarAux(target(), rules).granted,
                leadership: 10,
            },
            userInitialStats: null,
        });
        const prepared = prepareCentennialLegacyUserReselection(
            general({
                stats: { leadership: 90, strength: 50, intelligence: 10 },
                meta: legacyMeta,
            }),
            rules
        );
        const aux = readCentennialAllStarAux(prepared)!;

        expect(aux.granted.leadership).toBe(75);
        expect(aux.granted.strength).toBe(35);
        expect(aux.granted.intel).toBe(0);
        expect(aux.userInitialStats).toEqual({ leadership: 80, strength: 50, intel: 10 });
    });

    it('keeps generated NPC stat RNG output while mapping its strong axes to the target', () => {
        expect(
            calculateCentennialGeneratedNpcInitialStats(target(), {
                leadership: 72,
                strength: 66,
                intelligence: 12,
            })
        ).toEqual({ leadership: 72, strength: 66, intelligence: 12 });

        const npc = general({
            npcState: 3,
            stats: { leadership: 72, strength: 66, intelligence: 12 },
            meta: metaWithAux(initialCentennialAllStarAux(target(), rules), 120),
        });
        const result = applyCentennialAllStarTarget(
            npc,
            target(),
            { startYear: 180, year: 195, month: 1 },
            rules,
            0.9,
            0.4
        );
        expect(result.stats).toEqual({ leadership: 91, strength: 73, intelligence: 12 });
        expect([result.meta.dex1, result.meta.dex2, result.meta.dex3, result.meta.dex4, result.meta.dex5]).toEqual([
            360_000, 320_000, 280_000, 240_000, 200_000,
        ]);
        expect(result.milestone).toBe(4);
    });

    it('unlocks the historical trait at 40% and preserves organic growth on reselection', () => {
        const firstTarget = target();
        const initial = calculateCentennialUserInitialStats(firstTarget, rules);
        const first = general({
            stats: {
                leadership: initial.leadership,
                strength: initial.strength,
                intelligence: initial.intel,
            },
            meta: metaWithAux(initialCentennialAllStarAux(firstTarget, rules, initial)),
        });
        const grown = applyCentennialAllStarTarget(first, firstTarget, { startYear: 180, year: 186, month: 1 }, rules);
        expect(grown.role.specialDomestic).toBe('che_event_무쌍');
        expect(grown.milestone).toBe(2);

        const oldGranted = readCentennialAllStarAux(grown.meta)!.granted.leadership;
        const organicLeadership = grown.stats.leadership + 100;
        const changed = applyCentennialAllStarTarget(
            {
                ...first,
                stats: { ...grown.stats, leadership: organicLeadership },
                role: grown.role,
                meta: grown.meta,
            },
            target({
                uniqueName: 'A1000002',
                leadership: 70,
                strength: 60,
                intel: 50,
                specialDomestic: 'che_event_견고',
            }),
            { startYear: 180, year: 186, month: 1 },
            rules
        );
        expect(changed.stats.leadership).toBe(organicLeadership - oldGranted);
        expect(changed.role.specialDomestic).toBe('che_event_견고');
        expect(changed.targetChanged).toBe(true);
    });

    it('does not refill an event-backed dex floor after 숙련전환 consumes it', () => {
        const dexTarget = target({ dex: [1_000_000, 0, 0, 0, 0] });
        const base = general({
            meta: metaWithAux(initialCentennialAllStarAux(dexTarget, rules)),
        });
        const full = applyCentennialAllStarTarget(base, dexTarget, { startYear: 180, year: 195, month: 1 }, rules);
        const convertedMeta = {
            ...full.meta,
            dex1: 600_000,
            dex2: 360_000,
        };
        const reconciled = reconcileCentennialDexConversion(
            convertedMeta,
            'dex1',
            'dex2',
            1_000_000,
            600_000,
            0,
            360_000,
            0.9
        );
        const afterMonth = applyCentennialAllStarTarget(
            { ...base, stats: full.stats, role: full.role, meta: reconciled },
            dexTarget,
            { startYear: 180, year: 195, month: 2 },
            rules
        );
        expect(afterMonth.meta.dex1).toBe(600_000);
        expect(afterMonth.meta.dex2).toBe(360_000);
    });
});
