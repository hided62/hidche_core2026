import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    remainCityCapacity,
    reqGeneralGold,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import {
    actionContextBuilder,
    buildDomesticContextFromView,
    CommandResolver,
    type DomesticActionContext,
    type InvestmentConfig,
    updateDomesticCriticalMeta,
} from './che_상업투자.js';
import { JosaUtil } from '@sammo-ts/common';
import { clamp } from 'es-toolkit';

export interface SettlementArgs {}

const ACTION_NAME = '정착 장려';
const CONFIG: InvestmentConfig = {
    key: 'che_정착장려',
    name: ACTION_NAME,
    actionKey: '인구',
    statKey: 'leadership',
    statExpKey: 'leadership_exp',
    cityKey: 'commerce',
    cityMaxKey: 'commerceMax',
    frontDebuff: 1,
    useCityTrust: false,
    scaleSuccessByTrust: false,
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SettlementArgs> {
    public readonly key = CONFIG.key;
    public readonly name = ACTION_NAME;
    private readonly command: CommandResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.command = new CommandResolver(
            env.generalActionModules ?? [],
            { ...env, develCost: env.develCost * 2 },
            CONFIG
        );
    }

    parseArgs(_raw: unknown): SettlementArgs | null {
        return {};
    }

    buildConstraints(ctx: ConstraintContext, _args: SettlementArgs): Constraint[] {
        const requirements: RequirementKey[] = [];
        if (ctx.cityId !== undefined) requirements.push({ kind: 'city', id: ctx.cityId });
        if (ctx.nationId !== undefined) requirements.push({ kind: 'nation', id: ctx.nationId });
        const getRiceCost = (context: ConstraintContext, view: StateView): number => {
            const domesticContext = buildDomesticContextFromView<TriggerState>(context, view);
            return domesticContext ? this.command.getCost(domesticContext).gold : 0;
        };
        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            suppliedCity(),
            reqGeneralGold(() => 0, requirements),
            reqGeneralRice(getRiceCost, requirements),
            remainCityCapacity('population', ACTION_NAME),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: SettlementArgs
    ): GeneralActionOutcome<TriggerState> {
        if (!context.city) {
            context.addLog('도시 정보를 찾지 못했습니다.');
            return { effects: [] };
        }
        const domesticContext = context as DomesticActionContext<TriggerState>;
        const result = this.command.resolve(domesticContext, context.rng);
        const populationGain = result.score * 10;
        context.city.population = clamp(context.city.population + populationGain, 0, context.city.populationMax);
        context.general.rice = Math.max(0, context.general.rice - result.costGold);
        context.general.experience += result.exp;
        context.general.dedication += result.dedication;
        const leadershipExp =
            typeof context.general.meta.leadership_exp === 'number' ? context.general.meta.leadership_exp : 0;
        context.general.meta = updateDomesticCriticalMeta(
            {
                ...context.general.meta,
                leadership_exp: leadershipExp + 1,
            },
            result.pick,
            result.score
        );

        const scoreText = populationGain.toLocaleString();
        const josaUl = JosaUtil.pick(ACTION_NAME, '을');
        if (result.pick === 'fail') {
            context.addLog(
                `${ACTION_NAME}${josaUl} <span class='ev_failed'>실패</span>하여 주민이 <C>${scoreText}</>명 증가했습니다.`
            );
        } else if (result.pick === 'success') {
            context.addLog(`${ACTION_NAME}${josaUl} <S>성공</>하여 주민이 <C>${scoreText}</>명 증가했습니다.`);
        } else {
            context.addLog(`${ACTION_NAME}${josaUl} 하여 주민이 <C>${scoreText}</>명 증가했습니다.`);
        }
        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });
        return { effects: [] };
    }
}

export { actionContextBuilder };

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_정착장려',
    category: '내정',
    reqArg: false,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
