import { JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import type { City, General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { buildCrewTypeIndex as buildCrewTypeDefinitionIndex } from '@sammo-ts/logic/world/unitSet.js';
import { WarActionPipeline } from './actions.js';
import { WarCrewType } from './crewType.js';
import { WarTriggerCaller, createWarTriggerEnv, type WarTriggerRegistry } from './triggers.js';
import type { WarBattleInput, WarBattleOutcome, WarGeneralInput, WarUnitReport } from './types.js';
import { getMetaNumber } from './utils.js';
import { WarUnitCity, WarUnitGeneral, type WarUnit } from './units.js';

const META_FULL_LEADERSHIP = 'fullLeadership';
const META_FULL_STRENGTH = 'fullStrength';
const META_FULL_INTELLIGENCE = 'fullIntelligence';
const META_DEFENCE_TRAIN = 'defenceTrain';

const defaultLoggerFactory = (options: { generalId?: number; nationId?: number }): ActionLogger =>
    new ActionLogger(options);

const resolveCrewType = (crewTypeIndex: Map<number, WarCrewType>, crewTypeId: number): WarCrewType => {
    const crewType = crewTypeIndex.get(crewTypeId);
    if (!crewType) {
        throw new Error(`Invalid crew type: ${crewTypeId}`);
    }
    return crewType;
};

const buildWarCrewTypeIndex = (unitSet: WarBattleInput['unitSet']): Map<number, WarCrewType> => {
    const index = new Map<number, WarCrewType>();
    const crewTypes = buildCrewTypeDefinitionIndex(unitSet);
    for (const [id, crewType] of crewTypes) {
        index.set(id, new WarCrewType(crewType));
    }
    return index;
};

const createPipeline = <TriggerState extends GeneralTriggerState>(
    input: WarGeneralInput<TriggerState>
): WarActionPipeline<TriggerState> => new WarActionPipeline(input.modules ?? []);

const appendCrewTypeTriggers = (
    caller: WarTriggerCaller,
    unit: WarUnit,
    names: string[],
    registry: WarTriggerRegistry | undefined
): void => {
    if (!registry) {
        return;
    }
    for (const name of names) {
        const factory = registry[name];
        if (!factory) {
            continue;
        }
        const trigger = factory(unit);
        if (!trigger) {
            continue;
        }
        if (trigger instanceof WarTriggerCaller) {
            caller.merge(trigger);
        } else {
            caller.append(trigger);
        }
    }
};

const buildBattleInitTriggers = (unit: WarUnit, registry: WarTriggerRegistry | undefined): WarTriggerCaller => {
    const caller = new WarTriggerCaller();
    if (unit instanceof WarUnitGeneral) {
        const context = unit.getActionContext();
        caller.merge(unit.getActionPipeline().getBattleInitTriggerList(context));
    }
    appendCrewTypeTriggers(caller, unit, unit.getCrewType().initSkillTrigger, registry);
    return caller;
};

const buildBattlePhaseTriggers = (unit: WarUnit, registry: WarTriggerRegistry | undefined): WarTriggerCaller => {
    const caller = new WarTriggerCaller();
    if (unit instanceof WarUnitGeneral) {
        appendCrewTypeTriggers(caller, unit, ['che_필살'], registry);
        const context = unit.getActionContext();
        caller.merge(unit.getActionPipeline().getBattlePhaseTriggerList(context));
    }
    appendCrewTypeTriggers(caller, unit, unit.getCrewType().phaseSkillTrigger, registry);
    return caller;
};

const resolveFullStats = (
    general: General
): {
    leadership: number;
    strength: number;
    intelligence: number;
} => ({
    leadership: getMetaNumber(general.meta, META_FULL_LEADERSHIP, general.stats.leadership),
    strength: getMetaNumber(general.meta, META_FULL_STRENGTH, general.stats.strength),
    intelligence: getMetaNumber(general.meta, META_FULL_INTELLIGENCE, general.stats.intelligence),
});

const isSupplyCity = (city: City): boolean => {
    const supply = city.meta.supply;
    if (typeof supply === 'boolean') {
        return supply;
    }
    if (typeof supply === 'number') {
        return supply > 0;
    }
    return city.supplyState > 0;
};

export const computeBattleOrder = <TriggerState extends GeneralTriggerState>(
    defender: WarUnit<TriggerState>,
    attacker: WarUnitGeneral<TriggerState>
): number => {
    if (defender instanceof WarUnitCity) {
        const context = attacker.getActionContext();
        return attacker.getActionPipeline().onCalcOpposeStat(context, 'cityBattleOrder', -1);
    }

    if (!(defender instanceof WarUnitGeneral)) {
        return 0;
    }

    const general = defender.getGeneral();
    if (general.crew <= 0) {
        return 0;
    }
    if (general.rice <= general.crew / 100) {
        return 0;
    }

    const defenceTrain = getMetaNumber(general.meta, META_DEFENCE_TRAIN, 0);
    if (general.train < defenceTrain) {
        return 0;
    }
    if (general.atmos < defenceTrain) {
        return 0;
    }

    const realStat = general.stats.leadership + general.stats.strength + general.stats.intelligence;
    const fullStats = resolveFullStats(general);
    const fullStat = fullStats.leadership + fullStats.strength + fullStats.intelligence;
    const totalStat = (realStat + fullStat) / 2;

    const totalCrew = (general.crew / 1_000_000) * Math.pow(general.train * general.atmos, 1.5);

    return totalStat + totalCrew / 100;
};

const resolveUnitReport = (unit: WarUnit): WarUnitReport => {
    if (unit instanceof WarUnitGeneral) {
        return {
            id: unit.getGeneral().id,
            type: 'general',
            name: unit.getName(),
            isAttacker: unit.isAttacker(),
            killed: unit.getKilled(),
            dead: unit.getDead(),
        };
    }

    if (unit instanceof WarUnitCity) {
        return {
            id: unit.getCityId(),
            type: 'city',
            name: unit.getName(),
            isAttacker: unit.isAttacker(),
            killed: unit.getKilled(),
            dead: unit.getDead(),
        };
    }

    return {
        id: null,
        type: 'city',
        name: unit.getName(),
        isAttacker: unit.isAttacker(),
        killed: unit.getKilled(),
        dead: unit.getDead(),
    };
};

const flushLoggers = (loggers: ActionLogger[]): Array<ReturnType<ActionLogger['flush']>[number]> => {
    const logs: Array<ReturnType<ActionLogger['flush']>[number]> = [];
    for (const logger of loggers) {
        logs.push(...logger.flush());
    }
    return logs;
};

export const resolveWarBattle = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    input: WarBattleInput<TriggerState>
): WarBattleOutcome<TriggerState> => {
    // process_war.php 전투 루프를 순수 로직으로 이식한다.
    const rng = input.rng ?? new RandUtil(LiteHashDRBG.build(input.seed ?? ''));
    const loggerFactory = input.loggerFactory ?? defaultLoggerFactory;
    const triggerRegistry = input.triggerRegistry;

    const crewTypeIndex = buildWarCrewTypeIndex(input.unitSet);
    const attackerPipeline = createPipeline(input.attacker);
    const attackerLogger =
        input.attacker.logger ??
        loggerFactory({
            generalId: input.attacker.general.id,
            nationId: input.attacker.general.nationId,
        });

    const attackerUnit = new WarUnitGeneral(
        rng,
        input.config,
        input.attacker.general,
        input.attacker.city,
        input.attacker.nation,
        true,
        resolveCrewType(crewTypeIndex, input.attacker.general.crewTypeId),
        attackerLogger,
        attackerPipeline
    );

    const cityLogger = loggerFactory({
        nationId: input.defenderCity.nationId,
    });
    const cityUnit = new WarUnitCity(
        rng,
        input.config,
        input.defenderCity,
        input.defenderNation,
        resolveCrewType(crewTypeIndex, input.config.castleCrewTypeId),
        cityLogger,
        input.time.year,
        input.time.startYear
    );

    const defenderUnits: WarUnit<TriggerState>[] = [];
    const defenderGenerals: WarUnitGeneral<TriggerState>[] = [];
    for (const defender of input.defenders) {
        const defenderLogger =
            defender.logger ??
            loggerFactory({
                generalId: defender.general.id,
                nationId: defender.general.nationId,
            });
        const unit = new WarUnitGeneral(
            rng,
            input.config,
            defender.general,
            input.defenderCity,
            defender.nation,
            false,
            resolveCrewType(crewTypeIndex, defender.general.crewTypeId),
            defenderLogger,
            createPipeline(defender)
        );
        if (computeBattleOrder(unit, attackerUnit) <= 0) {
            continue;
        }
        defenderUnits.push(unit);
        defenderGenerals.push(unit);
    }

    if (defenderGenerals.length > 0 && computeBattleOrder<TriggerState>(cityUnit, attackerUnit) > 0) {
        defenderUnits.push(cityUnit);
    }

    defenderUnits.sort(
        (lhs, rhs) =>
            computeBattleOrder<TriggerState>(rhs, attackerUnit) - computeBattleOrder<TriggerState>(lhs, attackerUnit)
    );

    const iter = defenderUnits.values();
    let defender: WarUnit<TriggerState> | null = null;

    const getNextDefender = (
        _prevDefender: WarUnit<TriggerState> | null,
        reqNext: boolean
    ): WarUnit<TriggerState> | null => {
        if (!reqNext) {
            return null;
        }
        const next = iter.next();
        if (next.done) {
            return null;
        }
        const candidate = next.value as WarUnit<TriggerState>;
        if (computeBattleOrder(candidate, attackerUnit) <= 0) {
            return null;
        }
        return candidate;
    };

    defender = getNextDefender(null, true);
    let conquerCity = false;
    let logWritten = false;

    const attackerNationName = (attackerUnit.getNationVar('name') as string | null) ?? 'UNKNOWN';
    const attackerName = attackerUnit.getName();
    const cityName = cityUnit.getName();
    const seedText = input.seed ? `(전투시드: ${input.seed})` : '';

    const josaRo = JosaUtil.pick(cityName, '로');
    const josaYi = JosaUtil.pick(attackerName, '이');

    attackerLogger.pushGlobalActionLog(
        `<D><b>${attackerNationName}</b></>의 <Y>${attackerName}</>${josaYi} <G><b>${cityName}</b></>${josaRo} 진격합니다.${seedText}`,
        LogFormat.MONTH
    );
    attackerLogger.pushGeneralActionLog(
        `<G><b>${cityName}</b></>${josaRo} <M>진격</>합니다.${seedText}`,
        LogFormat.MONTH
    );

    while (attackerUnit.getPhase() < attackerUnit.getMaxPhase()) {
        logWritten = false;

        if (!defender) {
            defender = cityUnit;
            cityUnit.setSiege();

            const defenderRice = input.defenderNation?.rice ?? 0;
            if (isSupplyCity(input.defenderCity) && defenderRice <= 0) {
                attackerUnit.setOppose(defender);
                defender.setOppose(attackerUnit);

                attackerUnit.addTrain(1);

                attackerUnit.addWin();
                defender.addLose();
                cityUnit.heavyDecreaseWealth();

                attackerLogger.pushGlobalActionLog(
                    `병량 부족으로 <G><b>${cityName}</b></>의 수비병들이 <R>패퇴</>합니다.`,
                    LogFormat.MONTH
                );

                conquerCity = true;
                break;
            }
        }

        if (defender.getPhase() === 0 && !defender.getOppose()) {
            defender.setPrePhase(attackerUnit.getPhase());

            attackerUnit.addTrain(1);
            defender.addTrain(1);

            const attackerName = attackerUnit.getName();
            const attackerCrewName = attackerUnit.getCrewTypeName();

            if (defender instanceof WarUnitGeneral) {
                const defenderName = defender.getName();
                const defenderCrewName = defender.getCrewTypeName();

                const josaWa = JosaUtil.pick(attackerCrewName, '와');
                const josaYiDef = JosaUtil.pick(defenderCrewName, '이');
                attackerLogger.pushGlobalActionLog(
                    `<Y>${attackerName}</>의 ${attackerCrewName}${josaWa} <Y>${defenderName}</>의 ${defenderCrewName}${josaYiDef} 대결합니다.`,
                    LogFormat.MONTH
                );

                const josaRo = JosaUtil.pick(attackerCrewName, '로');
                const josaUl = JosaUtil.pick(defenderCrewName, '을');
                attackerUnit
                    .getLogger()
                    .pushGeneralActionLog(
                        `${attackerCrewName}${josaRo} <Y>${defenderName}</>의 ${defenderCrewName}${josaUl} <M>공격</>합니다.`,
                        LogFormat.MONTH
                    );

                const defJosaRo = JosaUtil.pick(defenderCrewName, '로');
                const defJosaUl = JosaUtil.pick(attackerCrewName, '을');
                defender
                    .getLogger()
                    .pushGeneralActionLog(
                        `${defenderCrewName}${defJosaRo} <Y>${attackerName}</>의 ${attackerCrewName}${defJosaUl} <M>수비</>합니다.`,
                        LogFormat.MONTH
                    );
            } else {
                const josaYiName = JosaUtil.pick(attackerName, '이');
                const josaRoCrew = JosaUtil.pick(attackerCrewName, '로');
                attackerLogger.pushGlobalActionLog(
                    `<Y>${attackerName}</>${josaYiName} ${attackerCrewName}${josaRoCrew} 성벽을 공격합니다.`,
                    LogFormat.MONTH
                );
                attackerLogger.pushGeneralActionLog(
                    `${attackerCrewName}${josaRoCrew} 성벽을 <M>공격</>합니다.`,
                    LogFormat.PLAIN
                );
            }

            attackerUnit.setOppose(defender);
            defender.setOppose(attackerUnit);

            const initCaller = buildBattleInitTriggers(attackerUnit, triggerRegistry);
            initCaller.merge(buildBattleInitTriggers(defender, triggerRegistry));
            initCaller.fire({ rng, attacker: attackerUnit, defender }, createWarTriggerEnv());
        }

        attackerUnit.beginPhase();
        defender.beginPhase();

        const battleCaller = buildBattlePhaseTriggers(attackerUnit, triggerRegistry);
        battleCaller.merge(buildBattlePhaseTriggers(defender, triggerRegistry));
        battleCaller.fire({ rng, attacker: attackerUnit, defender }, createWarTriggerEnv());

        let deadDefender = attackerUnit.calcDamage();
        let deadAttacker = defender.calcDamage();

        const attackerHP = attackerUnit.getHP();
        const defenderHP = defender.getHP();

        if (deadAttacker > attackerHP || deadDefender > defenderHP) {
            const deadAttackerRatio = deadAttacker / Math.max(1, attackerHP);
            const deadDefenderRatio = deadDefender / Math.max(1, defenderHP);

            if (deadDefenderRatio > deadAttackerRatio) {
                deadAttacker /= deadDefenderRatio;
                deadDefender = defenderHP;
            } else {
                deadDefender /= deadAttackerRatio;
                deadAttacker = attackerHP;
            }
        }

        deadAttacker = Math.min(Math.ceil(deadAttacker), attackerHP);
        deadDefender = Math.min(Math.ceil(deadDefender), defenderHP);

        attackerUnit.decreaseHP(deadAttacker);
        defender.decreaseHP(deadDefender);

        attackerUnit.increaseKilled(deadDefender);
        defender.increaseKilled(deadAttacker);

        const phaseNickname = defender.getPhase() < 0 ? '先' : `${attackerUnit.getPhase() + 1} `;

        if (deadAttacker > 0 || deadDefender > 0) {
            attackerUnit
                .getLogger()
                .pushGeneralBattleDetailLog(
                    `${phaseNickname}: <Y1>【${attackerUnit.getName()}】</> <C>${attackerUnit.getHP()} (-${deadAttacker})</> VS <C>${defender.getHP()} (-${deadDefender})</> <Y1>【${defender.getName()}】</>`
                );

            defender
                .getLogger()
                .pushGeneralBattleDetailLog(
                    `${phaseNickname}: <Y1>【${defender.getName()}】</> <C>${defender.getHP()} (-${deadDefender})</> VS <C>${attackerUnit.getHP()} (-${deadAttacker})</> <Y1>【${attackerUnit.getName()}】</>`
                );
        }

        attackerUnit.addPhase();
        defender.addPhase();

        const attackerState = attackerUnit.continueWar();
        if (!attackerState.canContinue) {
            logWritten = true;

            attackerUnit.logBattleResult();
            defender.logBattleResult();

            attackerUnit.addLose();
            defender.addWin();

            attackerUnit.tryWound();
            defender.tryWound();

            const josaYiCrew = JosaUtil.pick(attackerUnit.getCrewTypeName(), '이');
            attackerLogger.pushGlobalActionLog(
                `<Y>${attackerUnit.getName()}</>의 ${attackerUnit.getCrewTypeName()}${josaYiCrew} 퇴각했습니다.`,
                LogFormat.MONTH
            );
            attackerUnit
                .getLogger()
                .pushGeneralActionLog(
                    attackerState.noRice ? '군량 부족으로 퇴각합니다.' : '퇴각했습니다.',
                    LogFormat.PLAIN
                );
            defender
                .getLogger()
                .pushGeneralActionLog(
                    `<Y>${attackerUnit.getName()}</>의 ${attackerUnit.getCrewTypeName()}${josaYiCrew} 퇴각했습니다.`,
                    LogFormat.PLAIN
                );
            break;
        }

        const defenderState = defender.continueWar();
        if (!defenderState.canContinue) {
            logWritten = true;

            attackerUnit.logBattleResult();
            defender.logBattleResult();

            if (!(defender instanceof WarUnitCity) || defender.isSiege()) {
                attackerUnit.addWin();
                defender.addLose();

                attackerUnit.tryWound();
                defender.tryWound();

                if (defender === cityUnit) {
                    attackerUnit.addLevelExp(1000);
                    conquerCity = true;
                    break;
                }
            }

            const josaYiDefCrew = JosaUtil.pick(defender.getCrewTypeName(), '이');

            if (defender instanceof WarUnitCity && !defender.isSiege()) {
                defender.setOppose(null);
            } else if (defenderState.noRice) {
                attackerLogger.pushGlobalActionLog(
                    `<Y>${defender.getName()}</>의 ${defender.getCrewTypeName()}${josaYiDefCrew} 패퇴했습니다.`,
                    LogFormat.MONTH
                );
                attackerUnit
                    .getLogger()
                    .pushGeneralActionLog(
                        `<Y>${defender.getName()}</>의 ${defender.getCrewTypeName()}${josaYiDefCrew} 패퇴했습니다.`,
                        LogFormat.PLAIN
                    );
                defender.getLogger().pushGeneralActionLog('군량 부족으로 패퇴합니다.', LogFormat.PLAIN);
            } else {
                attackerLogger.pushGlobalActionLog(
                    `<Y>${defender.getName()}</>의 ${defender.getCrewTypeName()}${josaYiDefCrew} 전멸했습니다.`,
                    LogFormat.MONTH
                );
                attackerUnit
                    .getLogger()
                    .pushGeneralActionLog(
                        `<Y>${defender.getName()}</>의 ${defender.getCrewTypeName()}${josaYiDefCrew} 전멸했습니다.`,
                        LogFormat.PLAIN
                    );
                defender.getLogger().pushGeneralActionLog('전멸했습니다.', LogFormat.PLAIN);
            }

            if (attackerUnit.getPhase() >= attackerUnit.getMaxPhase()) {
                break;
            }

            defender.finishBattle();
            defender = getNextDefender(defender, true);
        }
    }

    if (!logWritten && defender) {
        attackerUnit.logBattleResult();
        defender.logBattleResult();

        attackerUnit.tryWound();
        defender.tryWound();
    }

    attackerUnit.finishBattle();
    defender?.finishBattle();

    if (cityUnit.getDead() > 0 || defender instanceof WarUnitCity) {
        if (cityUnit !== defender) {
            cityUnit.setOppose(attackerUnit);
            cityUnit.setSiege();
            cityUnit.finishBattle();
        }

        const newConflict = cityUnit.addConflict();
        if (newConflict) {
            const nationName = attackerUnit.getNationVar('name') as string;
            const josaYiNation = JosaUtil.pick(nationName, '이');
            attackerLogger.pushGlobalHistoryLog(
                `<M><b>【분쟁】</b></><D><b>${nationName}</b></>${josaYiNation} <G><b>${cityName}</b></> 공략에 가담하여 분쟁이 발생하고 있습니다.`,
                LogFormat.YEAR_MONTH
            );
        }
    }

    const logs = flushLoggers([attackerLogger, ...defenderGenerals.map((unit) => unit.getLogger())]);

    const reports: WarUnitReport[] = [
        resolveUnitReport(attackerUnit),
        ...defenderUnits.map(resolveUnitReport),
        resolveUnitReport(cityUnit),
    ];

    return {
        attacker: attackerUnit.getGeneral(),
        defenders: defenderGenerals.map((unit) => unit.getGeneral()),
        defenderCity: input.defenderCity,
        logs,
        conquered: conquerCity,
        reports,
        metrics: {
            attackerPhase: attackerUnit.getPhase(),
            attackerActivatedSkills: attackerUnit.getActivatedSkillLog(),
            defenderActivatedSkills: defenderUnits.map((unit) => unit.getActivatedSkillLog()),
        },
    };
};

export const resolveDefenderOrder = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    input: WarBattleInput<TriggerState>
): number[] => {
    const rng = input.rng ?? new RandUtil(LiteHashDRBG.build(input.seed ?? ''));
    const loggerFactory = input.loggerFactory ?? defaultLoggerFactory;

    const crewTypeIndex = buildWarCrewTypeIndex(input.unitSet);
    const attackerPipeline = createPipeline(input.attacker);
    const attackerLogger =
        input.attacker.logger ??
        loggerFactory({
            generalId: input.attacker.general.id,
            nationId: input.attacker.general.nationId,
        });

    const attackerUnit = new WarUnitGeneral(
        rng,
        input.config,
        input.attacker.general,
        input.attacker.city,
        input.attacker.nation,
        true,
        resolveCrewType(crewTypeIndex, input.attacker.general.crewTypeId),
        attackerLogger,
        attackerPipeline
    );

    const defenderUnits: WarUnitGeneral<TriggerState>[] = [];
    for (const defender of input.defenders) {
        const defenderLogger =
            defender.logger ??
            loggerFactory({
                generalId: defender.general.id,
                nationId: defender.general.nationId,
            });
        const unit = new WarUnitGeneral(
            rng,
            input.config,
            defender.general,
            input.defenderCity,
            defender.nation,
            false,
            resolveCrewType(crewTypeIndex, defender.general.crewTypeId),
            defenderLogger,
            createPipeline(defender)
        );
        if (computeBattleOrder(unit, attackerUnit) <= 0) {
            continue;
        }
        defenderUnits.push(unit);
    }

    defenderUnits.sort((lhs, rhs) => computeBattleOrder(rhs, attackerUnit) - computeBattleOrder(lhs, attackerUnit));

    return defenderUnits.map((unit) => unit.getGeneral().id);
};
