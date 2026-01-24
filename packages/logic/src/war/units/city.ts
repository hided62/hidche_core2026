import type { RandUtil } from '@sammo-ts/common';

import type { City, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import type { WarEngineConfig } from '../types.js';
import type { WarCrewType } from '../crewType.js';
import { clampMin, round, parseConflict, sortConflict, stringifyConflict } from '../utils.js';
import { WarUnit } from './base.js';

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
        const baseTrainAtmos = year - startYear + 59;
        this.cityTrainAtmos = Math.max(60, Math.min(baseTrainAtmos, 110));
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
