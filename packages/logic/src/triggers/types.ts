import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionContext } from './general.js';
import type { WarActionContext } from '../war/actions.js';
export type TriggerActionType = '장비매매';

export type TriggerActionPhase = '판매' | '구매';

export type TriggerDomesticActionType =
    | '상업'
    | '농업'
    | '성벽'
    | '수비'
    | '치안'
    | '인재탐색'
    | '징병'
    | '징집인구'
    | '계략'
    | '민심'
    | '인구'
    | '기술'
    | '모병'
    | '단련';

export type TriggerDomesticVarType = 'cost' | 'score' | 'success' | 'fail' | 'train' | 'atmos' | 'rice' | 'probability';

export type TriggerStrategicActionType = '의병모집' | '허보' | '필사즉생' | '백성동원' | '이호경식' | '수몰' | '급습';

export type TriggerStrategicVarType = 'delay' | 'globalDelay';

export type TriggerNationalIncomeType = 'gold' | 'rice';

export type GeneralStatName = 'leadership' | 'strength' | 'intelligence' | 'experience' | 'dedication';

export type GeneralStatBundle =
    | { statName: 'leadership'; value: number; aux: undefined; return: number }
    | { statName: 'strength'; value: number; aux: undefined; return: number }
    | { statName: 'intelligence'; value: number; aux: undefined; return: number }
    | { statName: 'experience'; value: number; aux: undefined; return: number }
    | { statName: 'dedication'; value: number; aux: undefined; return: number };

export type GeneralStatBundleMap = {
    [T in GeneralStatBundle as T['statName']]: T;
};

export type WarStatBundle =
    | GeneralStatBundle
    | { statName: 'cityBattleOrder'; value: number; aux: undefined; return: number }
    | { statName: 'initWarPhase'; value: number; aux: { isAttacker: boolean }; return: number }
    | { statName: 'bonusTrain'; value: number; aux: { isAttacker: boolean }; return: number }
    | { statName: 'bonusAtmos'; value: number; aux: { isAttacker: boolean }; return: number }
    | { statName: 'warCriticalRatio'; value: number; aux: { isAttacker: boolean }; return: number }
    | { statName: 'warAvoidRatio'; value: number; aux: { isAttacker: boolean }; return: number }
    | { statName: 'killRice'; value: number; aux: undefined; return: number }
    | { statName: 'criticalDamageRange'; value: [number, number]; aux: undefined; return: [number, number] }
    | { statName: 'warMagicSuccessDamage'; value: number; aux: undefined; return: number }
    | { statName: 'warMagicTrialProb'; value: number; aux: undefined; return: number }
    | { statName: 'warMagicSuccessProb'; value: number; aux: undefined; return: number }
    | {
        statName: `dex${number}`;
        value: number;
        aux: { isAttacker: boolean; opposeType: { armType: number } | null };
        return: number;
    };

export type WarStatBundleMap = {
    [T in WarStatBundle as T['statName']]: T;
};

export type WarStatName = WarStatBundle['statName'];

export interface TraitOnCalcStat<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    <T extends GeneralStatName>(
        context: GeneralActionContext<TriggerState>,
        statName: T,
        value: GeneralStatBundleMap[T]['value'],
        aux?: GeneralStatBundleMap[T]['aux']
    ): GeneralStatBundleMap[T]['return'];
    <T extends WarStatName>(
        context: WarActionContext<TriggerState>,
        statName: T,
        value: WarStatBundleMap[T]['value'],
        aux?: WarStatBundleMap[T]['aux']
    ): WarStatBundleMap[T]['return'];
}

export interface TraitOnCalcOpposeStat<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    <T extends GeneralStatName>(
        context: GeneralActionContext<TriggerState>,
        statName: T,
        value: GeneralStatBundleMap[T]['value'],
        aux?: GeneralStatBundleMap[T]['aux']
    ): GeneralStatBundleMap[T]['return'];
    <T extends WarStatName>(
        context: WarActionContext<TriggerState>,
        statName: T,
        value: WarStatBundleMap[T]['value'],
        aux?: WarStatBundleMap[T]['aux']
    ): WarStatBundleMap[T]['return'];
}

export type TriggerActionType = '장비매매';
