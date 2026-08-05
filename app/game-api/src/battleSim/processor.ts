import crypto from 'node:crypto';

import type { RandUtil } from '@sammo-ts/common';
import {
    formatLogText,
    getTechCost,
    LogCategory,
    LogFormat,
    LogScope,
    resolveDefenderOrder,
    resolveWarBattle,
    createItemActionModules,
    createItemModuleRegistry,
    createRefOrderedActionStack,
    createScenarioEffectActionModules,
    ITEM_KEYS,
    loadItemModules,
    createInheritBuffModules,
    createTraitCatalog,
    createOfficerLevelActionModules,
    DOMESTIC_TRAIT_KEYS,
    EVENT_DOMESTIC_TRAIT_KEYS,
    loadDomesticTraitModules,
    loadEventDomesticTraitModules,
    loadNationTraitModules,
    loadPersonalityTraitModules,
    loadWarTraitModules,
    NATION_TRAIT_KEYS,
    PERSONALITY_TRAIT_KEYS,
    TraitWarActionRouter,
    WAR_TRAIT_KEYS,
    compileCrewTypeCatalog,
    createCrewTypeWarTriggerRegistry,
    type City,
    type General,
    type Nation,
    type RefOrderedActionStack,
    type UnitSetDefinition,
    type WarBattleOutcome,
    type WarActionModule,
    type WarUnitReport,
    type WarBattleTraceEvent,
    type CrewTypeDefinition,
} from '@sammo-ts/logic';

import { type BattleSimJobPayload, type BattleSimLogBuckets, type BattleSimResultPayload } from './types.js';
import { convertLog } from './logFormatter.js';

const DEFAULT_GENERAL_AGE = 20;

const inheritBuffModules = createInheritBuffModules();
const itemWarModules: WarActionModule[] = createItemActionModules(
    createItemModuleRegistry(await loadItemModules([...ITEM_KEYS]))
).war;
const crewTypeWarTriggerRegistry = createCrewTypeWarTriggerRegistry();
const traitCatalog = createTraitCatalog({
    domestic: [
        ...(await loadDomesticTraitModules([...DOMESTIC_TRAIT_KEYS])),
        ...(await loadEventDomesticTraitModules([...EVENT_DOMESTIC_TRAIT_KEYS])),
    ],
    war: await loadWarTraitModules([...WAR_TRAIT_KEYS]),
    personality: await loadPersonalityTraitModules([...PERSONALITY_TRAIT_KEYS]),
    nation: await loadNationTraitModules([...NATION_TRAIT_KEYS]),
});
const nationWarModule = new TraitWarActionRouter('nation', traitCatalog);
const officerWarModule = createOfficerLevelActionModules().war;
const domesticWarModule = new TraitWarActionRouter('domestic', traitCatalog);
const warTraitModule = new TraitWarActionRouter('war', traitCatalog);
const personalityWarModule = new TraitWarActionRouter('personality', traitCatalog);

const buildWarActionModules = (
    unitSet: UnitSetDefinition,
    scenarioEffect?: string | null
): RefOrderedActionStack<WarActionModule> => {
    const crewTypeCatalog = compileCrewTypeCatalog(unitSet, crewTypeWarTriggerRegistry);
    const scenario = createScenarioEffectActionModules(scenarioEffect);
    return createRefOrderedActionStack<WarActionModule>({
        nation: nationWarModule,
        officer: officerWarModule,
        domestic: domesticWarModule,
        war: warTraitModule,
        personality: personalityWarModule,
        crewType: crewTypeCatalog.warActionModule,
        inheritance: inheritBuffModules.war,
        scenario: scenario.war,
        items: itemWarModules,
    });
};

const normalizeItemCode = (value: string | null): string | null => (value === 'None' ? null : value);

const mapNationPayload = (payload: BattleSimJobPayload['attackerNation']): Nation => ({
    id: payload.nation,
    name: payload.name,
    color: '#000000',
    capitalCityId: payload.capital,
    chiefGeneralId: null,
    gold: payload.gold,
    rice: payload.rice,
    power: 0,
    level: payload.level,
    typeCode: payload.type,
    meta: {
        tech: payload.tech,
        gennum: payload.gennum,
    },
});

