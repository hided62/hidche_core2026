import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    remainCityCapacityByMax,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import { clamp } from 'es-toolkit';
import type { GeneralTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';

export interface SettlementArgs {}
type SettlementPick = 'success' | 'normal' | 'fail';

const pickByWeight = <T extends string>(rng: GeneralActionResolveContext['rng'], weights: Record<T, number>): T => {
    const entries = Object.entries(weights) as Array<[T, number]>;
    const first = entries[0];
    if (!first) {
        throw new Error('Empty weights');
    }

    let total = 0;
    for (const [, weight] of entries) {
        if (weight > 0) {
            total += weight;
        }
    }
    if (total <= 0) {
        return first[0];
    }

    let cursor = rng.nextFloat1() * total;
    for (const [key, weight] of entries) {
        if (weight <= 0) {
            continue;
        }
        cursor -= weight;
        if (cursor <= 0) {
            return key;
        }
    }

    const last = entries[entries.length - 1];
    return last ? last[0] : first[0];
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SettlementArgs> {
    public readonly key = 'che_정착장려';
    public readonly name = '정착 장려';
    private readonly env: { develCost?: number };

    constructor(env: { develCost?: number } = {}) {
        this.env = env;
    }

    parseArgs(_raw: unknown): SettlementArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: SettlementArgs): Constraint[] {
        const getRequiredRice = (_context: ConstraintContext, _view: StateView): number =>
            (this.env.develCost ?? 0) * 2;

        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            suppliedCity(),
            remainCityCapacityByMax('population', 'populationMax', '인구'),
            reqGeneralRice(getRequiredRice),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: SettlementArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const city = context.city;
        if (!city) {
            context.addLog('도시 정보를 찾지 못했습니다.');
            return { effects: [] };
        }

        const pick = pickByWeight<SettlementPick>(context.rng, {
            fail: 0.2,
            success: 0.2,
            normal: 0.6,
        });

        const scoreCoef = pick === 'success' ? 1.3 : pick === 'fail' ? 0.7 : 1;
        const baseAmount = Math.round(1000 * scoreCoef);
        const current = city.population;
        const max = city.populationMax;

        const nextValue = clamp(current + baseAmount, 0, max);
        const costRice = (this.env.develCost ?? 0) * 2;

        city.population = nextValue;
        general.rice = Math.max(0, general.rice - costRice);

        const scoreText = (nextValue - current).toLocaleString();
        const logName = this.name.replace(' ', '');
        const josaUl = JosaUtil.pick(logName, '을');
        if (pick === 'fail') {
            context.addLog(
                `${logName}${josaUl} <span class='ev_failed'>실패</span>하여 주민이 <C>${scoreText}</>명 증가했습니다.`
            );
        } else if (pick === 'success') {
            context.addLog(`${logName}${josaUl} <S>성공</>하여 주민이 <C>${scoreText}</>명 증가했습니다.`);
        } else {
            context.addLog(`${logName}${josaUl} 하여 주민이 <C>${scoreText}</>명 증가했습니다.`);
        }
        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: '정착 장려' });

        return { effects: [] };
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_정착장려',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition({ develCost: env.develCost }),
};
