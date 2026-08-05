import { JosaUtil } from '@sammo-ts/common';

import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitCity, WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';
import type { WarTriggerModule } from './types.js';

const MAGIC_TO_GENERAL = {
    위보: [1.2, 1.1],
    매복: [1.4, 1.2],
    반목: [1.6, 1.3],
    화계: [1.8, 1.4],
    혼란: [2.0, 1.5],
} as const;

const MAGIC_TO_CITY = {
    급습: [1.2, 1.1],
    위보: [1.4, 1.2],
    혼란: [1.6, 1.3],
} as const;

type MagicState = [name: string, damage: number];

const applyMagicDamageModifiers = (
    self: WarUnitGeneral,
    oppose: WarUnit,
    statName: 'warMagicSuccessDamage' | 'warMagicFailDamage',
    damage: number,
    magic: string
): number => {
    let result = self.getActionPipeline().onCalcStat(self.getActionContext(), statName, damage, magic);
    if (oppose instanceof WarUnitGeneral) {
        result = oppose.getActionPipeline().onCalcOpposeStat(oppose.getActionContext(), statName, result, magic);
    }
    return result;
};

export class che_계략시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Pre + 300);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!(self instanceof WarUnitGeneral) || self.hasActivatedSkill('계략불가')) return true;

        const general = self.getGeneral();
        let trialProbability =
            (self.getComputedStat('intelligence', general.stats.intelligence, { truncate: false }) / 100) *
            self.getCrewType().magicCoef;
        trialProbability = self
            .getActionPipeline()
            .onCalcStat(self.getActionContext(), 'warMagicTrialProb', trialProbability);
        if (oppose instanceof WarUnitGeneral) {
            trialProbability = oppose
                .getActionPipeline()
                .onCalcOpposeStat(oppose.getActionContext(), 'warMagicTrialProb', trialProbability);
        }
        if (trialProbability <= 0) return true;

        const rawIntelligence = general.stats.intelligence;
        const allRawStats = general.stats.leadership + general.stats.strength + rawIntelligence;
        if (self.getPhase() === 0 && rawIntelligence * 3 >= allRawStats) {
            trialProbability *= 3;
        }
        if (!self.rng.nextBool(trialProbability)) return true;

        let successProbability = 0.7;
        successProbability = self
            .getActionPipeline()
            .onCalcStat(self.getActionContext(), 'warMagicSuccessProb', successProbability);
        if (oppose instanceof WarUnitGeneral) {
            successProbability = oppose
                .getActionPipeline()
                .onCalcOpposeStat(oppose.getActionContext(), 'warMagicSuccessProb', successProbability);
        }

        const table = oppose instanceof WarUnitCity ? MAGIC_TO_CITY : MAGIC_TO_GENERAL;
        const magic = self.rng.choice(Object.keys(table));
        const [rawSuccessDamage, failDamage] = table[magic as keyof typeof table];
        const successDamage = applyMagicDamageModifiers(
            self,
            oppose,
            'warMagicSuccessDamage',
            rawSuccessDamage,
            magic
        );

        self.activateSkill('계략시도', magic);
        if (self.rng.nextBool(successProbability)) {
            self.activateSkill('계략');
            selfEnv['magic'] = [magic, successDamage] satisfies MagicState;
        } else {
            self.activateSkill('계략실패');
            selfEnv['magic'] = [magic, failDamage] satisfies MagicState;
        }
        return true;
    }
}

const readMagic = (env: Record<string, unknown>): MagicState | null => {
    const value = env['magic'];
    if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'number') return null;
    return [value[0], value[1]];
};

export class che_계략발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 300);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!(self instanceof WarUnitGeneral) || !self.hasActivatedSkill('계략') || selfEnv['계략발동']) return true;
        const magicState = readMagic(selfEnv);
        if (!magicState) return true;
        selfEnv['계략발동'] = true;
        const [magic, rawDamage] = magicState;
        const damage = applyMagicDamageModifiers(self, oppose, 'warMagicFailDamage', rawDamage, magic);
        const particle = JosaUtil.pick(magic, '을');
        self.getLogger().pushGeneralBattleDetailLog(`<D>${magic}</>${particle} <C>성공</>했다!`, LogFormat.PLAIN);
        oppose.getLogger().pushGeneralBattleDetailLog(`<D>${magic}</>에 당했다!`, LogFormat.PLAIN);
        self.multiplyWarPowerMultiply(damage);
        return true;
    }
}

export class che_계략실패 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 300);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!(self instanceof WarUnitGeneral) || !self.hasActivatedSkill('계략실패') || selfEnv['계략실패']) return true;
        const magicState = readMagic(selfEnv);
        if (!magicState) return true;
        selfEnv['계략실패'] = true;
        const [magic, rawDamage] = magicState;
        const damage = applyMagicDamageModifiers(self, oppose, 'warMagicFailDamage', rawDamage, magic);
        const particle = JosaUtil.pick(magic, '을');
        self.getLogger().pushGeneralBattleDetailLog(`<D>${magic}</>${particle} <R>실패</>했다!`, LogFormat.PLAIN);
        oppose.getLogger().pushGeneralBattleDetailLog(`<D>${magic}</>${particle} 간파했다!`, LogFormat.PLAIN);
        self.multiplyWarPowerMultiply(1 / damage);
        oppose.multiplyWarPowerMultiply(damage);
        return true;
    }
}

export const triggerModule: WarTriggerModule = {
    key: 'che_계략',
    name: '계략',
    info: '[전투] 귀병의 계략 시도/성공/실패',
    createTriggerList: (unit) =>
        new WarTriggerCaller(new che_계략시도(unit), new che_계략발동(unit), new che_계략실패(unit)),
};