const mapCityPayload = (payload: BattleSimJobPayload['attackerCity']): City => ({
    id: payload.city,
    name: payload.name,
    nationId: payload.nation,
    level: payload.level,
    state: payload.state,
    population: payload.pop,
    populationMax: payload.pop_max,
    agriculture: payload.agri,
    agricultureMax: payload.agri_max,
    commerce: payload.comm,
    commerceMax: payload.comm_max,
    security: payload.secu,
    securityMax: payload.secu_max,
    supplyState: payload.supply,
    frontState: payload.state,
    defence: payload.def,
    defenceMax: payload.def_max,
    wall: payload.wall,
    wallMax: payload.wall_max,
    meta: {
        trust: payload.trust,
        dead: payload.dead,
        conflict: payload.conflict,
        supply: payload.supply,
    },
});

const mapGeneralPayload = (
    payload: BattleSimJobPayload['attackerGeneral'],
    currentCityId: number
): General => ({
    id: payload.no,
    name: payload.name,
    nationId: payload.nation,
    cityId: payload.city ?? currentCityId,
    troopId: 0,
    stats: {
        leadership: payload.leadership,
        strength: payload.strength,
        intelligence: payload.intel,
    },
    experience: payload.experience,
    dedication: payload.dedication,
    officerLevel: payload.officer_level,
    role: {
        personality: payload.personal,
        specialDomestic: payload.special ?? null,
        specialWar: payload.special2,
        items: {
            horse: normalizeItemCode(payload.horse),
            weapon: normalizeItemCode(payload.weapon),
            book: normalizeItemCode(payload.book),
            item: normalizeItemCode(payload.item),
        },
    },
    injury: payload.injury,
    gold: payload.gold,
    rice: payload.rice,
    crew: payload.crew,
    crewTypeId: payload.crewtype,
    train: payload.train,
    atmos: payload.atmos,
    age: DEFAULT_GENERAL_AGE,
    npcState: 0,
    triggerState: {
        flags: {},
        counters: {},
        modifiers: {},
        meta: payload.inheritBuff ? { inheritBuff: JSON.stringify(payload.inheritBuff) } : {},
    },
    meta: {
        killturn: 24,
        explevel: payload.explevel,
        turnTime: payload.turntime,
        recentWar: payload.recent_war ?? '',
        dex1: payload.dex1,
        dex2: payload.dex2,
        dex3: payload.dex3,
        dex4: payload.dex4,
        dex5: payload.dex5,
        intel_exp: payload.intel_exp,
        strength_exp: payload.strength_exp,
        leadership_exp: payload.leadership_exp,
        defence_train: payload.defence_train,
        officerCity: payload.officer_city,
        officer_city: payload.officer_city,
        rank_warnum: payload.warnum,
        rank_killnum: payload.killnum,
        rank_killcrew: payload.killcrew,
    },
});

const buildLogBuckets = (options: {
    logs: WarBattleOutcome['logs'];
    year: number;
    month: number;
    attackerId: number;
    attackerNationId: number;
}): BattleSimLogBuckets => {
    const buckets = {
        generalHistoryLog: [] as string[],
        generalActionLog: [] as string[],
        generalBattleResultLog: [] as string[],
        generalBattleDetailLog: [] as string[],
        nationalHistoryLog: [] as string[],
        globalHistoryLog: [] as string[],
        globalActionLog: [] as string[],
    };

    for (const entry of options.logs) {
        const format = entry.format ?? LogFormat.RAWTEXT;
        const text = formatLogText(entry.text, format, options.year, options.month);

        if (entry.scope === LogScope.GENERAL && entry.generalId === options.attackerId) {
            switch (entry.category) {
                case LogCategory.HISTORY:
                    buckets.generalHistoryLog.push(text);
                    break;
                case LogCategory.ACTION:
                    buckets.generalActionLog.push(text);
                    break;
                case LogCategory.BATTLE_BRIEF:
                    buckets.generalBattleResultLog.push(text);
                    break;
                case LogCategory.BATTLE_DETAIL:
                    buckets.generalBattleDetailLog.push(text);
                    break;
                default:
                    break;
            }
            continue;
        }

        if (
            entry.scope === LogScope.NATION &&
            entry.nationId === options.attackerNationId &&
            entry.category === LogCategory.HISTORY
        ) {
            buckets.nationalHistoryLog.push(text);
            continue;
        }

        if (entry.scope === LogScope.SYSTEM) {
            if (entry.category === LogCategory.HISTORY) {
                buckets.globalHistoryLog.push(text);
            } else if (entry.category === LogCategory.SUMMARY) {
                buckets.globalActionLog.push(text);
            }
        }
    }

    return {
        generalHistoryLog: convertLog(buckets.generalHistoryLog.join('<br>')),
        generalActionLog: convertLog(buckets.generalActionLog.join('<br>')),
        generalBattleResultLog: convertLog(buckets.generalBattleResultLog.join('<br>')),
        generalBattleDetailLog: convertLog(buckets.generalBattleDetailLog.join('<br>')),
        nationalHistoryLog: convertLog(buckets.nationalHistoryLog.join('<br>')),
        globalHistoryLog: convertLog(buckets.globalHistoryLog.join('<br>')),
        globalActionLog: convertLog(buckets.globalActionLog.join('<br>')),
    };
};

