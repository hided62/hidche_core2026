import { asNumber } from '@sammo-ts/common';
import type { City, Nation } from '@sammo-ts/logic';

import { resolveAppliedNationRate } from '../turn/nationTaxRate.js';
import type { TurnGeneral } from '../turn/types.js';

export const AUDIT_DEX_KEYS = ['dex1', 'dex2', 'dex3', 'dex4', 'dex5'] as const;
export type AuditDex = Record<(typeof AUDIT_DEX_KEYS)[number], number>;
export type AuditPopulation = 'human' | 'npc' | 'troopNpc';

export interface AuditPopulationSummary {
    count: number;
    crew: number;
    gold: number;
    rice: number;
    dex: AuditDex;
    averageGold: number | null;
    averageRice: number | null;
    averageDex: Record<keyof AuditDex, number | null>;
}

/** 정산 처리에서 관측한 값만 전달한다. prev_income_*는 이번 달 흐름이 아니다. */
export interface AuditSettlement {
    nationId: number;
    resource: 'gold' | 'rice';
    income: number;
    paid: number;
}

export interface AuditNationSnapshot {
    id: number;
    name: string;
    color: string;
    gold: number;
    rice: number;
    tech: number;
    appliedRate: number;
    incomeGold: number | null;
    incomeRice: number | null;
    paidGold: number | null;
    paidRice: number | null;
    populations: Record<AuditPopulation, AuditPopulationSummary>;
}

const emptyDex = (): AuditDex => ({ dex1: 0, dex2: 0, dex3: 0, dex4: 0, dex5: 0 });
const emptyPopulation = (): AuditPopulationSummary => ({
    count: 0,
    crew: 0,
    gold: 0,
    rice: 0,
    dex: emptyDex(),
    averageGold: null,
    averageRice: null,
    averageDex: { dex1: null, dex2: null, dex3: null, dex4: null, dex5: null },
});

export const classifyAuditPopulation = (npcState: number): AuditPopulation =>
    npcState === 5 ? 'troopNpc' : npcState < 2 ? 'human' : 'npc';

export interface AuditGeneralSnapshot extends Pick<
    TurnGeneral,
    | 'id'
    | 'name'
    | 'nationId'
    | 'cityId'
    | 'troopId'
    | 'npcState'
    | 'gold'
    | 'rice'
    | 'stats'
    | 'experience'
    | 'dedication'
    | 'officerLevel'
    | 'injury'
    | 'age'
    | 'crew'
    | 'crewTypeId'
    | 'train'
    | 'atmos'
    | 'role'
> {
    userId: string | null;
    population: AuditPopulation;
    dex: AuditDex;
}

export const projectAuditGeneral = (general: TurnGeneral): AuditGeneralSnapshot => ({
    id: general.id,
    name: general.name,
    userId: general.userId ?? null,
    nationId: general.nationId,
    cityId: general.cityId,
    troopId: general.troopId,
    npcState: general.npcState,
    population: classifyAuditPopulation(general.npcState),
    gold: general.gold,
    rice: general.rice,
    stats: { ...general.stats },
    experience: general.experience,
    dedication: general.dedication,
    officerLevel: general.officerLevel,
    injury: general.injury,
    age: general.age,
    crew: general.crew,
    crewTypeId: general.crewTypeId,
    train: general.train,
    atmos: general.atmos,
    role: { ...general.role, items: { ...general.role.items } },
    dex: {
        dex1: asNumber(general.meta.dex1, 0),
        dex2: asNumber(general.meta.dex2, 0),
        dex3: asNumber(general.meta.dex3, 0),
        dex4: asNumber(general.meta.dex4, 0),
        dex5: asNumber(general.meta.dex5, 0),
    },
});

export interface AuditCitySnapshot extends Omit<City, 'meta' | 'conflict'> {
    trust: number;
}

export const projectAuditCity = (city: City): AuditCitySnapshot => ({
    id: city.id,
    name: city.name,
    nationId: city.nationId,
    level: city.level,
    state: city.state,
    population: city.population,
    populationMax: city.populationMax,
    agriculture: city.agriculture,
    agricultureMax: city.agricultureMax,
    commerce: city.commerce,
    commerceMax: city.commerceMax,
    security: city.security,
    securityMax: city.securityMax,
    wall: city.wall,
    wallMax: city.wallMax,
    defence: city.defence,
    defenceMax: city.defenceMax,
    supplyState: city.supplyState,
    frontState: city.frontState,
    trust: asNumber(city.meta.trust, 50),
});

/** 이미 로드한 world를 한 번씩 순회한다. DB/RNG/가변 world 객체는 보관하지 않는다. */
export const buildAuditSnapshot = (input: {
    nations: Iterable<Nation>;
    cities: Iterable<City>;
    generals: Iterable<TurnGeneral>;
    settlements: Iterable<AuditSettlement>;
    settlementsComplete: boolean;
}): { nations: AuditNationSnapshot[]; cities: AuditCitySnapshot[]; generals: AuditGeneralSnapshot[] } => {
    const nations = new Map<number, AuditNationSnapshot>();
    for (const nation of input.nations) {
        const flow = input.settlementsComplete ? 0 : null;
        nations.set(nation.id, {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            gold: nation.gold,
            rice: nation.rice,
            tech: asNumber(nation.meta.tech, 0),
            appliedRate: resolveAppliedNationRate(nation.meta),
            incomeGold: flow,
            incomeRice: flow,
            paidGold: flow,
            paidRice: flow,
            populations: { human: emptyPopulation(), npc: emptyPopulation(), troopNpc: emptyPopulation() },
        });
    }
    const generals: AuditGeneralSnapshot[] = [];
    for (const general of input.generals) {
        const projected = projectAuditGeneral(general);
        generals.push(projected);
        const population = nations.get(general.nationId)?.populations[projected.population];
        if (!population) continue;
        population.count++;
        population.crew += projected.crew;
        population.gold += projected.gold;
        population.rice += projected.rice;
        for (const key of AUDIT_DEX_KEYS) population.dex[key] += projected.dex[key];
    }
    for (const nation of nations.values()) {
        for (const population of Object.values(nation.populations)) {
            if (!population.count) continue;
            population.averageGold = population.gold / population.count;
            population.averageRice = population.rice / population.count;
            for (const key of AUDIT_DEX_KEYS) population.averageDex[key] = population.dex[key] / population.count;
        }
    }
    for (const settlement of input.settlements) {
        const nation = nations.get(settlement.nationId);
        if (!nation || !input.settlementsComplete) continue;
        if (settlement.resource === 'gold') {
            nation.incomeGold = (nation.incomeGold ?? 0) + settlement.income;
            nation.paidGold = (nation.paidGold ?? 0) + settlement.paid;
        } else {
            nation.incomeRice = (nation.incomeRice ?? 0) + settlement.income;
            nation.paidRice = (nation.paidRice ?? 0) + settlement.paid;
        }
    }
    return { nations: [...nations.values()], cities: Array.from(input.cities, projectAuditCity), generals };
};
