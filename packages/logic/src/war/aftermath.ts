import { JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import { createGeneralActionEvent } from '@sammo-ts/logic/actionModules/events.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';
import { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import { LogFormat, type LogEntryDraft } from '@sammo-ts/logic/logging/types.js';
import { buildScoutMessageDraft } from '@sammo-ts/logic/messages/scoutMessage.js';
import { searchDistanceEntries } from '@sammo-ts/logic/world/distance.js';
import { buildCrewTypeIndex, getTechCost, getTechLevel } from '@sammo-ts/logic/world/unitSet.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import { LEGACY_DEFAULT_MAX_LEVEL } from '@sammo-ts/logic/scenario/constants.js';
import type { WarUnitReport } from './types.js';
import type {
    ConquerCityOutcome,
    WarAftermathConfig,
    WarAftermathInput,
    WarAftermathOutcome,
    WarAftermathTechContext,
    WarDiplomacyDelta,
} from './types.js';
import {
    clamp,
    clampMin,
    getMetaNumber,
    parseConflict,
    readConflictOrder,
    round,
    simpleSerialize,
    sortConflictEntries,
} from './utils.js';
import { LegacyWarLogFlushSequence } from './legacyFlushSequence.js';

const META_DEAD = 'dead';
const MAX_DEDICATION_LEVEL = 30;

const updateLegacyProgressionLevels = (general: General, logger: ActionLogger): void => {
    const previousExpLevel = getMetaNumber(general.meta, 'explevel', 0);
    const previousDedLevel = getMetaNumber(general.meta, 'dedlevel', 0);
    const expLevel =
        general.experience < 1_000
            ? Math.trunc(general.experience / 100)
            : Math.trunc(Math.sqrt(general.experience / 10));
    const nextExpLevel = clamp(expLevel, 0, LEGACY_DEFAULT_MAX_LEVEL);
    const nextDedLevel = clamp(Math.ceil(Math.sqrt(general.dedication) / 10), 0, MAX_DEDICATION_LEVEL);
    general.meta.explevel = nextExpLevel;
    general.meta.dedlevel = nextDedLevel;

    if (nextExpLevel !== previousExpLevel) {
        const josaRo = JosaUtil.pick(String(nextExpLevel), '로');
        logger.pushGeneralActionLog(
            nextExpLevel > previousExpLevel
                ? `<C>Lv ${nextExpLevel}</>${josaRo} <C>레벨업</>!`
                : `<C>Lv ${nextExpLevel}</>${josaRo} <R>레벨다운</>!`,
            LogFormat.PLAIN
        );
    }

    if (nextDedLevel !== previousDedLevel) {
        const dedicationLevelText = nextDedLevel === 0 ? '무품관' : `${MAX_DEDICATION_LEVEL - nextDedLevel + 1}품관`;
        const billText = (nextDedLevel * 200 + 400).toLocaleString('en-US');
        const josaRoDedication = JosaUtil.pick(dedicationLevelText, '로');
        const josaRoBill = JosaUtil.pick(billText, '로');
        logger.pushGeneralActionLog(
            nextDedLevel > previousDedLevel
                ? `<Y>${dedicationLevelText}</>${josaRoDedication} <C>승급</>하여 봉록이 <C>${billText}</>${josaRoBill} <C>상승</>했습니다!`
                : `<Y>${dedicationLevelText}</>${josaRoDedication} <R>강등</>되어 봉록이 <C>${billText}</>${josaRoBill} <R>하락</>했습니다!`,
            LogFormat.PLAIN
        );
    }
};

const findReport = (reports: WarUnitReport[], predicate: (report: WarUnitReport) => boolean): WarUnitReport | null => {
    for (const report of reports) {
        if (predicate(report)) {
            return report;
        }
    }
    return null;
};

const getDeadCounter = (city: City): number => getMetaNumber(city.meta, META_DEAD, 0);

const isAssignedToOfficerCity = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    cityId: number
): boolean =>
    ['officerCity', 'officer_city', 'officerCityId'].some(
        (key) => getMetaNumber(general.meta, key, Number.NaN) === cityId
    );

// REF-COMPAT:BEGIN ref-dead-split-int-binding
const increaseDeadCounter = (city: City, delta: number): void => {
    // Ref binds each `dead + %i` increment as an integer before MariaDB adds
    // it. Truncate each 40/60 percent split independently; rounding the
    // accumulated counter changes monthly recovery and war income.
    city.meta[META_DEAD] = getDeadCounter(city) + Math.trunc(delta);
};
// REF-COMPAT:END ref-dead-split-int-binding

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
    context: Omit<WarAftermathTechContext, 'baseGain'>
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
    const currentTech = getMetaNumber(nation.meta, 'tech', 0);
    const delta = gain / divisor;
    // REF-COMPAT:BEGIN ref-mariadb-float-boundary
    // Ref executes `tech + delta` inside MariaDB for battle gains, so the
    // arithmetic starts from the stored binary32 value without a PHP text read.
    nation.meta.tech = Math.fround(currentTech + delta);
    // REF-COMPAT:END ref-mariadb-float-boundary
    if (input.trace?.isEnabled('WAR_TECH_TRACE', { nationIds: [nation.id] })) {
        input.trace.write('WAR_TECH_TRACE', {
            engine: 'core',
            nationId: nation.id,
            side: context.side,
            currentTech,
            baseGain,
            gain,
            total,
            effective,
            divisor,
            delta,
            storedTech: nation.meta.tech,
            attackerGeneralId: context.attackerReport.id,
        });
    }
};

