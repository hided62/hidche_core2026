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
        if (leadership < chiefMin || strength < chiefMin || intelligence < chiefMin) {
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
        const dexProb = Math.sqrt(dexSum) / 4;

        // Legacy: 80% 확률로 0 반환 (이전 연도에 이미 얻었거나 기타 이유로 제한하는 인지)
        // 실제로는 pickSpecialWar에서 이 메서드 호출 전후에 별도 확률을 둘 수도 있으나,
        // Legacy SpecialityHelper.php의 로직을 그대로 따름.
        if (rng.nextBool(0.8)) {
            return 0;
        }

        if (rng.nextRangeInt(0, 99) < dexProb) {
            return 0;
        }

        if (dexSum === 0) {
            return Number(rng.choice(Object.keys(dexMap)));
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
    static pickTrait(rng: RandUtil, myCond: number, traits: TraitModule[], prevTraitKeys: string[]): string | null {
        const normPool: Record<string, number> = {};
        const percentPool: { key: string; weight: number }[] = [];

        for (const trait of traits) {
            if (!trait.selection) continue;
            if (prevTraitKeys.includes(trait.key)) continue;

            let valid = false;
            for (const req of trait.selection.requirements) {
                if (req === (req & myCond)) {
                    valid = true;
                    break;
                }
            }

            if (!valid) continue;

            if (trait.selection.weightType === TraitWeightType.PERCENT) {
                percentPool.push({ key: trait.key, weight: trait.selection.weight });
            } else {
                normPool[trait.key] = trait.selection.weight;
            }
        }

        // PERCENT 타입 특기 먼저 우선권 확인
        for (const item of percentPool) {
            if (rng.nextBool(item.weight / 100)) {
                return item.key;
            }
        }

        // NORM 타입 특기들 중 가중치 기반 선택
        if (Object.keys(normPool).length === 0) return null;

        return String(rng.choiceUsingWeight(normPool));
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
        let myCond = this.calcCondGeneric(stats, scenarioStat);
        const dexCond = this.calcCondDexterity(rng, dex);
        if (dexCond) {
            myCond |= dexCond | TraitRequirement.REQ_DEXTERITY;
        }

        return this.pickTrait(rng, myCond, traits, prevTraitKeys);
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
        return this.pickTrait(rng, myCond, traits, prevTraitKeys);
    }
}
