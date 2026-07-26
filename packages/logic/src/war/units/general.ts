import { JosaUtil, type RandUtil } from '@sammo-ts/common';

import type {
    City,
    General,
    GeneralTriggerState,
    Nation,
    StatBlock,
    TriggerValue,
} from '@sammo-ts/logic/domain/entities.js';
import type { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { WarStatName } from '@sammo-ts/logic/triggers/types.js';
import { getTechAbility, getTechCost } from '@sammo-ts/logic/world/unitSet.js';
import type { WarActionPipeline, WarActionContext } from '../actions.js';
import type { WarEngineConfig } from '../types.js';
import type { WarCrewType } from '../crewType.js';
import { clamp, clampMin, getMetaNumber, increaseMetaNumber, round } from '../utils.js';
import { WAR_CRITICAL_RANGE, WarUnit, resolveNationTech } from './base.js';
type CityUnit = WarUnit & { getCityId: () => number };

const isCityUnit = (unit: WarUnit | null): unit is CityUnit =>
    Boolean(unit && typeof (unit as CityUnit).getCityId === 'function');

const META_EXP_LEVEL = 'explevel';
const META_DEX_PREFIX = 'dex';
const META_RANK_PREFIX = 'rank_';
const META_INTEL_EXP = 'intel_exp';
const META_STRENGTH_EXP = 'strength_exp';
const META_LEADERSHIP_EXP = 'leadership_exp';
const MAX_EXP_LEVEL = 255;

const RANK_WARNUM = `${META_RANK_PREFIX}warnum`;
const RANK_KILLNUM = `${META_RANK_PREFIX}killnum`;
const RANK_DEATHNUM = `${META_RANK_PREFIX}deathnum`;
const RANK_OCCUPIED = `${META_RANK_PREFIX}occupied`;
const RANK_KILLCREW = `${META_RANK_PREFIX}killcrew`;
const RANK_DEATHCREW = `${META_RANK_PREFIX}deathcrew`;
const RANK_KILLCREW_PERSON = `${META_RANK_PREFIX}killcrew_person`;
const RANK_DEATHCREW_PERSON = `${META_RANK_PREFIX}deathcrew_person`;

const toDexStatName = (armType: number): WarStatName => `dex${armType}` as WarStatName;

// 장수 전투 유닛(legacy WarUnitGeneral 포팅).
export class WarUnitGeneral<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends WarUnit<TriggerState> {
    private readonly actionPipeline: WarActionPipeline<TriggerState>;
    private killedPerson = 0;
    private deadPerson = 0;

    constructor(
        rng: RandUtil,
        config: WarEngineConfig,
        private readonly general: General<TriggerState>,
        private readonly city: City,
        nation: Nation | null,
        isAttacker: boolean,
        crewType: WarCrewType,
        logger: ActionLogger,
        pipeline: WarActionPipeline<TriggerState>
    ) {
        super(rng, config, crewType, logger, isAttacker, nation);
        this.actionPipeline = pipeline;

        if (isAttacker) {
            if (this.city.level === 2) {
                this.atmosBonus += 5;
            }
            if (nation && nation.capitalCityId === this.city.id) {
                this.atmosBonus += 5;
            }
        } else {
            if (this.city.level === 1 || this.city.level === 3) {
                this.trainBonus += 5;
            }
        }
    }

    public getGeneral(): General<TriggerState> {
        return this.general;
    }

    public getActionContext(): WarActionContext<TriggerState> {
        return {
            general: this.general,
            nation: this.nation,
            city: this.city,
            log: this.logger,
            rng: this.rng,
            unit: this,
        };
    }

    public getActionPipeline(): WarActionPipeline<TriggerState> {
        return this.actionPipeline;
    }

    public override getName(): string {
        return this.general.name;
    }

    public getCityVar(key: keyof City): TriggerValue | null {
        const value = this.city[key];
        if (typeof value === 'number' || typeof value === 'string') {
            return value;
        }
        return null;
    }

    public override setOppose(oppose: WarUnit<TriggerState> | null): void {
        super.setOppose(oppose);
        increaseMetaNumber(this.general.meta, RANK_WARNUM, 1);

        if (!oppose) {
            return;
        }

        const baseTurnTime = this.isAttacker()
            ? this.general.turnTime
            : oppose instanceof WarUnitGeneral
              ? oppose.general.turnTime
              : this.general.turnTime;
        if (!baseTurnTime) {
            return;
        }
        const phase = clamp(this.getRealPhase(), 0, 99);
        this.general.recentWarTime = new Date(baseTurnTime.getTime());
        this.general.meta.recent_war_phase = phase;
    }

    public override getMaxPhase(): number {
        const base = this.getCrewType().speed;
        const aux = { isAttacker: this.isAttacker() };
        const context = this.getActionContext();
        const phase = this.actionPipeline.onCalcStat(context, 'initWarPhase', base, aux);
        return phase + this.bonusPhase;
    }

    public getComputedStat(
        statName: keyof StatBlock,
        base: number,
        options: {
            withInjury?: boolean;
            withStatAdjust?: boolean;
            withActions?: boolean;
            truncate?: boolean;
        } = {}
    ): number {
        const withInjury = options.withInjury ?? true;
        const withStatAdjust = options.withStatAdjust ?? true;
        const withActions = options.withActions ?? true;
        const truncate = options.truncate ?? true;
        const injuryRatio = withInjury ? (100 - this.general.injury) / 100 : 1;
        let value = base * injuryRatio;
        if (withStatAdjust && statName === 'strength') {
            value += round(
                this.getComputedStat('intelligence', this.general.stats.intelligence, {
                    withInjury,
                    withStatAdjust: false,
                    withActions,
                    truncate: false,
                }) / 4
            );
        } else if (withStatAdjust && statName === 'intelligence') {
            value += round(
                this.getComputedStat('strength', this.general.stats.strength, {
                    withInjury,
                    withStatAdjust: false,
                    withActions,
                    truncate: false,
                }) / 4
            );
        }
        const maxGeneralStat = this.config.maxGeneralStat ?? 255;
        value = clamp(value, 0, maxGeneralStat);
        if (withActions) {
            value = this.actionPipeline.onCalcStat(this.getActionContext(), statName, value);
        }
        // Legacy General::getStatValue() applies every action and then returns
        // Util::toInt(), which truncates toward zero on every stat read.
        const clamped = clamp(value, 0, maxGeneralStat);
        return truncate ? Math.trunc(clamped) : clamped;
    }

    private resolveMainStat(armType: number, withInjury = true): number {
        const leadership = this.getComputedStat('leadership', this.general.stats.leadership, { withInjury });
        const strength = this.getComputedStat('strength', this.general.stats.strength, { withInjury });
        const intelligence = this.getComputedStat('intelligence', this.general.stats.intelligence, { withInjury });

        if (armType === this.config.armTypes.wizard) {
            return intelligence;
        }
        if (armType === this.config.armTypes.siege) {
            return leadership;
        }
        if (armType === this.config.armTypes.misc) {
            return (intelligence + leadership + strength) / 3;
        }
        return strength;
    }

    private resolveOpposeStatValue(statName: WarStatName, value: number, aux?: Record<string, unknown>): number {
        const oppose = this.getOppose();
        if (!(oppose instanceof WarUnitGeneral)) {
            return value;
        }
        return oppose.getActionPipeline().onCalcOpposeStat(oppose.getActionContext(), statName, value, aux);
    }

    public override getDex(crewType: WarCrewType): number {
        const storedArmType =
            crewType.armType === this.config.armTypes.castle
                ? (this.config.armTypes.siege ?? crewType.armType)
                : crewType.armType;
        const base = getMetaNumber(this.general.meta, `${META_DEX_PREFIX}${storedArmType}`);
        const aux = {
            isAttacker: this.isAttacker(),
            opposeType: this.oppose?.getCrewType() ?? null,
        };
        // Legacy stores castle dexterity in the siege column, but still exposes
        // the requested castle arm type to trait handlers as `dex0`.
        const statName = toDexStatName(crewType.armType);
        let dex = this.actionPipeline.onCalcStat(this.getActionContext(), statName, base, aux);
        dex = this.resolveOpposeStatValue(statName, dex, aux);
        return dex;
    }

    public override getComputedAttack(): number {
        const tech = resolveNationTech(this.nation);
        const armType = this.getCrewType().armType;
        const mainStat = this.resolveMainStat(armType);
        let ratio = mainStat * 2 - 40;

        ratio = clampMin(ratio, 10);
        if (ratio > 100) {
            ratio = 50 + ratio / 2;
        }

        const attack = this.getCrewType().attack + getTechAbility(tech);
        return attack * (ratio / 100);
    }

    public override getComputedDefence(): number {
        const tech = resolveNationTech(this.nation);
        const defence = this.getCrewType().defence + getTechAbility(tech);
        const crew = this.general.crew / (7000 / 30) + 70;
        return defence * (crew / 100);
    }

    public override getComputedTrain(): number {
        const aux = { isAttacker: this.isAttacker() };
        let train = this.actionPipeline.onCalcStat(this.getActionContext(), 'bonusTrain', this.general.train, aux);
        train = this.resolveOpposeStatValue('bonusTrain', train, aux);
        train += this.trainBonus;
        return train;
    }

    public override getComputedAtmos(): number {
        const aux = { isAttacker: this.isAttacker() };
        let atmos = this.actionPipeline.onCalcStat(this.getActionContext(), 'bonusAtmos', this.general.atmos, aux);
        atmos = this.resolveOpposeStatValue('bonusAtmos', atmos, aux);
        atmos += this.atmosBonus;
        return atmos;
    }

    public override getComputedCriticalRatio(): number {
        const armType = this.getCrewType().armType;
        if (armType === this.config.armTypes.castle) {
            return 0;
        }

        const mainStat = this.resolveMainStat(armType, false);
        const coef =
            armType === this.config.armTypes.wizard ||
            armType === this.config.armTypes.siege ||
            armType === this.config.armTypes.misc
                ? 0.4
                : 0.5;

        let ratio = clampMin(mainStat - 65, 0) * coef;
        ratio = Math.min(50, ratio) / 100;

        const aux = { isAttacker: this.isAttacker() };
        ratio = this.actionPipeline.onCalcStat(this.getActionContext(), 'warCriticalRatio', ratio, aux);
        ratio = this.resolveOpposeStatValue('warCriticalRatio', ratio, aux);
        return ratio;
    }

    public override getComputedAvoidRatio(): number {
        const oppose = this.getOppose();
        let avoidRatio = this.getCrewType().avoid / 100;
        avoidRatio *= this.getComputedTrain() / 100;

        const aux = {
            isAttacker: this.isAttacker(),
            leadership: this.getComputedStat('leadership', this.general.stats.leadership),
        };
        avoidRatio = this.actionPipeline.onCalcStat(this.getActionContext(), 'warAvoidRatio', avoidRatio, aux);
        avoidRatio = this.resolveOpposeStatValue('warAvoidRatio', avoidRatio, aux);

        if (oppose && oppose.getCrewType().armType === this.config.armTypes.footman) {
            avoidRatio *= 0.75;
        }

        return avoidRatio;
    }

    public override addTrain(train: number): void {
        this.general.train = clamp(this.general.train + train, 0, this.config.maxTrainByWar);
    }

    public override addAtmos(atmos: number): void {
        this.general.atmos = clamp(this.general.atmos + atmos, 0, this.config.maxAtmosByWar);
    }

    public override addWin(): void {
        increaseMetaNumber(this.general.meta, RANK_KILLNUM, 1);

        if (isCityUnit(this.oppose)) {
            increaseMetaNumber(this.general.meta, RANK_OCCUPIED, 1);
        }

        const atmosMultiplier = this.isAttacker() ? 1.1 : 1.05;
        this.general.atmos = clamp(Math.round(this.general.atmos * atmosMultiplier), 0, this.config.maxAtmosByWar);

        this.addStatExp(1);
    }

    public override addLose(): void {
        increaseMetaNumber(this.general.meta, RANK_DEATHNUM, 1);
        this.addStatExp(1);
    }

    public addStatExp(value = 1): void {
        const armType = this.getCrewType().armType;
        if (armType === this.config.armTypes.wizard) {
            increaseMetaNumber(this.general.meta, META_INTEL_EXP, value);
            return;
        }
        if (armType === this.config.armTypes.siege) {
            increaseMetaNumber(this.general.meta, META_LEADERSHIP_EXP, value);
            return;
        }
        increaseMetaNumber(this.general.meta, META_STRENGTH_EXP, value);
    }

    public addLevelExp(value: number): void {
        const previousExpLevel = getMetaNumber(this.general.meta, META_EXP_LEVEL);
        const sideAdjusted = this.isAttacker() ? value : value * 0.8;
        const adjusted = this.actionPipeline.onCalcStat(this.getActionContext(), 'experience', sideAdjusted);
        this.general.experience += adjusted;
        const nextExpLevel =
            this.general.experience < 1000
                ? Math.trunc(this.general.experience / 100)
                : Math.trunc(Math.sqrt(this.general.experience / 10));
        const resolvedExpLevel = clamp(nextExpLevel, 0, MAX_EXP_LEVEL);
        this.general.meta[META_EXP_LEVEL] = resolvedExpLevel;
        if (resolvedExpLevel === previousExpLevel) {
            return;
        }
        const josaRo = JosaUtil.pick(String(resolvedExpLevel), '로');
        this.logger.pushGeneralActionLog(
            resolvedExpLevel > previousExpLevel
                ? `<C>Lv ${resolvedExpLevel}</>${josaRo} <C>레벨업</>!`
                : `<C>Lv ${resolvedExpLevel}</>${josaRo} <R>레벨다운</>!`,
            LogFormat.PLAIN
        );
    }

    public addDedication(value: number): void {
        this.general.dedication += value;
    }

    public addDex(crewType: WarCrewType, exp: number): void {
        const armType =
            crewType.armType === this.config.armTypes.castle
                ? (this.config.armTypes.siege ?? crewType.armType)
                : crewType.armType;
        const key = `${META_DEX_PREFIX}${armType}`;
        const base = getMetaNumber(this.general.meta, key);
        let nextExp = exp;
        if (armType === this.config.armTypes.wizard || armType === this.config.armTypes.siege) {
            nextExp *= 0.9;
        }
        const adjustedExp = this.actionPipeline.onCalcStat(this.getActionContext(), 'addDex', nextExp, { armType });
        this.general.meta[key] = base + adjustedExp;
    }

    public calcRiceConsumption(damage: number): number {
        let rice = damage / 100;
        if (!this.isAttacker()) {
            rice *= 0.8;
        }
        if (isCityUnit(this.oppose)) {
            rice *= 0.8;
        }
        rice *= this.getCrewType().rice;
        rice *= getTechCost(resolveNationTech(this.nation));
        rice = this.actionPipeline.onCalcStat(this.getActionContext(), 'killRice', rice);
        return rice;
    }

    public override increaseKilled(damage: number): number {
        this.addLevelExp(damage / 50);

        const rice = this.calcRiceConsumption(damage);
        this.general.rice = clampMin(this.general.rice - rice, 0);

        let addDex = damage;
        if (!this.isAttacker()) {
            addDex *= 0.8;
        }
        this.addDex(this.getCrewType(), addDex);

        this.killed += damage;
        this.killedCurr += damage;

        if (this.oppose instanceof WarUnitGeneral) {
            this.killedPerson += damage;
        }
        return this.killed;
    }

    public override getHP(): number {
        return this.general.crew;
    }

    public override decreaseHP(damage: number): number {
        const maxDamage = Math.min(damage, this.general.crew);

        this.dead += maxDamage;
        this.deadCurr += maxDamage;
        this.general.crew -= maxDamage;

        let addDex = maxDamage;
        if (!this.isAttacker()) {
            addDex *= 0.1;
        }
        if (this.oppose) {
            this.addDex(this.oppose.getCrewType(), addDex);
        }

        if (this.oppose instanceof WarUnitGeneral) {
            this.deadPerson += maxDamage;
        }

        return this.general.crew;
    }

    public override computeWarPower(): [number, number] {
        const [warPower, opposeWarPowerMultiply] = super.computeWarPower();
        const oppose = this.getOppose();
        if (!oppose) {
            return [warPower, opposeWarPowerMultiply];
        }

        const expLevel = getMetaNumber(this.general.meta, META_EXP_LEVEL, 0);
        let nextWarPower = warPower;
        let nextOpposeMultiply = opposeWarPowerMultiply;

        if (isCityUnit(oppose)) {
            nextWarPower *= 1 + expLevel / 600;
        } else {
            const ratio = clampMin(1 - expLevel / 300, 0.01);
            nextWarPower /= ratio;
            nextOpposeMultiply *= ratio;
        }

        const [myMul, opposeMul] = this.actionPipeline.getWarPowerMultiplier(this.getActionContext(), this, oppose);
        nextWarPower *= myMul;
        nextOpposeMultiply *= opposeMul;

        this.warPower = nextWarPower;
        oppose.setWarPowerMultiply(nextOpposeMultiply);
        return [nextWarPower, nextOpposeMultiply];
    }

    public override criticalDamage(): number {
        let range: [number, number] = WAR_CRITICAL_RANGE;
        range = this.actionPipeline.onCalcStat(this.getActionContext(), 'criticalDamageRange', range);
        return this.rng.nextRange(...range);
    }

    public override tryWound(): boolean {
        if (this.hasActivatedSkillOnLog('부상무효')) {
            return false;
        }
        if (this.hasActivatedSkillOnLog('퇴각부상무효')) {
            return false;
        }
        if (!this.rng.nextBool(0.05)) {
            return false;
        }

        this.activateSkill('부상');
        this.general.injury = clamp(this.general.injury + this.rng.nextRangeInt(10, 80), 0, 80);
        this.logger.pushGeneralActionLog('전투중 <R>부상</>당했다!', LogFormat.PLAIN);
        return true;
    }

    public override continueWar(): { canContinue: boolean; noRice: boolean } {
        if (this.general.crew <= 0) {
            return { canContinue: false, noRice: false };
        }
        if (this.general.rice <= this.general.crew / 100) {
            return { canContinue: false, noRice: true };
        }
        return { canContinue: true, noRice: false };
    }

    public override finishBattle(): void {
        if (this.isFinished) {
            return;
        }
        this.clearActivatedSkill();
        this.isFinished = true;

        increaseMetaNumber(this.general.meta, RANK_KILLCREW, this.killed);
        increaseMetaNumber(this.general.meta, RANK_DEATHCREW, this.dead);

        if (this.killedPerson) {
            increaseMetaNumber(this.general.meta, RANK_KILLCREW_PERSON, this.killedPerson);
        }
        if (this.deadPerson) {
            increaseMetaNumber(this.general.meta, RANK_DEATHCREW_PERSON, this.deadPerson);
        }

        this.general.rice = round(this.general.rice);
        this.general.experience = round(this.general.experience);
        this.general.dedication = round(this.general.dedication);
    }
}
