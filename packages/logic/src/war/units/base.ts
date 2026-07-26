import type { RandUtil } from '@sammo-ts/common';

import type { GeneralTriggerState, Nation, TriggerValue } from '@sammo-ts/logic/domain/entities.js';
import type { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { WarEngineConfig } from '../types.js';
import type { WarCrewType } from '../crewType.js';
import { clampMin, getDexLog, getMetaNumber, round } from '../utils.js';

export const WAR_CRITICAL_RANGE: [number, number] = [1.3, 2.0];

export const resolveNationTech = (nation: Nation | null): number =>
    nation ? getMetaNumber(nation.meta, 'tech', 0) : 0;

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

const isCityWarUnit = (unit: WarUnit): boolean =>
    typeof (unit as WarUnit & { getCityId?: unknown }).getCityId === 'function';

const buildLegacySmallWarLog = (me: WarUnit, oppose: WarUnit): string => {
    const warType = !me.isAttacker() ? 'defense' : isCityWarUnit(oppose) ? 'siege' : 'attack';
    const warTypeStr = me.isAttacker() ? '→' : '←';
    return [
        '<div class="small_war_log">        ',
        '<span class="me">        ',
        '<span class="name_plate">            ',
        `<span class="crew_type">${me.getCrewTypeShortName()}</span>            `,
        '<span class="name_plate_cover"                >【',
        `<span class="name">${me.getName()}</span>】            </span>        </span>        `,
        '<span class="crew_plate"            >',
        `<span class="remain_crew">${me.getHP()}</span            >`,
        '<span class="killed_plate">(',
        `<span class="killed_crew">${-me.getDeadCurrentBattle()}</span>)</span        ></span>    </span>    `,
        `<span class="war_type war_type_${warType}">${warTypeStr}</span>    `,
        '<span class="you">        ',
        '<span class="crew_plate"            >',
        `<span class="remain_crew">${oppose.getHP()}</span            >`,
        '<span class="killed_plate">(',
        `<span class="killed_crew">${-oppose.getDeadCurrentBattle()}</span>)</span        ></span>        `,
        '<span class="name_plate">            ',
        `<span class="crew_type">${oppose.getCrewTypeShortName()}</span>            `,
        '<span class="name_plate_cover"                >【',
        `<span class="name">${oppose.getName()}</span>】            </span>        </span>            </span></div>`,
    ].join('');
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
            // PHP의 int parameter coercion은 소수 하한을 0 방향으로 절삭한다.
            warPower = this.rng.nextRangeInt(Math.trunc(warPower), 100);
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

        const message = buildLegacySmallWarLog(this, oppose);
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
