import type { City, General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    availableStrategicCommand,
    beChief,
    occupiedCity,
    occupiedDestCity,
} from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createCityPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { JosaUtil } from '@sammo-ts/common';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destCityId: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().positive()
    ),
});
export type MobilizePeopleArgs = z.infer<typeof ARGS_SCHEMA>;

export interface MobilizePeopleResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    friendlyGenerals: Array<General<TriggerState>>;
}

const ACTION_NAME = '백성동원';
const DEFAULT_GLOBAL_DELAY = 9;
const PRE_REQ_TURN = 0;
const EXP_DED_GAIN = 5 * (PRE_REQ_TURN + 1);
const DEFENCE_RATE = 0.8;

// 백성동원 쿨타임 계산을 담당한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    getGlobalDelay(context: MobilizePeopleResolveContext<TriggerState>): number {
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'globalDelay', DEFAULT_GLOBAL_DELAY));
    }
}

// 백성동원 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, MobilizePeopleArgs> {
    readonly key = 'che_백성동원';
    private readonly command: CommandResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.command = new CommandResolver(modules);
    }

    resolve(
        context: MobilizePeopleResolveContext<TriggerState>,
        _args: MobilizePeopleArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const { general, nation } = context;
        const generalName = general.name;
        const generalJosa = JosaUtil.pick(generalName, '이');
        const cityName = context.destCity.name;
        const broadcastMessage = `<Y>${generalName}</>${generalJosa} <G><b>${cityName}</b></>에 <M>${ACTION_NAME}</>을 하였습니다.`;

        general.experience += EXP_DED_GAIN;
        general.dedication += EXP_DED_GAIN;

        context.addLog(`${ACTION_NAME} 발동!`, { format: LogFormat.MONTH });
        context.addLog(`<G><b>${cityName}</b></>에 <M>${ACTION_NAME}</>을 발동`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        for (const target of context.friendlyGenerals) {
            if (target.id === general.id) {
                continue;
            }
            effects.push(
                createLogEffect(broadcastMessage, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                })
            );
        }

        const nextDefence = Math.max(context.destCity.defence, context.destCity.defenceMax * DEFENCE_RATE);
        const nextWall = Math.max(context.destCity.wall, context.destCity.wallMax * DEFENCE_RATE);
        effects.push(
            createCityPatchEffect(
                {
                    defence: nextDefence,
                    wall: nextWall,
                },
                context.destCity.id
            )
        );

        if (nation) {
            const globalDelay = this.command.getGlobalDelay(context);
            nation.meta = {
                ...(nation.meta as object),
                strategic_cmd_limit: globalDelay,
            };
            effects.push(
                createLogEffect(broadcastMessage, {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    nationId: nation.id,
                    format: LogFormat.YEAR_MONTH,
                })
            );
        }

        return { effects };
    }
}

// 백성동원 실행을 위한 정의/제약을 구성한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, MobilizePeopleArgs, MobilizePeopleResolveContext<TriggerState>> {
    public readonly key = 'che_백성동원';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.resolver = new ActionResolver(modules);
    }

    parseArgs(raw: unknown): MobilizePeopleArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: MobilizePeopleArgs): Constraint[] {
        return [occupiedCity(), beChief(), availableStrategicCommand()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: MobilizePeopleArgs): Constraint[] {
        void _ctx;
        void _args;
        return [occupiedCity(), beChief(), occupiedDestCity(), availableStrategicCommand()];
    }

    resolve(
        context: MobilizePeopleResolveContext<TriggerState>,
        args: MobilizePeopleArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 대상 도시/장수 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder<MobilizePeopleArgs> = (base, options) => {
    const destCityId = options.actionArgs.destCityId;
    if (typeof destCityId !== 'number') {
        return null;
    }
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }
    const destCity = worldRef.getCityById(destCityId);
    if (!destCity) {
        return null;
    }
    const friendlyGenerals = worldRef.listGenerals().filter((general) => general.nationId === base.general.nationId);
    return {
        ...base,
        destCity,
        friendlyGenerals,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_백성동원',
    category: '전략',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? []),
};