const resolveConquerNation = (city: City, attackerNationId: number, nations: Nation[]): number => {
    const conflict = parseConflict(city.conflict);
    if (!conflict) {
        return attackerNationId;
    }
    const activeNationIds = new Set(nations.map((nation) => nation.id));
    const entries = sortConflictEntries(conflict, readConflictOrder(city.meta)).filter(
        ([key, value]) =>
            Number.isFinite(key) && typeof value === 'number' && (key === attackerNationId || activeNationIds.has(key))
    );
    if (!entries.length) {
        return attackerNationId;
    }
    return entries[0]![0];
};

const findNextCapital = (
    cities: City[],
    defenderNationId: number,
    capturedCityId: number,
    map: MapDefinition
): City => {
    const candidates = cities.filter((city) => city.nationId === defenderNationId && city.id !== capturedCityId);
    if (!candidates.length) {
        throw new Error('도시가 남지 않았는데 긴천을 시도하고 있습니다');
    }

    const candidatesById = new Map(candidates.map((city) => [city.id, city] as const));
    let nearestDistance: number | null = null;
    let nextCapital: City | null = null;

    // Ref searchDistance(..., true)는 CityConst::path 순서의 BFS 결과를
    // 거리별로 훑는다. 첫 보유 거리만 보고, 같은 인구면 뒤 도시로
    // 교체하는 findNextCapital의 >= 동률 처리까지 그대로 보존한다.
    for (const [cityId, distance] of searchDistanceEntries(map, capturedCityId, 99)) {
        if (distance === 0) {
            continue;
        }
        if (nearestDistance !== null && distance > nearestDistance) {
            break;
        }
        const candidate = candidatesById.get(cityId);
        if (!candidate) {
            continue;
        }
        nearestDistance ??= distance;
        if (!nextCapital || candidate.population >= nextCapital.population) {
            nextCapital = candidate;
        }
    }

    if (!nextCapital) {
        throw new Error('도시가 남지 않았는데 긴천을 시도하고 있습니다');
    }
    return nextCapital;
};

const pushLogger = (
    logger: ActionLogger,
    logs: LogEntryDraft[],
    legacyFlushSequence: LegacyWarLogFlushSequence
): void => {
    logs.push(...legacyFlushSequence.flush(logger));
};