const resolveRandomSeed = (): string => crypto.randomUUID();

const resolveCityTrainAtmos = (year: number, startYear: number): number =>
    Math.min(110, Math.max(60, year - startYear + 59));

const resolveCityRiceConsumption = (options: {
    battle: WarBattleOutcome;
    defenderNation: Nation;
    unitSet: UnitSetDefinition;
    castleCrewTypeId: number;
    year: number;
    startYear: number;
}): number => {
    const cityReport = options.battle.reports.find((report: WarUnitReport) => report.type === 'city');
    if (!cityReport) {
        return 0;
    }
    if (cityReport.killed <= 0 && cityReport.dead <= 0) {
        return 0;
    }

    const crewType = options.unitSet.crewTypes?.find(
        (item: CrewTypeDefinition) => item.id === options.castleCrewTypeId
    );
    const riceCoef = crewType?.rice ?? 1;
    const tech = Number(options.defenderNation.meta.tech ?? 0);
    const trainAtmos = resolveCityTrainAtmos(options.year, options.startYear);

    let rice = (cityReport.killed / 100) * 0.8;
    rice *= riceCoef;
    rice *= getTechCost(tech);
    rice *= trainAtmos / 100 - 0.2;
    return Math.round(rice);
};

const resolveDefenderOrderPayload = (payload: BattleSimJobPayload): number[] => {
    const attackerNation = mapNationPayload(payload.attackerNation);
    const defenderNation = mapNationPayload(payload.defenderNation);
    const attackerCity = mapCityPayload(payload.attackerCity);
    const defenderCity = mapCityPayload(payload.defenderCity);
    const attacker = mapGeneralPayload(payload.attackerGeneral, attackerCity.id);
    const defenders = payload.defenderGenerals.map((general) => mapGeneralPayload(general, defenderCity.id));
    const warActionModules = buildWarActionModules(payload.unitSet, payload.scenarioEffect);

    return resolveDefenderOrder({
        unitSet: payload.unitSet,
        config: payload.config,
        time: payload.time,
        seed: 'order',
        attacker: {
            general: attacker,
            city: attackerCity,
            nation: attackerNation,
            modules: warActionModules,
        },
        defenders: defenders.map((general) => ({
            general,
            city: defenderCity,
            nation: defenderNation,
            modules: warActionModules,
        })),
        defenderCity,
        defenderNation,
    });
};

export interface BattleSimProcessorOptions {
    trace?: (event: WarBattleTraceEvent) => void;
    rngFactory?: (seed: string) => RandUtil;
}

