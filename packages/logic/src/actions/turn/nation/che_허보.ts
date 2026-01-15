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
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
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
export type DeceptionArgs = z.infer<typeof ARGS_SCHEMA>;

export interface DeceptionResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    destNation: Nation | null;
    destCityGenerals: Array<General<TriggerState>>;
    friendlyGenerals: Array<General<TriggerState>>;
    destNationSupplyCities: City[];
}

const ACTION_NAME = '허보';
const DEFAULT_GLOBAL_DELAY = 9;
const PRE_REQ_TURN = 1;
const EXP_DED_GAIN = 5 * (PRE_REQ_TURN + 1);

const pickMoveCityId = (rng: GeneralActionResolveContext['rng'], destCityId: number, candidates: City[]): number => {
    if (candidates.length === 0) {
        return destCityId;
    }
    let idx = rng.nextInt(0, candidates.length);
    let cityId = candidates[idx]?.id ?? destCityId;
    if (cityId === destCityId && candidates.length > 1) {
        idx = rng.nextInt(0, candidates.length);
        cityId = candidates[idx]?.id ?? destCityId;
    }
    return cityId;
};

// 허보 쿨타임 계산을 담당한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    getGlobalDelay(context: DeceptionResolveContext<TriggerState>): number {
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'globalDelay', DEFAULT_GLOBAL_DELAY));
    }
}

// 허보 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, DeceptionArgs> {
    readonly key = 'che_허보';
    private readonly command: CommandResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.command = new CommandResolver(modules);
    }

    resolve(context: DeceptionResolveContext<TriggerState>, _args: DeceptionArgs): GeneralActionOutcome<TriggerState> {
        void _args;
        const { general, nation } = context;
        const generalName = general.name;
        const generalJosa = JosaUtil.pick(generalName, '이');
        const cityName = context.destCity.name;
        const broadcastMessage = `<Y>${generalName}</>${generalJosa} <G><b>${cityName}</b></>에 <M>${ACTION_NAME}</>를 발동하였습니다.`;
        const destBroadcastMessage = `상대의 <M>${ACTION_NAME}</>에 당했다!`;

        general.experience += EXP_DED_GAIN;
        general.dedication += EXP_DED_GAIN;

        context.addLog(`${ACTION_NAME} 발동!`, { format: LogFormat.MONTH });
        context.addLog(`<G><b>${cityName}</b></>에 <M>${ACTION_NAME}</>를 발동`, {
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

        for (const target of context.destCityGenerals) {
            const moveCityId = pickMoveCityId(context.rng, context.destCity.id, context.destNationSupplyCities);
            effects.push(
                createLogEffect(destBroadcastMessage, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                })
            );
            if (moveCityId !== target.cityId) {
                effects.push(createGeneralPatchEffect({ cityId: moveCityId }, target.id));
            }
        }

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
                    `<D><b>${nation?.name ?? '상대국'}</b></>의 <Y>${generalName}</>${generalJosa} 아국의 <G><b>${cityName}</b></>에 <M>${ACTION_NAME}</>를 발동`,
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

// 허보 실행을 위한 정의/제약을 구성한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DeceptionArgs, DeceptionResolveContext<TriggerState>> {
    public readonly key = 'che_허보';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.resolver = new ActionResolver(modules);
    }

    parseArgs(raw: unknown): DeceptionArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: DeceptionArgs): Constraint[] {
        return [occupiedCity(), beChief(), availableStrategicCommand()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: DeceptionArgs): Constraint[] {
        void _ctx;
        void _args;
        return [
            occupiedCity(),
            beChief(),
            notNeutralDestCity(),
            notOccupiedDestCity(),
            allowDiplomacyBetweenStatus([0, 1], '선포, 전쟁중인 상대국에게만 가능합니다.'),
            availableStrategicCommand(),
        ];
    }

    resolve(context: DeceptionResolveContext<TriggerState>, args: DeceptionArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 대상 도시/장수 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder<DeceptionArgs> = (base, options) => {
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
    const destCityGenerals = generals.filter(
        (general) => general.nationId === destCity.nationId && general.cityId === destCity.id
    );
    const friendlyGenerals = generals.filter((general) => general.nationId === base.general.nationId);
    const destNationSupplyCities = worldRef
        .listCities()
        .filter((city) => city.nationId === destCity.nationId && city.supplyState > 0);
    return {
        ...base,
        destCity,
        destNation: destNation ?? null,
        destCityGenerals,
        friendlyGenerals,
        destNationSupplyCities,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_허보',
    category: '전략',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? []),
};
