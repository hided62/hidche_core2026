import type { RandUtil } from '@sammo-ts/common';
import { TraitRequirement, TraitWeightType } from './requirements.js';
import type { TraitModule } from './types.js';
import type { ScenarioStatBlock } from '../../scenario/types.js';

export class TraitSelector {
    /**
     * 기초 스탯 기반 선택 조건 계산 (calcCondGeneric)
     */
    static calcCondGeneric(
        stats: { leadership: number; strength: number; intelligence: number },
        scenarioStat: ScenarioStatBlock
    ): number {
        const { leadership, strength, intelligence } = stats;
        const chiefMin = scenarioStat.chiefMin;

        let myCond = 0;
        if (leadership > chiefMin) {
            myCond |= TraitRequirement.STAT_LEADERSHIP;
        }
        if (strength >= intelligence * 0.95 && strength > chiefMin) {
            myCond |= TraitRequirement.STAT_STRENGTH;
        }
        if (intelligence >= strength * 0.95 && intelligence > chiefMin) {
            myCond |= TraitRequirement.STAT_INTEL;
        }

        if (myCond !== 0) {
            if (leadership < chiefMin) myCond |= TraitRequirement.STAT_NOT_LEADERSHIP;
            if (strength < chiefMin) myCond |= TraitRequirement.STAT_NOT_STRENGTH;
            if (intelligence < chiefMin) myCond |= TraitRequirement.STAT_NOT_INTEL;
        }

        if (myCond === 0) {
            if (leadership * 0.9 > strength && leadership * 0.9 > intelligence) {
                myCond |= TraitRequirement.STAT_LEADERSHIP;
            } else if (strength >= intelligence) {
                myCond |= TraitRequirement.STAT_STRENGTH;
            } else {
                myCond |= TraitRequirement.STAT_INTEL;
            }
        }

        return myCond;
    }

    /**
     * 숙련도 기반 선택 조건 계산 (calcCondDexterity)
     */
    static calcCondDexterity(rng: RandUtil, dex: number[]): number {
        const dexMap: Record<number, number> = {
            [TraitRequirement.ARMY_FOOTMAN]: dex[0] || 0,
            [TraitRequirement.ARMY_ARCHER]: dex[1] || 0,
            [TraitRequirement.ARMY_CAVALRY]: dex[2] || 0,
            [TraitRequirement.ARMY_WIZARD]: dex[3] || 0,
            [TraitRequirement.ARMY_SIEGE]: dex[4] || 0,
        };

        const dexSum = Object.values(dexMap).reduce((a, b) => a + b, 0);
        // 루트(합)/4 확률 기반 로직 (Legacy: sqrt(dexSum)/4)
        const dexBase = Math.round(Math.sqrt(dexSum) / 4);

        // Legacy: 80% 확률로 0 반환 (이전 연도에 이미 얻었거나 기타 이유로 제한하는 인지)
        // 실제로는 pickSpecialWar에서 이 메서드 호출 전후에 별도 확률을 둘 수도 있으나,
        // Legacy SpecialityHelper.php의 로직을 그대로 따름.
        if (rng.nextBool(0.8)) {
            return 0;
        }

        if (rng.nextRangeInt(0, 99) < dexBase) {
            return 0;
        }

        if (dexSum === 0) {
            return rng.choice(Object.values(dexMap));
        }

        const maxDex = Math.max(...Object.values(dexMap));
        const candidates = Object.keys(dexMap)
            .map(Number)
            .filter((k) => dexMap[k] === maxDex);

        return Number(rng.choice(candidates));
    }

    /**
     * 사용 가능한 특기 목록에서 하나를 무작위로 선택 (pickTrait)
     */
    private static pickTraitOnce(
        rng: RandUtil,
        myCond: number,
        traits: TraitModule[],
        prevTraitKeys: string[],
        preferDexterity: boolean
    ): string | null {
        const dexterityPool: Array<[string, number]> = [];
        const normPool: Array<[string, number]> = [];
        const percentPool: Array<[string | null, number]> = [];

        for (const trait of traits) {
            if (!trait.selection) continue;
            if (prevTraitKeys.includes(trait.key)) continue;

            let matchedRequirement: number | null = null;
            for (const req of trait.selection.requirements) {
                if (req === (req & myCond)) {
                    matchedRequirement = req;
                    break;
                }
            }

            if (matchedRequirement === null) continue;

            if (preferDexterity && (matchedRequirement & TraitRequirement.REQ_DEXTERITY) !== 0) {
                dexterityPool.push([trait.key, trait.selection.weight]);
            } else if (trait.selection.weightType === TraitWeightType.PERCENT) {
                percentPool.push([trait.key, trait.selection.weight]);
            } else {
                normPool.push([trait.key, trait.selection.weight]);
            }
        }

        if (dexterityPool.length > 0) {
            return rng.choiceUsingWeightPair(dexterityPool);
        }

        if (percentPool.length > 0) {
            if (normPool.length > 0) {
                const totalPercent = percentPool.reduce((sum, [, weight]) => sum + weight, 0);
                percentPool.push([null, Math.max(0, 100 - totalPercent)]);
            }
            const selected = rng.choiceUsingWeightPair(percentPool);
            if (selected !== null) {
                return selected;
            }
        }

        if (normPool.length > 0) {
            return rng.choiceUsingWeightPair(normPool);
        }
        return null;
    }

    /**
     * 전투 특기 선택 통합 로직
     */
    static pickWarTrait(
        rng: RandUtil,
        stats: { leadership: number; strength: number; intelligence: number },
        dex: number[],
        traits: TraitModule[],
        prevTraitKeys: string[],
        scenarioStat: ScenarioStatBlock
    ): string | null {
        const myCond =
            this.calcCondGeneric(stats, scenarioStat) |
            this.calcCondDexterity(rng, dex) |
            TraitRequirement.REQ_DEXTERITY;
        const selected = this.pickTraitOnce(rng, myCond, traits, prevTraitKeys, true);
        if (selected !== null) {
            return selected;
        }
        if (prevTraitKeys.length > 0) {
            return this.pickWarTrait(rng, stats, dex, traits, [], scenarioStat);
        }
        return null;
    }

    /**
     * 내정 특기 선택 통합 로직
     */
    static pickDomesticTrait(
        rng: RandUtil,
        stats: { leadership: number; strength: number; intelligence: number },
        traits: TraitModule[],
        prevTraitKeys: string[],
        scenarioStat: ScenarioStatBlock
    ): string | null {
        const myCond = this.calcCondGeneric(stats, scenarioStat);
        const selected = this.pickTraitOnce(rng, myCond, traits, prevTraitKeys, false);
        if (selected !== null) {
            return selected;
        }
        if (prevTraitKeys.length > 0) {
            return this.pickDomesticTrait(rng, stats, traits, [], scenarioStat);
        }
        return null;
    }
}
