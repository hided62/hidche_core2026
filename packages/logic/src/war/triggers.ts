import type { RandUtil } from '@sammo-ts/common';

import { TriggerCaller, type Trigger } from '@sammo-ts/logic/triggers/core.js';
import type { WarUnit } from './units.js';

export interface WarTriggerContext {
    rng: RandUtil;
    attacker: WarUnit;
    defender: WarUnit;
}

export interface WarTriggerEnv {
    e_attacker: Record<string, unknown>;
    e_defender: Record<string, unknown>;
    stopNextAction?: boolean;
}

export type WarTrigger = Trigger<WarTriggerContext, WarTriggerEnv>;

export const createWarTriggerEnv = (): WarTriggerEnv => ({
    e_attacker: {},
    e_defender: {},
});

export class WarTriggerCaller extends TriggerCaller<WarTriggerContext, WarTriggerEnv> {}

export type WarTriggerFactory = (unit: WarUnit) => WarTrigger | WarTriggerCaller | null;

export type WarTriggerRegistry = Record<string, WarTriggerFactory>;

// 전투 트리거 공통 베이스. 전투 유닛 기준으로 동작하며, env는 공격/수비 분리 상태를 유지한다.
export abstract class BaseWarUnitTrigger implements WarTrigger {
    public static readonly TYPE_NONE = 0;
    public static readonly TYPE_ITEM = 1;
    public static readonly TYPE_CONSUMABLE_ITEM = 1 | 2;
    public static readonly TYPE_DEDUP_TYPE_BASE = 1024;

    protected readonly raiseType: number;

    protected constructor(
        protected readonly unit: WarUnit,
        public readonly priority: number,
        raiseType = BaseWarUnitTrigger.TYPE_NONE
    ) {
        this.raiseType = raiseType;
    }

    get uniqueId(): string {
        return `${this.priority}_${this.constructor.name}_${this.unit.getUnitId()}_${this.raiseType}`;
    }

    action(context: WarTriggerContext, env: WarTriggerEnv): WarTriggerEnv {
        const nextEnv: WarTriggerEnv = {
            e_attacker: env.e_attacker ?? {},
            e_defender: env.e_defender ?? {},
            ...(env.stopNextAction ? { stopNextAction: true } : {}),
        };

        if (nextEnv.stopNextAction) {
            return nextEnv;
        }

        const self = this.unit;
        const isAttacker = self.isAttacker();
        const oppose = isAttacker ? context.defender : context.attacker;

        const selfEnv = isAttacker ? nextEnv.e_attacker : nextEnv.e_defender;
        const opposeEnv = isAttacker ? nextEnv.e_defender : nextEnv.e_attacker;

        const shouldContinue = this.actionWar(self, oppose, selfEnv, opposeEnv);

        nextEnv.e_attacker = isAttacker ? selfEnv : opposeEnv;
        nextEnv.e_defender = isAttacker ? opposeEnv : selfEnv;

        if (!shouldContinue) {
            nextEnv.stopNextAction = true;
        }

        return nextEnv;
    }

    // 실제 트리거 구현부는 여기서 처리한다.
    protected abstract actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        opposeEnv: Record<string, unknown>
    ): boolean;

    // 아이템 소모 트리거는 아직 미구현. 필요 시 raiseType을 활용해 확장 가능하다.
    public processConsumableItem(): boolean {
        if (!(this.raiseType & BaseWarUnitTrigger.TYPE_ITEM)) {
            return false;
        }
        return false;
    }
}
