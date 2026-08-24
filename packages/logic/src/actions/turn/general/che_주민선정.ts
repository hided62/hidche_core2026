import type { City, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
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
import { adjustCityTrust, resolveCityTrustValue } from './cityTrust.js';

export interface TrustActionArgs {}

const ACTION_NAME = '주민 선정';
const DEFAULT_TRUST = 50;
const CONFIG: InvestmentConfig = {
    key: 'che_주민선정',
    name: ACTION_NAME,
    actionKey: '민심',
    statKey: 'leadership',
    statExpKey: 'leadership_exp',
    cityKey: 'commerce',
    cityMaxKey: 'commerceMax',
    frontDebuff: 1,
    useCityTrust: false,
    scaleSuccessByTrust: false,
    roundCriticalScore: false,
    costMultiplier: 2,
};

const readTrust = (city: City): number => {
    return resolveCityTrustValue(city.meta.trust, DEFAULT_TRUST);
};

const remainCityTrust = (): Constraint => ({
    name: 'remainCityTrust',
    requires: (ctx) => (ctx.cityId !== undefined ? [{ kind: 'city', id: ctx.cityId }] : []),
    test: (ctx, view) => {
        const city = ctx.cityId !== undefined ? (view.get({ kind: 'city', id: ctx.cityId }) as City | null) : null;
        if (!city) return { kind: 'deny', reason: '도시 정보가 없습니다.' };
        return readTrust(city) >= 100 ? { kind: 'deny', reason: '주민 선정은 충분합니다.' } : { kind: 'allow' };
    },
});

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, TrustActionArgs> {
    public readonly key = CONFIG.key;
    public readonly name = ACTION_NAME;
    private readonly command: CommandResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.command = new CommandResolver(env.generalActionModules ?? [], env, CONFIG);
    }

    parseArgs(_raw: unknown): TrustActionArgs | null {
        return {};
    }

    buildConstraints(ctx: ConstraintContext, _args: TrustActionArgs): Constraint[] {
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
            remainCityTrust(),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: TrustActionArgs
    ): GeneralActionOutcome<TriggerState> {
        if (!context.city) {
            context.addLog('도시 정보를 찾지 못했습니다.');
            return { effects: [] };
        }
        const result = this.command.resolve(context as DomesticActionContext<TriggerState>, context.rng);
        const trustDelta = result.score / 10;
        context.city.meta = {
            ...context.city.meta,
            trust: adjustCityTrust(readTrust(context.city), trustDelta),
        };
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

        const scoreText = trustDelta.toFixed(1);
        const josaUl = JosaUtil.pick(ACTION_NAME, '을');
        if (result.pick === 'fail') {
            context.addLog(
                `${ACTION_NAME}${josaUl} <span class='ev_failed'>실패</span>하여 <C>${scoreText}</> 상승했습니다.`
            );
        } else if (result.pick === 'success') {
            context.addLog(`${ACTION_NAME}${josaUl} <S>성공</>하여 <C>${scoreText}</> 상승했습니다.`);
        } else {
            context.addLog(`${ACTION_NAME}${josaUl} 하여 <C>${scoreText}</> 상승했습니다.`);
        }
        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });
        return { effects: [] };
    }
}

export { actionContextBuilder };

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_주민선정',
    category: '내정',
    reqArg: false,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
