import type { AutorunGeneralPolicy, AutorunNationPolicy } from '../policies.js';

/** 이미 합성된 정책만 복사한다. can() 재평가, world/meta 복사나 RNG 호출은 하지 않는다. */
export const snapshotEffectiveAiPolicy = (general: AutorunGeneralPolicy, nation: AutorunNationPolicy) => ({
    schemaVersion: 1 as const,
    general: { priority: [...general.priority], flags: { ...general.flags } },
    nation: {
        priority: [...nation.priority],
        flags: { ...nation.flags },
        values: {
            reqNationGold: nation.reqNationGold,
            reqNationRice: nation.reqNationRice,
            reqHumanWarUrgentGold: nation.reqHumanWarUrgentGold,
            reqHumanWarUrgentRice: nation.reqHumanWarUrgentRice,
            reqHumanWarRecommandGold: nation.reqHumanWarRecommandGold,
            reqHumanWarRecommandRice: nation.reqHumanWarRecommandRice,
            reqHumanDevelGold: nation.reqHumanDevelGold,
            reqHumanDevelRice: nation.reqHumanDevelRice,
            reqNpcWarGold: nation.reqNpcWarGold,
            reqNpcWarRice: nation.reqNpcWarRice,
            reqNpcDevelGold: nation.reqNpcDevelGold,
            reqNpcDevelRice: nation.reqNpcDevelRice,
            minimumResourceActionAmount: nation.minimumResourceActionAmount,
            maximumResourceActionAmount: nation.maximumResourceActionAmount,
            minNpcWarLeadership: nation.minNpcWarLeadership,
            minWarCrew: nation.minWarCrew,
            minNpcRecruitCityPopulation: nation.minNpcRecruitCityPopulation,
            safeRecruitCityPopulationRatio: nation.safeRecruitCityPopulationRatio,
            properWarTrainAtmos: nation.properWarTrainAtmos,
            cureThreshold: nation.cureThreshold,
        },
        combatForce: Object.fromEntries(Object.entries(nation.combatForce).map(([id, cities]) => [id, [...cities]])),
        supportForce: [...nation.supportForce],
        developForce: [...nation.developForce],
    },
});
export type EffectiveAiPolicy = ReturnType<typeof snapshotEffectiveAiPolicy>;