export const processBattleSimJob = (
    payload: BattleSimJobPayload,
    options: BattleSimProcessorOptions = {}
): BattleSimResultPayload => {
    if (payload.action === 'reorder') {
        return {
            result: true,
            reason: 'success',
            order: resolveDefenderOrderPayload(payload),
        };
    }

    let repeatCnt = payload.repeatCnt;
    const warActionModules = buildWarActionModules(payload.unitSet, payload.scenarioEffect);
    const baseSeed = payload.seed ?? '';
    if (baseSeed) {
        repeatCnt = 1;
    }

    let lastBattle: WarBattleOutcome | null = null;
    let attackerKilled = 0;
    let attackerDead = 0;
    let attackerMaxKilled = 0;
    let attackerMinKilled = Number.POSITIVE_INFINITY;
    let attackerMaxDead = 0;
    let attackerMinDead = Number.POSITIVE_INFINITY;
    let attackerAvgRice = 0;
    let defenderAvgRice = 0;
    let avgPhase = 0;
    let avgWar = 0;
    const attackerSkills: Record<string, number> = {};
    const defendersSkills: Array<Record<string, number>> = [];

    const weight = 1 / Math.max(1, repeatCnt);

    for (let idx = 0; idx < repeatCnt; idx += 1) {
        const seed = idx === 0 ? baseSeed || resolveRandomSeed() : resolveRandomSeed();
        const attackerNation = mapNationPayload(payload.attackerNation);
        const defenderNation = mapNationPayload(payload.defenderNation);
        const attackerCity = mapCityPayload(payload.attackerCity);
        const defenderCity = mapCityPayload(payload.defenderCity);
        const attackerGeneral = mapGeneralPayload(payload.attackerGeneral, attackerCity.id);
        const defenderGenerals = payload.defenderGenerals.map((general) =>
            mapGeneralPayload(general, defenderCity.id)
        );

        const initialRice = new Map<number, number>();
        initialRice.set(attackerGeneral.id, attackerGeneral.rice);
        for (const defender of defenderGenerals) {
            initialRice.set(defender.id, defender.rice);
        }

        const outcome = resolveWarBattle({
            seed,
            rng: options.rngFactory?.(seed),
            unitSet: payload.unitSet,
            config: payload.config,
            time: payload.time,
            attacker: {
                general: attackerGeneral,
                city: attackerCity,
                nation: attackerNation,
                modules: warActionModules,
            },
            defenders: defenderGenerals.map((general) => ({
                general,
                city: defenderCity,
                nation: defenderNation,
                modules: warActionModules,
            })),
            defenderCity,
            defenderNation,
            trace: options.trace,
        });

        lastBattle = outcome;
        const attackerReport = outcome.reports.find(
            (report: WarUnitReport) => report.type === 'general' && report.isAttacker
        );
        const killed = attackerReport?.killed ?? 0;
        const dead = attackerReport?.dead ?? 0;

        attackerKilled += killed * weight;
        attackerDead += dead * weight;
        attackerMaxKilled = Math.max(attackerMaxKilled, killed);
        attackerMinKilled = Math.min(attackerMinKilled, killed);
        attackerMaxDead = Math.max(attackerMaxDead, dead);
        attackerMinDead = Math.min(attackerMinDead, dead);

        const phase = outcome.metrics?.attackerPhase ?? 0;
        avgPhase += phase * weight;
        const defenderCount = outcome.metrics?.defenderActivatedSkills.length ?? 0;
        avgWar += defenderCount * weight;

        const attackerRiceInit = initialRice.get(attackerGeneral.id) ?? attackerGeneral.rice;
        attackerAvgRice += (attackerRiceInit - outcome.attacker.rice) * weight;

        let defenderRiceInit = 0;
        let defenderRiceAfter = 0;
        for (const defender of outcome.defenders) {
            defenderRiceInit += initialRice.get(defender.id) ?? defender.rice;
            defenderRiceAfter += defender.rice;
        }

        const cityRice = resolveCityRiceConsumption({
            battle: outcome,
            defenderNation,
            unitSet: payload.unitSet,
            castleCrewTypeId: payload.config.castleCrewTypeId,
            year: payload.time.year,
            startYear: payload.time.startYear,
        });
        defenderAvgRice += (defenderRiceInit - defenderRiceAfter + cityRice) * weight;

        const attackerActivated = outcome.metrics?.attackerActivatedSkills ?? {};
        for (const [skillName, value] of Object.entries(attackerActivated) as [string, number][]) {
            attackerSkills[skillName] = (attackerSkills[skillName] ?? 0) + value * weight;
        }

        const defenderActivated = outcome.metrics?.defenderActivatedSkills ?? [];
        for (let defIdx = 0; defIdx < defenderActivated.length; defIdx += 1) {
            while (defIdx >= defendersSkills.length) {
                defendersSkills.push({});
            }
            const bucket = defendersSkills[defIdx]!;
            for (const [skillName, value] of Object.entries(defenderActivated[defIdx]!) as [string, number][]) {
                bucket[skillName] = (bucket[skillName] ?? 0) + value * weight;
            }
        }
    }

    if (!lastBattle) {
        return {
            result: false,
            reason: '전투 결과를 생성하지 못했습니다.',
        };
    }

    const logBuckets = buildLogBuckets({
        logs: lastBattle.logs,
        year: payload.time.year,
        month: payload.time.month,
        attackerId: lastBattle.attacker.id,
        attackerNationId: payload.attackerNation.nation,
    });

    return {
        result: true,
        reason: 'success',
        datetime: payload.attackerGeneral.turntime,
        lastWarLog: logBuckets,
        avgWar,
        phase: avgPhase,
        killed: attackerKilled,
        maxKilled: attackerMaxKilled,
        minKilled: attackerMinKilled === Number.POSITIVE_INFINITY ? 0 : attackerMinKilled,
        dead: attackerDead,
        maxDead: attackerMaxDead,
        minDead: attackerMinDead === Number.POSITIVE_INFINITY ? 0 : attackerMinDead,
        attackerRice: attackerAvgRice,
        defenderRice: defenderAvgRice,
        attackerSkills,
        defendersSkills,
    };
};
