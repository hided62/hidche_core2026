import type { City, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    occupiedCity,
    suppliedCity,
    reqNationGold,
    reqNationRice,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect, createNationPatchEffect, createCityPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';

export interface ExpandCityArgs {}

export interface ExpandCityResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    capitalCity: City;
}

const ACTION_NAME = '증축';

const POP_INCREASE = 100000;
const DEVEL_INCREASE = 2000;
const WALL_INCREASE = 2000;
const DEFAULT_COST = 60000;
const COST_COEF = 500;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ExpandCityArgs, ExpandCityResolveContext<TriggerState>> {
    public readonly key = 'che_증축';
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(_raw: unknown): ExpandCityArgs | null {
        return {};
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: ExpandCityArgs): Constraint[] {
        return [occupiedCity(), beChief(), suppliedCity()];
    }

    private getCost(): number {
        return this.env.develCost * COST_COEF + DEFAULT_COST;
    }

    buildConstraints(_ctx: ConstraintContext, _args: ExpandCityArgs): Constraint[] {
        const cost = this.getCost();
        return [
            occupiedCity(),
            beChief(),
            suppliedCity(),
            reqNationGold(() => this.env.baseGold + cost),
            reqNationRice(() => this.env.baseRice + cost),
            {
                name: 'expandableCity',
                requires: (ctx) => [
                    { kind: 'nation', id: ctx.nationId! },
                    { kind: 'city', id: 0 },
                ],
                test: (ctx: ConstraintContext, view: StateView) => {
                    const nation = view.get({ kind: 'nation', id: ctx.nationId! }) as Nation | undefined;
                    const capitalCityId = nation?.capitalCityId;

                    if (!capitalCityId) return { kind: 'deny', reason: '방랑상태에서는 불가능합니다.' };

                    const capitalCity = view.get({ kind: 'city', id: capitalCityId }) as City | undefined;
                    if (!capitalCity) return { kind: 'deny', reason: '수도 정보를 찾을 수 없습니다.' };
                    if (capitalCity.level <= 3) return { kind: 'deny', reason: '수진, 진, 관문에서는 불가능합니다.' };
                    if (capitalCity.level >= 8) return { kind: 'deny', reason: '더이상 증축할 수 없습니다.' };

                    return { kind: 'allow' };
                },
            },
        ];
    }

    resolve(
        context: ExpandCityResolveContext<TriggerState>,
        _args: ExpandCityArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, capitalCity } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const cost = this.getCost();
        const generalName = general.name;
        const nationName = nation.name;
        const destCityName = capitalCity.name;

        const josaUl = JosaUtil.pick(destCityName, '을');
        const josaYi = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(nationName, '이');

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createCityPatchEffect(
                {
                    level: capitalCity.level + 1,
                    populationMax: capitalCity.populationMax + POP_INCREASE,
                    agricultureMax: capitalCity.agricultureMax + DEVEL_INCREASE,
                    commerceMax: capitalCity.commerceMax + DEVEL_INCREASE,
                    securityMax: capitalCity.securityMax + DEVEL_INCREASE,
                    defenceMax: capitalCity.defenceMax + WALL_INCREASE,
                    wallMax: capitalCity.wallMax + WALL_INCREASE,
                },
                capitalCity.id
            ),
            createNationPatchEffect(
                {
                    gold: nation.gold - cost,
                    rice: nation.rice - cost,
                },
                nation.id
            ),
            // Global Action Log
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <G><b>${destCityName}</b></>${josaUl} <M>${ACTION_NAME}</>하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                }
            ),
            // Global History Log
            createLogEffect(
                `<C><b>【${ACTION_NAME}】</b></><D><b>${nationName}</b></>${josaYiNation} <G><b>${destCityName}</b></>${josaUl} <M>${ACTION_NAME}</>하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // Actor Nation History Log
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <G><b>${destCityName}</b></>${josaUl} <M>${ACTION_NAME}</>`,
                {
                    scope: LogScope.NATION,
                    nationId: nation.id,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // General Action Log
            createLogEffect(`<G><b>${destCityName}</b></>${josaUl} ${ACTION_NAME}했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
        ];

        general.experience += 30;
        general.dedication += 30;

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const nation = base.nation;
    if (!nation || !nation.capitalCityId) return null;

    const worldRef = options.worldRef;
    if (!worldRef) return null;

    const capitalCity = worldRef.getCityById(nation.capitalCityId);
    if (!capitalCity) return null;

    return {
        ...base,
        capitalCity,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_증축',
    category: '국가',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
