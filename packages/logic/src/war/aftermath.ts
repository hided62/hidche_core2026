import { JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import { LogFormat, type LogEntryDraft } from '@sammo-ts/logic/logging/types.js';
import { buildCrewTypeIndex, getTechCost, getTechLevel } from '@sammo-ts/logic/world/unitSet.js';
import type { WarUnitReport } from './types.js';
import type {
    ConquerCityOutcome,
    WarAftermathConfig,
    WarAftermathInput,
    WarAftermathOutcome,
    WarAftermathTechContext,
    WarDiplomacyDelta,
} from './types.js';
import { clamp, clampMin, getMetaNumber, round, simpleSerialize } from './utils.js';

const META_DEAD = 'dead';
const META_CONFLICT = 'conflict';

const findReport = (reports: WarUnitReport[], predicate: (report: WarUnitReport) => boolean): WarUnitReport | null => {
    for (const report of reports) {
        if (predicate(report)) {
            return report;
        }
    }
    return null;
};

const getDeadCounter = (city: City): number => getMetaNumber(city.meta, META_DEAD, 0);

const setDeadCounter = (city: City, value: number): void => {
    city.meta[META_DEAD] = round(value);
};

const isSupplyCity = (city: City): boolean => {
    const raw = city.meta.supply;
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (typeof raw === 'number') {
        return raw > 0;
    }
    return city.supplyState > 0;
};

const resolveCityTrainAtmos = (year: number, startYear: number): number => clamp(year - startYear + 59, 60, 110);

const isTechLimited = (tech: number, year: number, startYear: number, config: WarAftermathConfig): boolean => {
    const relYear = clampMin(year - startYear, 0);
    const relMaxTech = clamp(
        Math.floor(relYear / config.techLevelIncYear) + config.initialAllowedTechLevel,
        1,
        config.maxTechLevel
    );
    const techLevel = getTechLevel(tech, config.maxTechLevel);
    return techLevel >= relMaxTech;
};

const resolveNationGenCount = <TriggerState extends GeneralTriggerState>(
    nation: Nation,
    generals: General<TriggerState>[],
    config: WarAftermathConfig
): { total: number; effective: number } => {
    const fallback = generals.filter((general) => general.nationId === nation.id).length;
    let total = getMetaNumber(nation.meta, 'gennum', fallback);
    let effective = generals.filter((general) => general.nationId === nation.id && general.npcState !== 5).length;

    if (effective < config.initialNationGenLimit) {
        total = config.initialNationGenLimit;
        effective = config.initialNationGenLimit;
    }

    return { total, effective };
};

const applyNationTechGain = <TriggerState extends GeneralTriggerState>(
    nation: Nation,
    baseGain: number,
    input: WarAftermathInput<TriggerState>,
    context: WarAftermathTechContext
): void => {
    const config = input.config;
    let gain = baseGain;

    if (input.calcNationTechGain) {
        gain = input.calcNationTechGain({
            ...context,
            baseGain: gain,
        });
    }

    const { total, effective } = resolveNationGenCount(nation, input.generals, config);

    if (total !== effective) {
        gain *= total / effective;
    }

    if (isTechLimited(getMetaNumber(nation.meta, 'tech', 0), input.time.year, input.time.startYear, config)) {
        gain /= 4;
    }

    const divisor = Math.max(config.initialNationGenLimit, total);
    const tech = getMetaNumber(nation.meta, 'tech', 0) + gain / divisor;
    nation.meta.tech = round(tech);
};

const resolveConquerNation = (city: City, attackerNationId: number): number => {
    const rawConflict = city.meta[META_CONFLICT];
    if (!rawConflict) {
        return attackerNationId;
    }
    try {
        const parsed = JSON.parse(String(rawConflict)) as Record<string, number>;
        const entries = Object.entries(parsed)
            .map(([key, value]) => [Number(key), value] as const)
            .filter(([key, value]) => Number.isFinite(key) && typeof value === 'number')
            .sort(([, lhs], [, rhs]) => rhs - lhs);
        if (!entries.length) {
            return attackerNationId;
        }
        return entries[0]![0];
    } catch {
        return attackerNationId;
    }
};

const getCityPosition = (city: City): { x: number; y: number } | null => {
    const x = getMetaNumber(city.meta, 'positionX', Number.NaN);
    const y = getMetaNumber(city.meta, 'positionY', Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }
    return { x, y };
};

const findNextCapital = (
    cities: City[],
    defenderNationId: number,
    capturedCityId: number,
    oldCapital: City
): City | null => {
    const candidates = cities.filter((city) => city.nationId === defenderNationId && city.id !== capturedCityId);
    if (!candidates.length) {
        return null;
    }

    const oldPos = getCityPosition(oldCapital);
    if (!oldPos) {
        return candidates.sort((lhs, rhs) => rhs.population - lhs.population)[0]!;
    }

    return candidates
        .map((city) => {
            const pos = getCityPosition(city);
            const distance = pos ? Math.hypot(pos.x - oldPos.x, pos.y - oldPos.y) : Number.MAX_SAFE_INTEGER;
            return { city, distance };
        })
        .sort((lhs, rhs) => {
            if (lhs.distance !== rhs.distance) {
                return lhs.distance - rhs.distance;
            }
            return rhs.city.population - lhs.city.population;
        })[0]!.city;
};

const pushLoggers = (loggers: ActionLogger[], logs: LogEntryDraft[]): void => {
    for (const logger of loggers) {
        logs.push(...logger.flush());
    }
};

// 도시 점령 이후의 국가 붕괴/수도 이동/도시 리셋 처리.
const resolveConquerCity = <TriggerState extends GeneralTriggerState>(
    input: WarAftermathInput<TriggerState>,
    rng: RandUtil
): ConquerCityOutcome<TriggerState> => {
    const { attackerNation, defenderNation, defenderCity, cities, generals, config } = input;
    const attacker = input.battle.attacker;

    const logs: LogEntryDraft[] = [];
    const affectedCities = new Set<City>();
    const affectedGenerals = new Set<General<TriggerState>>();
    const affectedNations = new Set<Nation>();

    const conquerNationId = resolveConquerNation(defenderCity, attackerNation.id);
    const attackerLogger = new ActionLogger({
        generalId: attacker.id,
        nationId: attackerNation.id,
    });

    const defenderNationId = defenderNation?.id ?? 0;
    const defenderNationName = defenderNation?.name ?? '공백지';
    const defenderNationDecoration = defenderNationId ? `<D><b>${defenderNationName}</b></>의` : '공백지인';

    const attackerNationName = attackerNation.name;
    const attackerGeneralName = attacker.name;
    const cityName = defenderCity.name;

    const josaUl = JosaUtil.pick(cityName, '을');
    const josaYiNation = JosaUtil.pick(attackerNationName, '이');
    const josaYiGen = JosaUtil.pick(attackerGeneralName, '이');
    const josaYiCity = JosaUtil.pick(cityName, '이');

    attackerLogger.pushGeneralActionLog(`<G><b>${cityName}</b></> 공략에 <S>성공</>했습니다.`, LogFormat.PLAIN);
    attackerLogger.pushGeneralHistoryLog(`<G><b>${cityName}</b></>${josaUl} <S>점령</>`);
    attackerLogger.pushGlobalActionLog(
        `<Y>${attackerGeneralName}</>${josaYiGen} <G><b>${cityName}</b></> 공략에 <S>성공</>했습니다.`
    );
    attackerLogger.pushGlobalHistoryLog(
        `<S><b>【지배】</b></><D><b>${attackerNationName}</b></>${josaYiNation} <G><b>${cityName}</b></>${josaUl} 지배했습니다.`
    );
    attackerLogger.pushNationHistoryLog(
        `<Y>${attackerGeneralName}</>${josaYiGen} ${defenderNationDecoration} <G><b>${cityName}</b></> ${josaUl} <S>점령</>`
    );

    if (defenderNationId) {
        const defenderNationLogger = new ActionLogger({ nationId: defenderNationId });
        defenderNationLogger.pushNationHistoryLog(
            `<D><b>${attackerNationName}</b></>의 <Y>${attackerGeneralName}</>에 의해 <G><b>${cityName}</b></>${josaYiCity} <O>함락</>`
        );
        pushLoggers([defenderNationLogger], logs);
    }

    const defenderCityCount = defenderNationId ? cities.filter((city) => city.nationId === defenderNationId).length : 0;
    const nationCollapsed = defenderNationId !== 0 && defenderCityCount === 1;

    let collapseRewardGold = 0;
    let collapseRewardRice = 0;

    // 국가 붕괴 시 자원 손실과 포상 정산.
    if (nationCollapsed && defenderNation) {
        const defenderGenerals = generals.filter((general) => general.nationId === defenderNationId);
        let totalGoldLoss = 0;
        let totalRiceLoss = 0;

        for (const general of defenderGenerals) {
            const loseGold = round(general.gold * rng.nextRange(0.2, 0.5));
            const loseRice = round(general.rice * rng.nextRange(0.2, 0.5));
            general.gold = clampMin(general.gold - loseGold, 0);
            general.rice = clampMin(general.rice - loseRice, 0);
            general.experience = round(general.experience * 0.9);
            general.dedication = round(general.dedication * 0.5);

            totalGoldLoss += loseGold;
            totalRiceLoss += loseRice;

            const generalLogger = new ActionLogger({
                generalId: general.id,
                nationId: general.nationId,
            });
            generalLogger.pushGeneralActionLog(
                `도주하며 금<C>${loseGold}</> 쌀<C>${loseRice}</>을 분실했습니다.`,
                LogFormat.PLAIN
            );
            pushLoggers([generalLogger], logs);
            affectedGenerals.add(general);
        }

        collapseRewardGold = Math.max(0, defenderNation.gold - config.baseGold) * 0.5 + totalGoldLoss * 0.5;
        collapseRewardRice = Math.max(0, defenderNation.rice - config.baseRice) * 0.5 + totalRiceLoss * 0.5;

        attackerNation.gold = round(attackerNation.gold + collapseRewardGold);
        attackerNation.rice = round(attackerNation.rice + collapseRewardRice);

        defenderNation.meta.collapsed = true;
        affectedNations.add(defenderNation);
        affectedNations.add(attackerNation);
    }

    // 수도 함락 시 수도 이전 및 내부 사기/자원 페널티.
    if (!nationCollapsed && defenderNation && defenderNation.capitalCityId === defenderCity.id) {
        const nextCapital = findNextCapital(cities, defenderNationId, defenderCity.id, defenderCity);
        if (nextCapital) {
            defenderNation.capitalCityId = nextCapital.id;
            defenderNation.gold = round(defenderNation.gold * 0.5);
            defenderNation.rice = round(defenderNation.rice * 0.5);

            nextCapital.supplyState = 1;
            affectedCities.add(nextCapital);

            for (const general of generals) {
                if (general.nationId !== defenderNationId) {
                    continue;
                }
                general.atmos = round(general.atmos * 0.8);
                if (general.officerLevel >= 5) {
                    general.cityId = nextCapital.id;
                }
                affectedGenerals.add(general);
            }

            affectedNations.add(defenderNation);
        }
    }

    const conquerNation =
        conquerNationId === attackerNation.id
            ? attackerNation
            : (input.nations.find((nation) => nation.id === conquerNationId) ?? attackerNation);

    if (conquerNationId === attackerNation.id) {
        attacker.cityId = defenderCity.id;
        affectedGenerals.add(attacker);
    } else {
        const conquerNationName = conquerNation.name;
        const conquerNationLogger = new ActionLogger({ nationId: conquerNationId });
        const josaUl = JosaUtil.pick(cityName, '을');
        const josaYi = JosaUtil.pick(conquerNationName, '이');

        attackerLogger.pushGlobalHistoryLog(
            `<Y><b>【분쟁협상】</b></><D><b>${conquerNationName}</b></>${josaYi} 영토분쟁에서 우위를 점하여 <G><b>${cityName}</b></>${josaUl} 양도받았습니다.`
        );
        conquerNationLogger.pushNationHistoryLog(
            `<D><b>${attackerNationName}</b></>에서 <G><b>${cityName}</b></>${josaUl} <S>양도</> 받음`
        );
        attackerLogger.pushNationHistoryLog(
            `<G><b>${cityName}</b></>${josaUl} <D><b>${conquerNationName}</b></>에 <Y>양도</>`
        );
        pushLoggers([conquerNationLogger], logs);
    }

    // 점령 후 도시 상태를 방어 기본 상태로 되돌린다.
    defenderCity.supplyState = 1;
    defenderCity.frontState = 0;
    defenderCity.agriculture = round(defenderCity.agriculture * 0.7);
    defenderCity.commerce = round(defenderCity.commerce * 0.7);
    defenderCity.security = round(defenderCity.security * 0.7);
    defenderCity.nationId = conquerNationId;
    defenderCity.meta[META_CONFLICT] = '{}';

    if (defenderCity.level > 3) {
        defenderCity.defence = config.defaultCityWall;
        defenderCity.wall = config.defaultCityWall;
    } else {
        defenderCity.defence = round(defenderCity.defenceMax / 2);
        defenderCity.wall = round(defenderCity.wallMax / 2);
    }

    affectedCities.add(defenderCity);
    affectedNations.add(conquerNation);

    pushLoggers([attackerLogger], logs);

    return {
        conquerNationId,
        nationCollapsed,
        collapseRewardGold: round(collapseRewardGold),
        collapseRewardRice: round(collapseRewardRice),
        logs,
        nations: Array.from(affectedNations),
        cities: Array.from(affectedCities),
        generals: Array.from(affectedGenerals),
    };
};

export const resolveWarAftermath = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    input: WarAftermathInput<TriggerState>
): WarAftermathOutcome<TriggerState> => {
    const logs: LogEntryDraft[] = [];
    const diplomacyDeltas: WarDiplomacyDelta[] = [];
    const affectedNations = new Set<Nation>();
    const affectedCities = new Set<City>();
    const affectedGenerals = new Set<General<TriggerState>>();

    const attackerReport = findReport(input.battle.reports, (report) => report.type === 'general' && report.isAttacker);
    const cityReport = findReport(input.battle.reports, (report) => report.type === 'city');

    const attackerKilled = attackerReport?.killed ?? 0;
    const attackerDead = attackerReport?.dead ?? 0;
    const totalDead = attackerKilled + attackerDead;

    // 전투 사망자 누적: 공격/수비 도시로 분배.
    if (totalDead > 0) {
        const attackerCityDead = getDeadCounter(input.attackerCity) + totalDead * 0.4;
        const defenderCityDead = getDeadCounter(input.defenderCity) + totalDead * 0.6;
        setDeadCounter(input.attackerCity, attackerCityDead);
        setDeadCounter(input.defenderCity, defenderCityDead);
        affectedCities.add(input.attackerCity);
        affectedCities.add(input.defenderCity);
    }

    // 수성 도시의 식량 소모/보상 처리.
    if (input.defenderNation && input.defenderNation.id !== 0 && isSupplyCity(input.defenderCity)) {
        const defenderNation = input.defenderNation;
        const cityKilled = cityReport?.killed ?? 0;

        if ((cityReport?.dead ?? 0) > 0) {
            const crewTypeIndex = buildCrewTypeIndex(input.unitSet);
            const crewType = crewTypeIndex.get(input.config.castleCrewTypeId);
            const riceCoef = crewType?.rice ?? 1;

            let rice = (cityKilled / 100) * 0.8;
            rice *= riceCoef;
            rice *= getTechCost(getMetaNumber(defenderNation.meta, 'tech', 0));
            rice *= resolveCityTrainAtmos(input.time.year, input.time.startYear) / 100 - 0.2;
            rice = round(rice);

            defenderNation.rice = clampMin(defenderNation.rice - rice, 0);
            affectedNations.add(defenderNation);
        } else if (input.battle.conquered) {
            const bonus = defenderNation.capitalCityId === input.defenderCity.id ? 1000 : 500;
            defenderNation.rice = round(defenderNation.rice + bonus);
            affectedNations.add(defenderNation);
        }
    }

    // 기술 경험치와 외교 사망자 수치 갱신.
    if (input.attackerNation.id && attackerReport) {
        const attackerTechGain = attackerDead * 0.012;
        applyNationTechGain(input.attackerNation, attackerTechGain, input, {
            side: 'attacker',
            nation: input.attackerNation,
            attackerReport,
        });
        affectedNations.add(input.attackerNation);
    }

    if (input.defenderNation && input.defenderNation.id !== 0 && attackerReport) {
        const defenderTechGain = attackerKilled * 0.009;
        applyNationTechGain(input.defenderNation, defenderTechGain, input, {
            side: 'defender',
            nation: input.defenderNation,
            attackerReport,
        });
        affectedNations.add(input.defenderNation);

        diplomacyDeltas.push(
            {
                fromNationId: input.attackerNation.id,
                toNationId: input.defenderNation.id,
                deadDelta: round(attackerDead),
            },
            {
                fromNationId: input.defenderNation.id,
                toNationId: input.attackerNation.id,
                deadDelta: round(attackerKilled),
            }
        );
    }

    // 점령 성공 시 ConquerCity 로직 수행.
    let conquest: ConquerCityOutcome<TriggerState> | undefined;
    if (input.battle.conquered) {
        const rng =
            input.rng ??
            new RandUtil(
                LiteHashDRBG.build(
                    simpleSerialize(
                        input.hiddenSeed ?? '',
                        'ConquerCity',
                        input.time.year,
                        input.time.month,
                        input.attackerNation.id,
                        input.battle.attacker.id,
                        input.defenderCity.id
                    )
                )
            );
        conquest = resolveConquerCity(input, rng);
        logs.push(...conquest.logs);

        conquest.nations.forEach((nation) => affectedNations.add(nation));
        conquest.cities.forEach((city) => affectedCities.add(city));
        conquest.generals.forEach((general) => affectedGenerals.add(general));
    }

    const outcome: WarAftermathOutcome<TriggerState> = {
        nations: Array.from(affectedNations),
        cities: Array.from(affectedCities),
        generals: Array.from(affectedGenerals),
        diplomacyDeltas,
        logs,
        conquered: input.battle.conquered,
    };
    if (conquest) {
        outcome.conquest = conquest;
    }
    return outcome;
};
