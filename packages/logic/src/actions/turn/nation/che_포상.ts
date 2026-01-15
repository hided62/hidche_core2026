import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    alwaysFail,
    beChief,
    existsDestGeneral,
    friendlyDestGeneral,
    notBeNeutral,
    occupiedCity,
    reqNationGold,
    reqNationRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { clamp } from 'es-toolkit';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    isGold: z.boolean(),
    amount: z.number(),
    destGeneralId: z.number(),
});
export type AwardArgs = z.infer<typeof ARGS_SCHEMA>;

export interface AwardResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral: General<TriggerState>;
}

export interface AwardEnvironment {
    baseGold: number;
    baseRice: number;
    minAmount?: number;
    maxAmount: number;
    amountUnit?: number;
}

const ACTION_NAME = '포상';
const DEFAULT_MIN_AMOUNT = 100;
const DEFAULT_AMOUNT_UNIT = 100;

const roundToUnit = (value: number, unit: number): number => Math.round(value / unit) * unit;

const formatNumber = (value: number): string => value.toLocaleString('en-US');

const normalizeAmount = (amount: number, env: AwardEnvironment): number => {
    const unit = env.amountUnit ?? DEFAULT_AMOUNT_UNIT;
    const min = env.minAmount ?? DEFAULT_MIN_AMOUNT;
    const max = env.maxAmount;
    return clamp(roundToUnit(amount, unit), min, max);
};

const resolveNationResource = (
    nation: Nation,
    isGold: boolean
): { current: number; base: number; key: 'gold' | 'rice'; label: string } => ({
    current: isGold ? nation.gold : nation.rice,
    base: isGold ? 0 : 0,
    key: isGold ? 'gold' : 'rice',
    label: isGold ? '금' : '쌀',
});

// 포상 비용 및 유효 범위를 계산한다.
export class CommandResolver {
    private readonly env: AwardEnvironment;

    constructor(env: AwardEnvironment) {
        this.env = env;
    }

    getRequiredResource(isGold: boolean): number {
        return 1 + (isGold ? this.env.baseGold : this.env.baseRice);
    }

    normalizeAmount(amount: number): number {
        return normalizeAmount(amount, this.env);
    }
}

// 포상 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, AwardArgs> {
    readonly key = 'che_포상';
    private readonly env: AwardEnvironment;
    private readonly command: CommandResolver;

    constructor(env: AwardEnvironment) {
        this.env = env;
        this.command = new CommandResolver(env);
    }

    resolve(context: AwardResolveContext<TriggerState>, args: AwardArgs): GeneralActionOutcome<TriggerState> {
        const nation = context.nation;
        if (!nation) {
            return { effects: [] };
        }
        const { key, label } = resolveNationResource(nation, args.isGold);
        const base = args.isGold ? this.env.baseGold : this.env.baseRice;
        const available = Math.max(nation[key] - base, 0);
        const amount = clamp(this.command.normalizeAmount(args.amount), 0, available);
        if (amount <= 0) {
            return { effects: [] };
        }

        const amountText = formatNumber(amount);
        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createGeneralPatchEffect(
                { [key]: context.destGeneral[key] + amount } as Partial<General<TriggerState>>,
                context.destGeneral.id
            ),
            createNationPatchEffect(
                {
                    [key]: nation[key] - amount,
                } as Partial<Nation>,
                nation.id
            ),
        ];

        const amountJosa = JosaUtil.pick(amountText, '을');
        effects.push(
            createLogEffect(`${label} ${amountText}${amountJosa} 포상으로 받았습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: context.destGeneral.id,
                format: LogFormat.PLAIN,
            })
        );
        effects.push(
            createLogEffect(`<Y>${context.destGeneral.name}</>에게 ${label} ${amountText}${amountJosa} 수여했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            })
        );

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, AwardArgs, AwardResolveContext<TriggerState>> {
    public readonly key = 'che_포상';
    public readonly name = ACTION_NAME;
    private readonly command: CommandResolver;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: AwardEnvironment) {
        this.command = new CommandResolver(env);
        this.resolver = new ActionResolver(env);
    }

    parseArgs(raw: unknown): AwardArgs | null {
        const data = parseArgsWithSchema(ARGS_SCHEMA, raw);
        if (!data) {
            return null;
        }
        const amount = this.command.normalizeAmount(data.amount);
        if (amount <= 0) {
            return null;
        }
        return {
            ...data,
            amount,
        };
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: AwardArgs): Constraint[] {
        return [notBeNeutral(), occupiedCity(), beChief(), suppliedCity()];
    }

    buildConstraints(ctx: ConstraintContext, args: AwardArgs): Constraint[] {
        const requirements: RequirementKey[] = [];
        if (ctx.cityId !== undefined) {
            requirements.push({ kind: 'city', id: ctx.cityId });
        }
        if (ctx.nationId !== undefined) {
            requirements.push({ kind: 'nation', id: ctx.nationId });
        }
        if (ctx.destGeneralId !== undefined) {
            requirements.push({ kind: 'destGeneral', id: ctx.destGeneralId });
        }

        if (ctx.destGeneralId === ctx.actorId) {
            return [alwaysFail('본인입니다')];
        }

        const getRequired = (_ctx: ConstraintContext, _view: StateView): number =>
            this.command.getRequiredResource(args.isGold);

        const resourceConstraint = args.isGold
            ? reqNationGold(getRequired, requirements)
            : reqNationRice(getRequired, requirements);

        return [
            notBeNeutral(),
            occupiedCity(),
            beChief(),
            suppliedCity(),
            existsDestGeneral(),
            friendlyDestGeneral(),
            resourceConstraint,
        ];
    }

    resolve(context: AwardResolveContext<TriggerState>, args: AwardArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 대상 장수를 주입한다.
export const actionContextBuilder: ActionContextBuilder<AwardArgs> = (base, options) => {
    const destGeneralId = options.actionArgs.destGeneralId;
    if (typeof destGeneralId !== 'number') {
        return null;
    }
    const destGeneral = options.worldRef?.getGeneralById(destGeneralId);
    if (!destGeneral) {
        return null;
    }
    return {
        ...base,
        destGeneral,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_포상',
    category: '인사',
    reqArg: true,
    availabilityArgs: { isGold: true, amount: 1, destGeneralId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => {
        const maxAmount =
            env.maxResourceActionAmount > 0 ? env.maxResourceActionAmount : Math.max(env.baseGold, env.baseRice, 1000);
        return new ActionDefinition({
            baseGold: env.baseGold,
            baseRice: env.baseRice,
            maxAmount,
        });
    },
};
