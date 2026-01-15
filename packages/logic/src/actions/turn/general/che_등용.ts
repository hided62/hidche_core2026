import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    occupiedCity,
    suppliedCity,
    existsDestGeneral,
    resolveDestGeneralId,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogScope } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBase, ActionContextOptions } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface EmployResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral?: General;
    env?: TurnCommandEnv;
}

const ACTION_NAME = '등용';
const ACTION_KEY = 'che_등용';
const ARGS_SCHEMA = z.object({
    destGeneralId: z.number(),
});
export type EmployArgs = z.infer<typeof ARGS_SCHEMA>;

const differentNationDestGeneral = (): Constraint => ({
    name: 'DifferentNationDestGeneral',
    requires: (ctx) => {
        const destGeneralId = resolveDestGeneralId(ctx);
        if (destGeneralId === undefined) return [];
        return [
            { kind: 'general', id: ctx.actorId },
            { kind: 'destGeneral', id: destGeneralId },
        ];
    },
    test: (ctx, view) => {
        const generalKey = { kind: 'general' as const, id: ctx.actorId };
        const general = view.get(generalKey) as General | null;
        const destId = resolveDestGeneralId(ctx);
        const destGeneral =
            destId !== undefined ? (view.get({ kind: 'destGeneral', id: destId }) as General | null) : null;

        if (!general || !destGeneral) return { kind: 'deny', reason: '장수 정보가 없습니다.' };

        if (general.nationId !== destGeneral.nationId) return { kind: 'allow' };
        return { kind: 'deny', reason: '이미 아국 장수입니다.' };
    },
});

const notDestGeneralLord = (): Constraint => ({
    name: 'NotDestGeneralLord',
    requires: (ctx) => {
        const destGeneralId = resolveDestGeneralId(ctx);
        if (destGeneralId === undefined) return [];
        return [{ kind: 'destGeneral', id: destGeneralId }];
    },
    test: (ctx, view) => {
        const destId = resolveDestGeneralId(ctx);
        const destGeneral =
            destId !== undefined ? (view.get({ kind: 'destGeneral', id: destId }) as General | null) : null;
        if (!destGeneral) return { kind: 'deny', reason: '장수 정보가 없습니다.' };
        if (destGeneral.officerLevel !== 12) return { kind: 'allow' };
        return { kind: 'deny', reason: '군주에게는 등용장을 보낼 수 없습니다.' };
    },
});

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, EmployArgs> {
    readonly key = ACTION_KEY;

    resolve(context: GeneralActionResolveContext<TriggerState>, args: EmployArgs): GeneralActionOutcome<TriggerState> {
        const ctx = context as EmployResolveContext<TriggerState>;
        const general = ctx.general;
        const { destGeneralId } = args;

        const destGeneral = ctx.destGeneral;
        if (!destGeneral) {
            throw new Error('Target general missing in context');
        }

        const env = ctx.env;
        const develCost = env?.develCost ?? 100;
        const extraCost = Math.floor((destGeneral.experience + destGeneral.dedication) / 1000) * 10;
        const reqGold = develCost + extraCost;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    gold: Math.max(0, general.gold - reqGold),
                    experience: general.experience + 100,
                    dedication: general.dedication + 200,
                    meta: {
                        ...general.meta,
                        leadership_exp:
                            (typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0) + 1,
                    },
                },
                general.id
            )
        );

        ctx.addLog(`<Y>${destGeneral.name}</>에게 등용 권유 서신을 보냈습니다.`, {
            category: LogCategory.ACTION,
        });

        effects.push(
            createLogEffect(
                `<Y>${general.name}</>(${ctx.nation?.name ?? '재야'})로 부터 등용 권유 서신이 도착했습니다.`,
                {
                    scope: LogScope.GENERAL,
                    generalId: destGeneralId,
                    category: LogCategory.ACTION,
                }
            )
        );

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, EmployArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(private env: TurnCommandEnv) {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): EmployArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: EmployArgs): Constraint[] {
        return [notBeNeutral(), occupiedCity(), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, args: EmployArgs): Constraint[] {
        const develCost = this.env.develCost ?? 100;

        const reqCostConstraint: Constraint = {
            name: 'ReqScoutCost',
            requires: (c) => [
                { kind: 'general', id: c.actorId },
                { kind: 'destGeneral', id: args.destGeneralId },
            ],
            test: (c, view) => {
                const gen = view.get({ kind: 'general', id: c.actorId }) as General | null;
                const dest = view.get({ kind: 'destGeneral', id: args.destGeneralId }) as General | null;
                if (!gen || !dest) return { kind: 'deny', reason: '정보 부족' };

                const cost = develCost + Math.floor((dest.experience + dest.dedication) / 1000) * 10;
                if (gen.gold >= cost) return { kind: 'allow' };
                return { kind: 'deny', reason: `자금 ${cost}이 필요합니다.` };
            },
        };

        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestGeneral(),
            differentNationDestGeneral(),
            notDestGeneralLord(),
            reqCostConstraint,
        ];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: EmployArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = (base: ActionContextBase, options: ActionContextOptions) => {
    const destGeneralId = options.actionArgs?.destGeneralId;
    let destGeneral = null;
    if (typeof destGeneralId === 'number' && options.worldRef) {
        destGeneral = options.worldRef.getGeneralById(destGeneralId);
    }

    return {
        ...base,
        destGeneral,
        env: options.scenarioConfig.const as unknown as TurnCommandEnv,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_등용',
    category: '인사',
    reqArg: true,
    availabilityArgs: { destGeneralId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