// 도시 점령 이후의 국가 붕괴/수도 이동/도시 리셋 처리.
const resolveConquerCity = <TriggerState extends GeneralTriggerState>(
    input: WarAftermathInput<TriggerState>,
    rng: RandUtil,
    legacyFlushSequence: LegacyWarLogFlushSequence
): ConquerCityOutcome<TriggerState> => {
    const { attackerNation, defenderNation, defenderCity, cities, generals, config } = input;
    const attacker = input.battle.attacker;

    const logs: LogEntryDraft[] = [];
    const affectedCities = new Set<City>();
    const affectedGenerals = new Set<General<TriggerState>>();
    const affectedNations = new Set<Nation>();

    const conquerNationId = resolveConquerNation(defenderCity, attackerNation.id, input.nations);
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

    const defenderNationLogger = defenderNationId ? new ActionLogger({ nationId: defenderNationId }) : null;
    if (defenderNationLogger) {
        defenderNationLogger.pushNationHistoryLog(
            `<D><b>${attackerNationName}</b></>의 <Y>${attackerGeneralName}</>에 의해 <G><b>${cityName}</b></>${josaYiCity} <O>함락</>`
        );
    }

    const defenderCityCount = defenderNationId ? cities.filter((city) => city.nationId === defenderNationId).length : 0;
    const nationCollapsed = defenderNationId !== 0 && defenderCityCount === 1;

    let collapseRewardGold = 0;
    let collapseRewardRice = 0;
    const messages: ConquerCityOutcome<TriggerState>['messages'] = [];
    const ruinedNpcJoinPlans: ConquerCityOutcome<TriggerState>['ruinedNpcJoinPlans'] = [];

    // 국가 붕괴 시 자원 손실과 포상 정산.
    if (nationCollapsed && defenderNation) {
        const defenderNationGenerals = generals.filter((general) => general.nationId === defenderNationId);
        const collapseLord =
            defenderNationGenerals.find((general) => general.officerLevel === 12) ??
            (defenderNation.chiefGeneralId === null
                ? undefined
                : defenderNationGenerals.find((general) => general.id === defenderNation.chiefGeneralId));
        if (!collapseLord) {
            throw new Error(`Collapsed nation ${defenderNationId} has no lord general.`);
        }
        const collapseLordId = collapseLord.id;
        const defenderGenerals = defenderNationGenerals.sort((lhs, rhs) => {
            // deleteNation() reads the non-lord rows in primary-key order,
            // then appends the lord object to the returned PHP array.
            const lhsIsLord = lhs.id === collapseLordId;
            const rhsIsLord = rhs.id === collapseLordId;
            if (lhsIsLord !== rhsIsLord) {
                return lhsIsLord ? 1 : -1;
            }
            return lhs.id - rhs.id;
        });
        let totalGoldLoss = 0;
        let totalRiceLoss = 0;

        const defenderNationJosaUl = JosaUtil.pick(defenderNationName, '을');
        const defenderNationJosaUn = JosaUtil.pick(defenderNationName, '은');
        const defenderNationJosaYi = JosaUtil.pick(defenderNationName, '이');
        // Ref는 도시 수비 장수들의 onArbitraryAction/applyDB 뒤 이 순서로
        // defender nation logger와 attacker logger를 각각 flush한다.
        if (defenderNationLogger) {
            pushLogger(defenderNationLogger, logs, legacyFlushSequence);
        }
        attackerLogger.pushNationHistoryLog(`<D><b>${defenderNationName}</b></>${defenderNationJosaUl} 정복`);
        pushLogger(attackerLogger, logs, legacyFlushSequence);

        for (const general of defenderGenerals) {
            // Legacy Util::toInt truncates these losses rather than rounding.
            const loseGold = Math.trunc(general.gold * rng.nextRange(0.2, 0.5));
            const loseRice = Math.trunc(general.rice * rng.nextRange(0.2, 0.5));
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
                `<D><b>${defenderNationName}</b></>${defenderNationJosaYi} <R>멸망</>했습니다.`,
                LogFormat.PLAIN
            );
            generalLogger.pushGeneralHistoryLog(`<D><b>${defenderNationName}</b></>${defenderNationJosaYi} <R>멸망</>`);
            generalLogger.pushGeneralActionLog(
                `도주하며 금<C>${loseGold}</> 쌀<C>${loseRice}</>을 분실했습니다.`,
                LogFormat.PLAIN
            );
            // Ref calls addExperience()/addDedication() after the loss action
            // and before this former general's applyDB(), so any level/rank
            // notices belong to the same logger/flush epoch.
            updateLegacyProgressionLevels(general, generalLogger);
            if (general.id === collapseLordId) {
                // deleteNation()은 멸망 전역사를 군주의 logger에 먼저 넣고,
                // 군주가 배열의 마지막에서 applyDB될 때 같은 epoch으로 저장한다.
                generalLogger.pushGlobalHistoryLog(
                    `<R><b>【멸망】</b></><D><b>${defenderNationName}</b></>${defenderNationJosaUn} <R>멸망</>했습니다.`
                );
            }
            pushLogger(generalLogger, logs, legacyFlushSequence);
            affectedGenerals.add(general);

            if (config.joinMode !== 'onlyRandom') {
                // deleteNation() has already persisted every former member as
                // an unaffiliated officer before this draw and message build.
                // The snapshot in the receiver-only ScoutMessage must
                // therefore be neutral even though Core removes the nation
                // after applying the command outcome.
                if (rng.nextBool(0.5)) {
                    const message = buildScoutMessageDraft({
                        srcGeneral: attacker,
                        destGeneral: {
                            id: general.id,
                            name: general.name,
                            nationId: 0,
                            officerLevel: 0,
                        },
                        srcNation: attackerNation,
                        destNation: null,
                        time: input.messageTime,
                        ...(input.messageSharedIconBaseUrl
                            ? { sharedIconBaseUrl: input.messageSharedIconBaseUrl }
                            : {}),
                    });
                    if (message) {
                        messages.push(message);
                    }
                }

                const eligibleNpc = general.npcState >= 2 && general.npcState <= 8 && general.npcState !== 5;
                if (eligibleNpc && rng.nextBool(config.joinRuinedNpcProbability ?? 0.1)) {
                    ruinedNpcJoinPlans.push({
                        generalId: general.id,
                        destNationId: attackerNation.id,
                        joinTurn: rng.nextRangeInt(0, 12),
                    });
                }
            }
        }

        collapseRewardGold = Math.floor((Math.max(0, defenderNation.gold - config.baseGold) + totalGoldLoss) / 2);
        collapseRewardRice = Math.floor((Math.max(0, defenderNation.rice - config.baseRice) + totalRiceLoss) / 2);

        attackerNation.gold = round(attackerNation.gold + collapseRewardGold);
        attackerNation.rice = round(attackerNation.rice + collapseRewardRice);

        const resourceLog =
            `<D><b>${defenderNationName}</b></> 정복으로 ` +
            `금<C>${collapseRewardGold.toLocaleString('en-US')}</> ` +
            `쌀<C>${collapseRewardRice.toLocaleString('en-US')}</>을 획득했습니다.`;
        for (const general of generals) {
            if (general.nationId !== attackerNation.id || general.officerLevel < 5) {
                continue;
            }
            if (general.id === attacker.id) {
                attackerLogger.pushGeneralActionLog(resourceLog, LogFormat.PLAIN);
                continue;
            }
            const chiefLogger = new ActionLogger({
                generalId: general.id,
                nationId: attackerNation.id,
            });
            chiefLogger.pushGeneralActionLog(resourceLog, LogFormat.PLAIN);
            pushLogger(chiefLogger, logs, legacyFlushSequence);
        }

        defenderNation.meta.collapsed = true;
        affectedNations.add(defenderNation);
        affectedNations.add(attackerNation);
    }

    if (!nationCollapsed) {
        // Ref updates every row assigned to the captured city without filtering
        // by nation, current city, or existing officer level.
        for (const general of generals) {
            if (!isAssignedToOfficerCity(general, defenderCity.id)) {
                continue;
            }
            general.officerLevel = 1;
            general.meta.officerCity = 0;
            general.meta.officer_city = 0;
            general.meta.officerCityId = 0;
            affectedGenerals.add(general);
        }
    }

    // 수도 함락 시 수도 이전 및 내부 사기/자원 페널티.
    if (!nationCollapsed && defenderNation && defenderNation.capitalCityId === defenderCity.id) {
        const nextCapital = findNextCapital(cities, defenderNationId, defenderCity.id, input.map);
        if (nextCapital) {
            const josaRo = JosaUtil.pick(nextCapital.name, '로');
            const josaYi = JosaUtil.pick(defenderNation.name, '이');
            attackerLogger.pushGlobalHistoryLog(
                `<M><b>【긴급천도】</b></><D><b>${defenderNation.name}</b></>${josaYi} 수도가 함락되어 <G><b>${nextCapital.name}</b></>${josaRo} 긴급천도하였습니다.`
            );
            const moveLog = `수도가 함락되어 <G><b>${nextCapital.name}</b></>${josaRo} <M>긴급천도</>합니다.`;
            const gatherLog = `수뇌는 <G><b>${nextCapital.name}</b></>${josaRo} 집합되었습니다.`;

            defenderNation.capitalCityId = nextCapital.id;
            defenderNation.gold = round(defenderNation.gold * 0.5);
            defenderNation.rice = round(defenderNation.rice * 0.5);

            nextCapital.supplyState = 1;
            affectedCities.add(nextCapital);

            for (const general of generals) {
                if (general.nationId !== defenderNationId) {
                    continue;
                }
                const defenderLogger = new ActionLogger({
                    generalId: general.id,
                    nationId: defenderNationId,
                });
                defenderLogger.pushGeneralActionLog(moveLog, LogFormat.PLAIN);
                if (general.officerLevel >= 5) {
                    // Ref omits the explicit PLAIN argument for the chief
                    // gathering notice, so ActionLogger's MONTH format applies.
                    defenderLogger.pushGeneralActionLog(gatherLog);
                }
                pushLogger(defenderLogger, logs, legacyFlushSequence);

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

    let conquerNationLogger: ActionLogger | null = null;
    if (conquerNationId === attackerNation.id) {
        attacker.cityId = defenderCity.id;
        affectedGenerals.add(attacker);
    } else {
        const conquerNationName = conquerNation.name;
        conquerNationLogger = new ActionLogger({ nationId: conquerNationId });
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
    }

    // 점령 후 도시 상태를 방어 기본 상태로 되돌린다.
    defenderCity.supplyState = 1;
    defenderCity.frontState = 0;
    defenderCity.meta.term = 0;
    defenderCity.meta.officer_set = 0;
    defenderCity.agriculture = round(defenderCity.agriculture * 0.7);
    defenderCity.commerce = round(defenderCity.commerce * 0.7);
    defenderCity.security = round(defenderCity.security * 0.7);
    defenderCity.nationId = conquerNationId;
    defenderCity.conflict = {};
    defenderCity.meta.conflict_order = [];

    if (defenderCity.level > 3) {
        defenderCity.defence = config.defaultCityWall;
        defenderCity.wall = config.defaultCityWall;
    } else {
        defenderCity.defence = round(defenderCity.defenceMax / 2);
        defenderCity.wall = round(defenderCity.wallMax / 2);
    }

    affectedCities.add(defenderCity);
    affectedNations.add(conquerNation);

    // 비멸망 경로의 defender/conquer logger는 ConquerCity() 함수가 끝날 때
    // 생성 순서대로 destruct/flush된다. attacker logger는 외부 General이
    // 소유하므로 여기서 그룹을 소비하지 않고 che_출병 line 259 epoch으로 넘긴다.
    if (!nationCollapsed && defenderNationLogger) {
        pushLogger(defenderNationLogger, logs, legacyFlushSequence);
    }
    if (conquerNationLogger) {
        pushLogger(conquerNationLogger, logs, legacyFlushSequence);
    }
    logs.push(...attackerLogger.flush());

    return {
        conquerNationId,
        nationCollapsed,
        collapseRewardGold: round(collapseRewardGold),
        collapseRewardRice: round(collapseRewardRice),
        logs,
        nations: Array.from(affectedNations),
        cities: Array.from(affectedCities),
        generals: Array.from(affectedGenerals),
        messages,
        ruinedNpcJoinPlans,
    };
};

export const resolveWarAftermath = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    input: WarAftermathInput<TriggerState>
): WarAftermathOutcome<TriggerState> => {
    const logs: LogEntryDraft[] = [];
    const legacyFlushSequence = input.legacyFlushSequence ?? new LegacyWarLogFlushSequence();
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
        increaseDeadCounter(input.attackerCity, totalDead * 0.4);
        increaseDeadCounter(input.defenderCity, totalDead * 0.6);
        affectedCities.add(input.attackerCity);
        affectedCities.add(input.defenderCity);
    }

    // 수성 도시의 식량 소모/보상 처리.
    if (input.defenderNation && input.defenderNation.id !== 0 && isSupplyCity(input.defenderCity)) {
        const defenderNation = input.defenderNation;
        const cityKilled = cityReport?.killed ?? 0;

        // Ref branches on WarUnitCity::getPhase(), not accumulated city
        // casualties. A city can retain dead casualties from earlier battles
        // while being conquered before its wall receives a phase.
        const cityPhase = cityReport?.phase ?? ((cityReport?.dead ?? 0) > 0 ? 1 : 0);
        if (cityPhase > 0) {
            const crewTypeIndex = buildCrewTypeIndex(input.unitSet);
            const crewType = crewTypeIndex.get(input.config.castleCrewTypeId);
            const riceCoef = crewType?.rice ?? 1;

            let rice = (cityKilled / 100) * 0.8;
            rice *= riceCoef;
            rice *= getTechCost(getMetaNumber(defenderNation.meta, 'tech', 0), input.config.maxTechLevel);
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

        // Legacy ConquerCity calls every general action module for every
        // defender-nation general stationed in the conquered city, before any
        // nation-collapse RNG is consumed. Keep that order and the same RNG
        // object instead of opening a second random stream.
        const pipeline = new GeneralActionPipeline(input.generalActionModules ?? []);
        const cityDefenders = input.generals
            .filter(
                (general) =>
                    general.nationId !== 0 &&
                    general.nationId === input.defenderCity.nationId &&
                    general.cityId === input.defenderCity.id
            )
            .sort((left, right) => left.id - right.id);
        for (const general of cityDefenders) {
            const generalLogger = new ActionLogger({
                generalId: general.id,
                nationId: general.nationId,
            });
            pipeline.dispatch(
                {
                    general,
                    nation: input.defenderNation,
                    rng,
                    worldView: {
                        listGenerals: () => input.generals,
                        listGeneralsByCity: (cityId) =>
                            input.generals.filter((candidate) => candidate.cityId === cityId),
                        listNations: () => input.nations,
                    },
                    log: {
                        push: (text) => generalLogger.pushGeneralActionLog(text, LogFormat.MONTH),
                    },
                },
                createGeneralActionEvent('city.conquered', {
                    attacker: input.battle.attacker,
                })
            );
            // Ref는 ID 오름차순 city defender마다 onArbitraryAction 직후
            // General::applyDB()를 호출한다. 로그가 없어도 epoch은 하나 소비한다.
            pushLogger(generalLogger, logs, legacyFlushSequence);
            affectedGenerals.add(general);
        }

        conquest = resolveConquerCity(input, rng, legacyFlushSequence);
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
