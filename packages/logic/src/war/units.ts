import type { RandUtil } from '@sammo-ts/common';

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
import type { WarActionPipeline, WarActionContext } from './actions.js';
import type { WarEngineConfig } from './types.js';
import type { WarCrewType } from './crewType.js';
import {
    clamp,
    clampMin,
    getDexLog,
    getMetaNumber,
    getMetaString,
    increaseMetaNumber,
    round,
    sortConflict,
    parseConflict,
    stringifyConflict,
} from './utils.js';

const META_EXP_LEVEL = 'explevel';
const META_TURN_TIME = 'turnTime';
const META_RECENT_WAR = 'recentWar';
const META_DEX_PREFIX = 'dex';
const META_RANK_PREFIX = 'rank_';
const META_INTEL_EXP = 'intelExp';
const META_STRENGTH_EXP = 'strengthExp';
const META_LEADERSHIP_EXP = 'leadershipExp';

const RANK_WARNUM = `${META_RANK_PREFIX}warnum`;
const RANK_KILLNUM = `${META_RANK_PREFIX}killnum`;

const toDexStatName = (armType: number): WarStatName => `dex${armType}` as WarStatName;
const RANK_DEATHNUM = `${META_RANK_PREFIX}deathnum`;
const RANK_OCCUPIED = `${META_RANK_PREFIX}occupied`;
const RANK_KILLCREW = `${META_RANK_PREFIX}killcrew`;
const RANK_DEATHCREW = `${META_RANK_PREFIX}deathcrew`;
const RANK_KILLCREW_PERSON = `${META_RANK_PREFIX}killcrew_person`;
const RANK_DEATHCREW_PERSON = `${META_RANK_PREFIX}deathcrew_person`;

const WAR_CRITICAL_RANGE: [number, number] = [1.3, 2.0];

const resolveNationTech = (nation: Nation | null): number => (nation ? getMetaNumber(nation.meta, 'tech', 0) : 0);

const resolveNationVar = (nation: Nation | null, key: string): TriggerValue | null => {
    if (!nation) {
        return null;
    }
    switch (key) {
        case 'nation':
            return nation.id;
        case 'name':
            return nation.name;
        case 'capital':
            return nation.capitalCityId ?? 0;
        case 'gold':
            return nation.gold;
        case 'rice':
            return nation.rice;
        case 'tech':
            return resolveNationTech(nation);
        case 'type':
            return nation.typeCode;
        default:
            return nation.meta[key] ?? null;
    }
};

