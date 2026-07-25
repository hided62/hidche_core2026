import type { City, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    notBeNeutral,
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

const requireCapitalCity = (reason: string): Constraint => ({
    name: 'requireCapitalCity',
    requires: (ctx) => (ctx.nationId !== undefined ? [{ kind: 'nation', id: ctx.nationId }] : []),
    test: (ctx: ConstraintContext, view: StateView) => {
        if (ctx.nationId === undefined) {
            return { kind: 'deny', reason };
        }
        const nation = view.get({ kind: 'nation', id: ctx.nationId }) as Nation | undefined;
        if (!nation || !nation.capitalCityId) {
            return { kind: 'deny', reason };
        }
        return { kind: 'allow' };
    },
});

const reqDestCityValue = (comp: '>' | '<' | '>=' | '<=', required: number, reason: string): Constraint => ({
    name: 'reqDestCityValue',
    requires: (ctx) => (ctx.nationId !== undefined ? [{ kind: 'nation', id: ctx.nationId }] : []),
    test: (ctx: ConstraintContext, view: StateView) => {
        if (ctx.nationId === undefined) {
            return { kind: 'deny', reason };
        }
        const nation = view.get({ kind: 'nation', id: ctx.nationId }) as Nation | undefined;
        if (!nation || !nation.capitalCityId) {
            return { kind: 'deny', reason: '방랑상태에서는 불가능합니다.' };
        }
        const city = view.get({ kind: 'city', id: nation.capitalCityId }) as City | undefined;
        if (!city) {
            return { kind: 'deny', reason: '수도 정보를 찾을 수 없습니다.' };
        }
        const level = city.level;
        const allow =
            comp === '>'
                ? level > required
                : comp === '<'
                  ? level < required
                  : comp === '>='
                    ? level >= required
                    : level <= required;
        if (allow) {
            return { kind: 'allow' };
        }
        return { kind: 'deny', reason };
    },
});

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ExpandCityArgs, ExpandCityResolveContext<TriggerState>> {
    public readonly key = 'che_증축';
    public readonly name = ACTION_NAME;
    public readonly countsAsInheritanceActiveAction = true;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(_raw: unknown): ExpandCityArgs | null {
        return {};
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: ExpandCityArgs): Constraint[] {
        return [notBeNeutral()];
    }

    private getCost(): number {
        return this.env.develCost * COST_COEF + DEFAULT_COST;
    }

    buildConstraints(_ctx: ConstraintContext, _args: ExpandCityArgs): Constraint[] {
        const cost = this.getCost();
        return [
            notBeNeutral(),
            occupiedCity(),
            beChief(),
            suppliedCity(),
            requireCapitalCity('방랑상태에서는 불가능합니다.'),
            reqDestCityValue('>', 3, '수진, 진, 관문에서는 불가능합니다.'),
            reqDestCityValue('<', 8, '더이상 증축할 수 없습니다.'),
            reqNationGold(() => this.env.baseGold + cost),
            reqNationRice(() => this.env.baseRice + cost),
        ];
    }

    getPreReqTurn(): number {
        return 5;
    }

    getStackSequence(context: ExpandCityResolveContext<TriggerState>): number {
        const value = context.nation?.meta.capset;
        return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
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
                    meta: {
                        ...nation.meta,
                        capset: (typeof nation.meta.capset === 'number' ? nation.meta.capset : 0) + 1,
                    },
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
            createLogEffect(`<G><b>${destCityName}</b></>${josaUl} <M>${ACTION_NAME}</>`, {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
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
