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
import { clamp } from 'es-toolkit';
import type { GeneralTurnCommandSpec } from './index.js';

export interface SettlementArgs {}

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

        const baseAmount = 1000;
        const current = city.population;
        const max = city.populationMax;

        const nextValue = clamp(current + baseAmount, 0, max);
        const costRice = (this.env.develCost ?? 0) * 2;

        city.population = nextValue;
        general.rice = Math.max(0, general.rice - costRice);

        context.addLog(`인구가 ${nextValue - current} 증가했습니다.`);

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