// 전투 유닛 공통 상태와 수치 계산(legacy WarUnit 계열 포팅).
export abstract class WarUnit<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private static nextUnitId = 1;
    private readonly unitId: number;

    protected oppose: WarUnit<TriggerState> | null = null;
    protected killedCurr = 0;
    protected killed = 0;
    protected deadCurr = 0;
    protected dead = 0;

    protected currPhase = 0;
    protected prePhase = 0;
    protected bonusPhase = 0;

    protected atmosBonus = 0;
    protected trainBonus = 0;

    protected warPower = 0;
    protected warPowerMultiply = 1;

    protected activatedSkill: Record<string, boolean> = {};
    protected logActivatedSkill: Record<string, number> = {};
    protected isFinished = false;

    protected constructor(
        public readonly rng: RandUtil,
        protected readonly config: WarEngineConfig,
        protected readonly crewType: WarCrewType,
        protected readonly logger: ActionLogger,
        protected readonly attacker: boolean,
        protected readonly nation: Nation | null
    ) {
        this.unitId = WarUnit.nextUnitId;
        WarUnit.nextUnitId += 1;
    }

    // 전투 유닛 식별자(트리거 dedup에 사용).
    public getUnitId(): number {
        return this.unitId;
    }

    public getGameConfig(): WarEngineConfig {
        return this.config;
    }

    public getNationVar(key: string): TriggerValue | null {
        return resolveNationVar(this.nation, key);
    }

    public getRawNation(): Nation | null {
        return this.nation;
    }

    public getPhase(): number {
        return this.currPhase;
    }

    public getRealPhase(): number {
        return this.prePhase + this.currPhase;
    }

    public getCrewType(): WarCrewType {
        return this.crewType;
    }

    public getCrewTypeName(): string {
        return this.crewType.name;
    }

    public getCrewTypeShortName(): string {
        return this.crewType.getShortName();
    }

    public getLogger(): ActionLogger {
        return this.logger;
    }

    public getKilled(): number {
        return this.killed;
    }

    public getDead(): number {
        return this.dead;
    }

    public getKilledCurrentBattle(): number {
        return this.killedCurr;
    }

    public getDeadCurrentBattle(): number {
        return this.deadCurr;
    }

    public isAttacker(): boolean {
        return this.attacker;
    }

    public getMaxPhase(): number {
        return this.getCrewType().speed + this.bonusPhase;
    }

    public setPrePhase(phase: number): void {
        this.prePhase = phase;
    }

    public addPhase(phase = 1): void {
        this.currPhase += phase;
    }

    public addBonusPhase(count: number): void {
        this.bonusPhase += count;
    }

    public setOppose(oppose: WarUnit<TriggerState> | null): void {
        this.oppose = oppose;
        this.killedCurr = 0;
        this.deadCurr = 0;
        this.clearActivatedSkill();
    }

    public getOppose(): WarUnit<TriggerState> | null {
        return this.oppose;
    }

    public getWarPower(): number {
        return this.warPower * this.warPowerMultiply;
    }

    public getWarPowerMultiply(): number {
        return this.warPowerMultiply;
    }

    public setWarPowerMultiply(multiply = 1): void {
        this.warPowerMultiply = multiply;
    }

    public multiplyWarPowerMultiply(multiply: number): void {
        this.warPowerMultiply *= multiply;
    }

    public getRawWarPower(): number {
        return this.warPower;
    }

    protected clearActivatedSkill(): void {
        for (const [skillName, state] of Object.entries(this.activatedSkill)) {
            if (!state) {
                continue;
            }
            this.logActivatedSkill[skillName] = (this.logActivatedSkill[skillName] ?? 0) + 1;
        }
        this.activatedSkill = {};
    }

    public hasActivatedSkill(skillName: string): boolean {
        return Boolean(this.activatedSkill[skillName]);
    }

    public hasActivatedSkillOnLog(skillName: string): number {
        return (this.logActivatedSkill[skillName] ?? 0) + (this.hasActivatedSkill(skillName) ? 1 : 0);
    }

    public getActivatedSkillLog(): Record<string, number> {
        const snapshot: Record<string, number> = { ...this.logActivatedSkill };
        for (const [skillName, active] of Object.entries(this.activatedSkill)) {
            if (!active) {
                continue;
            }
            snapshot[skillName] = (snapshot[skillName] ?? 0) + 1;
        }
        return snapshot;
    }

    public activateSkill(...skillNames: string[]): void {
        for (const skillName of skillNames) {
            this.activatedSkill[skillName] = true;
        }
    }

    public deactivateSkill(...skillNames: string[]): void {
        for (const skillName of skillNames) {
            this.activatedSkill[skillName] = false;
        }
    }

    public beginPhase(): void {
        this.clearActivatedSkill();
        this.computeWarPower();
    }

    public computeWarPower(): [number, number] {
        const oppose = this.getOppose();
        if (!oppose) {
            return [0, 1];
        }

        const myAttack = this.getComputedAttack();
        const opposeDef = oppose.getComputedDefence();

        let warPower = this.config.armPerPhase + myAttack - opposeDef;
        let opposeWarPowerMultiply = 1;

        if (warPower < 100) {
            warPower = clampMin(warPower, 0);
            warPower = (warPower + 100) / 2;
            warPower = this.rng.nextRangeInt(warPower, 100);
        }

        warPower *= this.getComputedAtmos();
        warPower /= oppose.getComputedTrain();

        const myDex = this.getDex(this.getCrewType());
        const opposeDex = oppose.getDex(this.getCrewType());
        warPower *= getDexLog(myDex, opposeDex);

        warPower *= this.getCrewType().getAttackCoef(oppose.getCrewType());
        opposeWarPowerMultiply *= this.getCrewType().getDefenceCoef(oppose.getCrewType());

        this.warPower = warPower;
        oppose.setWarPowerMultiply(opposeWarPowerMultiply);

        return [warPower, opposeWarPowerMultiply];
    }

    public addTrain(_train: number): void {
        return;
    }

    public addAtmos(_atmos: number): void {
        return;
    }

    public addTrainBonus(trainBonus: number): void {
        this.trainBonus += trainBonus;
    }

    public addAtmosBonus(atmosBonus: number): void {
        this.atmosBonus += atmosBonus;
    }

    public getComputedTrain(): number {
        return this.config.maxTrainByCommand;
    }

    public getComputedAtmos(): number {
        return this.config.maxAtmosByCommand;
    }

    public getComputedCriticalRatio(): number {
        return 0;
    }

    public getComputedAvoidRatio(): number {
        return this.getCrewType().avoid / 100;
    }

    public addWin(): void {
        return;
    }

    public addLose(): void {
        return;
    }

    public calcDamage(): number {
        const warPower = this.getWarPower() * this.rng.nextRange(0.9, 1.1);
        return round(warPower);
    }

    public criticalDamage(): number {
        return this.rng.nextRange(...WAR_CRITICAL_RANGE);
    }

    public logBattleResult(): void {
        const oppose = this.getOppose();
        if (!oppose || !this.logger) {
            return;
        }

        const warTypeStr = this.isAttacker() ? '→' : '←';
        const message = `${this.getCrewTypeShortName()} ${this.getName()} ${warTypeStr} ${oppose.getCrewTypeShortName()} ${oppose.getName()} (${this.getHP()} / ${oppose.getHP()})`;
        this.logger.pushGeneralBattleResultLog(message, LogFormat.EVENT_YEAR_MONTH);
        this.logger.pushGeneralBattleDetailLog(message, LogFormat.EVENT_YEAR_MONTH);
        this.logger.pushGeneralActionLog(message, LogFormat.EVENT_YEAR_MONTH);
    }

    public tryWound(): boolean {
        return false;
    }

    public continueWar(): { canContinue: boolean; noRice: boolean } {
        return { canContinue: false, noRice: false };
    }

    public abstract getName(): string;

    public abstract getDex(crewType: WarCrewType): number;

    public abstract getComputedAttack(): number;

    public abstract getComputedDefence(): number;

    public abstract getHP(): number;

    public abstract decreaseHP(damage: number): number;

    public abstract increaseKilled(damage: number): number;

    public abstract finishBattle(): void;
}

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
            ? getMetaString(this.general.meta, META_TURN_TIME)
            : oppose instanceof WarUnitGeneral
              ? getMetaString(oppose.general.meta, META_TURN_TIME)
              : getMetaString(this.general.meta, META_TURN_TIME);
        if (!baseTurnTime) {
            return;
        }

        const base = baseTurnTime.slice(0, Math.max(0, baseTurnTime.length - 2));
        const phase = clamp(this.getRealPhase(), 0, 99);
        const phaseText = phase.toString().padStart(2, '0');
        this.general.meta[META_RECENT_WAR] = `${base}${phaseText}`;
    }

    public override getMaxPhase(): number {
        const base = this.getCrewType().speed;
        const aux = { isAttacker: this.isAttacker() };
        const context = this.getActionContext();
        const phase = this.actionPipeline.onCalcStat(context, 'initWarPhase', base, aux);
        return phase + this.bonusPhase;
    }

    private resolveStatValue(statName: keyof StatBlock, base: number): number {
        return this.actionPipeline.onCalcStat(this.getActionContext(), statName, base);
    }

    private resolveMainStat(armType: number): number {
        const leadership = this.resolveStatValue('leadership', this.general.stats.leadership);
        const strength = this.resolveStatValue('strength', this.general.stats.strength);
        const intelligence = this.resolveStatValue('intelligence', this.general.stats.intelligence);

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
        return oppose.getActionPipeline().onCalcOpposeStat(this.getActionContext(), statName, value, aux);
    }

    public override getDex(crewType: WarCrewType): number {
        const armType =
            crewType.armType === this.config.armTypes.castle
                ? (this.config.armTypes.siege ?? crewType.armType)
                : crewType.armType;
        const base = getMetaNumber(this.general.meta, `${META_DEX_PREFIX}${armType}`);
        const aux = {
            isAttacker: this.isAttacker(),
            opposeType: this.oppose?.getCrewType() ?? null,
        };
        const statName = toDexStatName(armType);
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

        const mainStat = this.resolveMainStat(armType);
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

        const aux = { isAttacker: this.isAttacker() };
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

        if (this.oppose instanceof WarUnitCity) {
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
        const adjust = this.isAttacker() ? value : value * 0.8;
        this.general.experience += adjust;
    }

    public addDedication(value: number): void {
        this.general.dedication += value;
    }

    public addDex(crewType: WarCrewType, exp: number): void {
        const armType = crewType.armType;
        const key = `${META_DEX_PREFIX}${armType}`;
        const base = getMetaNumber(this.general.meta, key);
        this.general.meta[key] = round(base + exp);
    }

    public calcRiceConsumption(damage: number): number {
        let rice = damage / 100;
        if (!this.isAttacker()) {
            rice *= 0.8;
        }
        if (this.oppose instanceof WarUnitCity) {
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

        if (oppose instanceof WarUnitCity) {
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

// 도시 성벽 전투 유닛(legacy WarUnitCity 포팅).
export class WarUnitCity extends WarUnit {
    private hp: number;
    private cityTrainAtmos: number;
    private onSiege = false;

    constructor(
        rng: RandUtil,
        config: WarEngineConfig,
        private readonly city: City,
        nation: Nation | null,
        crewType: WarCrewType,
        logger: ActionLogger,
        year: number,
        startYear: number
    ) {
        super(rng, config, crewType, logger, false, nation);
        this.cityTrainAtmos = clamp(year - startYear + 59, 60, 110);
        this.hp = this.city.defence * 10;

        if (this.city.level === 1 || this.city.level === 3) {
            this.trainBonus += 5;
        }
    }

    public getCityTrainAtmos(): number {
        return this.cityTrainAtmos;
    }

    public getCityId(): number {
        return this.city.id;
    }

    public override getName(): string {
        return this.city.name;
    }

    public override getComputedAttack(): number {
        return (this.city.defence + this.city.wall * 9) / 500 + 200;
    }

    public override getComputedDefence(): number {
        return (this.city.defence + this.city.wall * 9) / 500 + 200;
    }

    public override increaseKilled(damage: number): number {
        this.killed += damage;
        this.killedCurr += damage;
        return this.killed;
    }

    public override getComputedTrain(): number {
        return this.cityTrainAtmos + this.trainBonus;
    }

    public override getComputedAtmos(): number {
        return this.cityTrainAtmos + this.atmosBonus;
    }

    public override getHP(): number {
        return this.hp;
    }

    public setSiege(): void {
        this.onSiege = true;
        this.currPhase = 0;
        this.prePhase = 0;
        this.bonusPhase = 0;
        this.isFinished = false;
    }

    public isSiege(): boolean {
        return this.onSiege;
    }

    public override getDex(_crewType: WarCrewType): number {
        return (this.cityTrainAtmos - 60) * 7200;
    }

    public override decreaseHP(damage: number): number {
        const applied = Math.min(damage, this.hp);
        this.dead += applied;
        this.deadCurr += applied;
        this.hp -= applied;

        this.city.wall = clampMin(this.city.wall - applied / 20, 0);
        return this.hp;
    }

    public override continueWar(): { canContinue: boolean; noRice: boolean } {
        if (!this.onSiege) {
            return { canContinue: false, noRice: false };
        }
        if (this.hp <= 0) {
            return { canContinue: false, noRice: false };
        }
        return { canContinue: true, noRice: false };
    }

    public heavyDecreaseWealth(): void {
        this.city.agriculture = round(this.city.agriculture * 0.5);
        this.city.commerce = round(this.city.commerce * 0.5);
        this.city.security = round(this.city.security * 0.5);
    }

    public override finishBattle(): void {
        this.clearActivatedSkill();
        this.isFinished = true;

        this.city.defence = round(this.hp / 10);
        this.city.wall = round(this.city.wall);

        // legacy에서는 onSiege 전투로 끝난 경우에만 추가 피해 처리했지만,
        // 실제 구현은 이미 return 되도록 되어 있어 그대로 유지한다.
        if (this.isFinished || !this.onSiege) {
            return;
        }

        const decWealth = this.getKilled() / 20;
        this.city.agriculture = clampMin(this.city.agriculture - decWealth, 0);
        this.city.commerce = clampMin(this.city.commerce - decWealth, 0);
        this.city.security = clampMin(this.city.security - decWealth, 0);
    }

    public addConflict(): boolean {
        const raw = this.city.meta.conflict;
        const conflict = parseConflict(raw) ?? {};
        const oppose = this.getOppose();

        const nationId = oppose?.getNationVar('nation');
        if (typeof nationId !== 'number') {
            return false;
        }

        let dead = Math.max(1, this.dead);
        let isNew = false;

        if (Object.keys(conflict).length === 0 || this.getHP() === 0) {
            dead *= 1.05;
        }

        if (conflict[nationId] !== undefined) {
            conflict[nationId] += dead;
        } else {
            conflict[nationId] = dead;
            isNew = true;
        }

        const sorted = sortConflict(conflict);
        this.city.meta.conflict = stringifyConflict(sorted);

        return isNew;
    }

    public override logBattleResult(): void {
        return;
    }
}
