import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyWithTerm,
    availableStrategicCommand,
    beChief,
    existsDestNation,
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
import { createDiplomacyPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { buildDefaultDiplomacy } from '../../../diplomacy/index.js';
import { JosaUtil } from '@sammo-ts/common';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destNationId: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().positive()
    ),
});
export type RaidArgs = z.infer<typeof ARGS_SCHEMA>;

export interface RaidResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
    diplomacy: { state: number; term: number };
    reverseDiplomacy: { state: number; term: number };
    friendlyGenerals: Array<General<TriggerState>>;
    destNationGenerals: Array<General<TriggerState>>;
}

const ACTION_NAME = '급습';
const DEFAULT_GLOBAL_DELAY = 9;
const PRE_REQ_TURN = 0;
const EXP_DED_GAIN = 5 * (PRE_REQ_TURN + 1);
const TERM_REDUCE = 3;

// 급습 쿨타임 계산을 담당한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    getGlobalDelay(context: RaidResolveContext<TriggerState>): number {
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'globalDelay', DEFAULT_GLOBAL_DELAY));
    }
}

// 급습 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, RaidArgs> {
    readonly key = 'che_급습';
    private readonly command: CommandResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.command = new CommandResolver(modules);
    }

    resolve(context: RaidResolveContext<TriggerState>, _args: RaidArgs): GeneralActionOutcome<TriggerState> {
        void _args;
        const { general, nation } = context;
        const generalName = general.name;
        const generalJosa = JosaUtil.pick(generalName, '이');
        const nationName = nation?.name ?? '아국';
        const destNationName = context.destNation.name;
        const actionJosa = JosaUtil.pick(ACTION_NAME, '을');
        const broadcastMessage = `<Y>${generalName}</>${generalJosa} <G><b>${destNationName}</b></>에 <M>${ACTION_NAME}</>${actionJosa} 발동하였습니다.`;

        general.experience += EXP_DED_GAIN;
        general.dedication += EXP_DED_GAIN;

        context.addLog(`${ACTION_NAME} 발동!`, { format: LogFormat.MONTH });
        context.addLog(`<D><b>${destNationName}</b></>에 <M>${ACTION_NAME}</>${actionJosa} 발동`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createDiplomacyPatchEffect(general.nationId, context.destNation.id, {
                term: context.diplomacy.term - TERM_REDUCE,
            }),
            createDiplomacyPatchEffect(context.destNation.id, general.nationId, {
                term: context.reverseDiplomacy.term - TERM_REDUCE,
            }),
        ];

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

        const destBroadcast = `아국에 <M>${ACTION_NAME}</>${JosaUtil.pick(ACTION_NAME, '이')} 발동되었습니다.`;
        for (const target of context.destNationGenerals) {
            effects.push(
                createLogEffect(destBroadcast, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                })
            );
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
        effects.push(
            createLogEffect(
                `<D><b>${nationName}</b></>의 <Y>${generalName}</>${generalJosa} 아국에 <M>${ACTION_NAME}</>${actionJosa} 발동`,
                {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    nationId: context.destNation.id,
                    format: LogFormat.PLAIN,
                }
            )
        );

        return { effects };
    }
}

// 급습 실행을 위한 정의/제약을 구성한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, RaidArgs, RaidResolveContext<TriggerState>> {
    public readonly key = 'che_급습';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.resolver = new ActionResolver(modules);
    }

    parseArgs(raw: unknown): RaidArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: RaidArgs): Constraint[] {
        return [occupiedCity(), beChief(), availableStrategicCommand()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: RaidArgs): Constraint[] {
        void _ctx;
        void _args;
        return [
            occupiedCity(),
            beChief(),
            existsDestNation(),
            allowDiplomacyWithTerm(1, 12, '선포 12개월 이상인 상대국에만 가능합니다.'),
            availableStrategicCommand(),
        ];
    }

    resolve(context: RaidResolveContext<TriggerState>, args: RaidArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 대상 국가/외교 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder<RaidArgs> = (base, options) => {
    const destNationId = options.actionArgs.destNationId;
    if (typeof destNationId !== 'number') {
        return null;
    }
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }
    const destNation = worldRef.getNationById(destNationId);
    if (!destNation) {
        return null;
    }
    const diplomacy =
        worldRef.getDiplomacyEntry(base.general.nationId, destNationId) ??
        buildDefaultDiplomacy(base.general.nationId, destNationId);
    const reverseDiplomacy =
        worldRef.getDiplomacyEntry(destNationId, base.general.nationId) ??
        buildDefaultDiplomacy(destNationId, base.general.nationId);
    const generals = worldRef.listGenerals();
    const friendlyGenerals = generals.filter((general) => general.nationId === base.general.nationId);
    const destNationGenerals = generals.filter((general) => general.nationId === destNationId);
    return {
        ...base,
        destNation,
        diplomacy: { state: diplomacy.state, term: diplomacy.term },
        reverseDiplomacy: { state: reverseDiplomacy.state, term: reverseDiplomacy.term },
        friendlyGenerals,
        destNationGenerals,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_급습',
    category: '외교',
    reqArg: true,
    availabilityArgs: { destNationId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? []),
};
