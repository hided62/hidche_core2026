import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyBetweenStatus,
    availableStrategicCommand,
    beChief,
    notNeutralDestCity,
    notOccupiedDestCity,
    occupiedCity,
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
export type FloodArgs = z.infer<typeof ARGS_SCHEMA>;

export interface FloodResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    destNation: Nation | null;
    friendlyGenerals: Array<General<TriggerState>>;
    destNationGenerals: Array<General<TriggerState>>;
}

const ACTION_NAME = '수몰';
const DEFAULT_GLOBAL_DELAY = 9;
const PRE_REQ_TURN = 2;
const EXP_DED_GAIN = 5 * (PRE_REQ_TURN + 1);
const DAMAGE_RATE = 0.2;

// 수몰 쿨타임 계산을 담당한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    getGlobalDelay(context: FloodResolveContext<TriggerState>): number {
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'globalDelay', DEFAULT_GLOBAL_DELAY));
    }
}

// 수몰 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, FloodArgs> {
    readonly key = 'che_수몰';
    private readonly command: CommandResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.command = new CommandResolver(modules);
    }

    resolve(context: FloodResolveContext<TriggerState>, _args: FloodArgs): GeneralActionOutcome<TriggerState> {
        void _args;
        const { general, nation } = context;
        const generalName = general.name;
        const generalJosa = JosaUtil.pick(generalName, '이');
        const cityName = context.destCity.name;
        const broadcastMessage = `<Y>${generalName}</>${generalJosa} <G><b>${cityName}</b></>에 <M>${ACTION_NAME}</>을 발동하였습니다.`;
        const destBroadcastMessage = `<G><b>${cityName}</b></>에 <M>${ACTION_NAME}</>이 발동되었습니다.`;

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

        for (const target of context.destNationGenerals) {
            effects.push(
                createLogEffect(destBroadcastMessage, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                })
            );
        }

        effects.push(
            createCityPatchEffect(
                {
                    defence: context.destCity.defence * DAMAGE_RATE,
                    wall: context.destCity.wall * DAMAGE_RATE,
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

        if (context.destNation) {
            effects.push(
                createLogEffect(
                    `<D><b>${nation?.name ?? '상대국'}</b></>의 <Y>${generalName}</>${generalJosa} 아국의 <G><b>${cityName}</b></>에 <M>${ACTION_NAME}</>을 발동`,
                    {
                        scope: LogScope.NATION,
                        category: LogCategory.HISTORY,
                        nationId: context.destNation.id,
                        format: LogFormat.PLAIN,
                    }
                )
            );
        }

        return { effects };
    }
}

// 수몰 실행을 위한 정의/제약을 구성한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, FloodArgs, FloodResolveContext<TriggerState>> {
    public readonly key = 'che_수몰';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.resolver = new ActionResolver(modules);
    }

    parseArgs(raw: unknown): FloodArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: FloodArgs): Constraint[] {
        return [occupiedCity(), beChief(), availableStrategicCommand()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: FloodArgs): Constraint[] {
        void _ctx;
        void _args;
        return [
            occupiedCity(),
            beChief(),
            notNeutralDestCity(),
            notOccupiedDestCity(),
            allowDiplomacyBetweenStatus([0], '교전중인 국가의 도시가 아닙니다.'),
            availableStrategicCommand(),
        ];
    }

    resolve(context: FloodResolveContext<TriggerState>, args: FloodArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 대상 도시/장수 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder<FloodArgs> = (base, options) => {
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
    const destNation = worldRef.getNationById(destCity.nationId);
    const generals = worldRef.listGenerals();
    const friendlyGenerals = generals.filter((general) => general.nationId === base.general.nationId);
    const destNationGenerals = generals.filter((general) => general.nationId === destCity.nationId);
    return {
        ...base,
        destCity,
        destNation: destNation ?? null,
        friendlyGenerals,
        destNationGenerals,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_수몰',
    category: '전략',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? []),
};
