import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyBetweenStatus,
    availableStrategicCommand,
    beChief,
    existsDestNation,
    occupiedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
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
import { buildDefaultDiplomacy, DIPLOMACY_STATE } from '../../../diplomacy/index.js';
import { JosaUtil } from '@sammo-ts/common';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destNationId: z.number().int().positive(),
});
export type DegradeRelationsArgs = z.infer<typeof ARGS_SCHEMA>;

export interface DegradeRelationsResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
    diplomacy: { state: number; term: number };
    reverseDiplomacy: { state: number; term: number };
    friendlyGenerals: Array<General<TriggerState>>;
    destNationGenerals: Array<General<TriggerState>>;
}

const ACTION_NAME = '이호경식';
const DEFAULT_GLOBAL_DELAY = 9;
const PRE_REQ_TURN = 0;
const EXP_DED_GAIN = 5 * (PRE_REQ_TURN + 1);

const resolveNextTerm = (state: number, term: number): number => (state === DIPLOMACY_STATE.WAR ? 3 : term + 3);

// 이호경식 쿨타임 계산을 담당한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        private readonly initialNationGenLimit = 10
    ) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    getPostReqTurn(context: DegradeRelationsResolveContext<TriggerState>): number {
        const genCount = Math.max(context.friendlyGenerals.length, this.initialNationGenLimit);
        const base = Math.round(Math.sqrt(genCount * 16) * 10);
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'delay', base));
    }

    getGlobalDelay(context: DegradeRelationsResolveContext<TriggerState>): number {
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'globalDelay', DEFAULT_GLOBAL_DELAY));
    }
}

// 이호경식 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, DegradeRelationsArgs> {
    readonly key = 'che_이호경식';
    private readonly command: CommandResolver<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        initialNationGenLimit = 10
    ) {
        this.command = new CommandResolver(modules, initialNationGenLimit);
    }

    getPostReqTurn(context: DegradeRelationsResolveContext<TriggerState>): number {
        return this.command.getPostReqTurn(context);
    }

    resolve(
        context: DegradeRelationsResolveContext<TriggerState>,
        _args: DegradeRelationsArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const { general, nation } = context;
        const generalName = general.name;
        const generalJosa = JosaUtil.pick(generalName, '이');
        const nationName = nation?.name ?? '아국';
        const nationJosa = JosaUtil.pick(nationName, '이');
        const destNationName = context.destNation.name;
        const actionName = ACTION_NAME;
        const actionJosa = JosaUtil.pick(actionName, '을');
        const broadcastMessage = `<Y>${generalName}</>${generalJosa} <G><b>${destNationName}</b></>에 <M>${ACTION_NAME}</>${actionJosa} 발동하였습니다.`;

        general.experience += EXP_DED_GAIN;
        general.dedication += EXP_DED_GAIN;

        context.addLog(`${actionName} 발동!`, { format: LogFormat.MONTH });
        context.addLog(`<D><b>${destNationName}</b></>에 <M>${actionName}</>${actionJosa} 발동`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createDiplomacyPatchEffect(general.nationId, context.destNation.id, {
                state: DIPLOMACY_STATE.DECLARATION,
                term: resolveNextTerm(context.diplomacy.state, context.diplomacy.term),
            }),
            createDiplomacyPatchEffect(context.destNation.id, general.nationId, {
                state: DIPLOMACY_STATE.DECLARATION,
                term: resolveNextTerm(context.reverseDiplomacy.state, context.reverseDiplomacy.term),
            }),
        ];

        const friendlyTargets = context.friendlyGenerals.filter((target) => target.id !== general.id);
        const firstLegacyFlushGroup = -(friendlyTargets.length + context.destNationGenerals.length + 1);
        for (const [index, target] of friendlyTargets.entries()) {
            effects.push(
                createLogEffect(broadcastMessage, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                    legacyFlushGroup: firstLegacyFlushGroup + index,
                })
            );
        }

        const destBroadcast = `<D><b>${nationName}</b></>${nationJosa} 아국에 <M>${ACTION_NAME}</>${actionJosa} 발동하였습니다.`;
        for (const [index, target] of context.destNationGenerals.entries()) {
            effects.push(
                createLogEffect(destBroadcast, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                    legacyFlushGroup: firstLegacyFlushGroup + friendlyTargets.length + index,
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
                createLogEffect(
                    `<Y>${generalName}</>${generalJosa} <D><b>${destNationName}</b></>에 <M>${ACTION_NAME}</>${actionJosa} 발동`,
                    {
                        scope: LogScope.NATION,
                        category: LogCategory.HISTORY,
                        nationId: nation.id,
                        format: LogFormat.YEAR_MONTH,
                    }
                )
            );
        }
        effects.push(
            createLogEffect(
                `<D><b>${nationName}</b></>의 <Y>${generalName}</>${generalJosa} 아국에 <M>${ACTION_NAME}</>${actionJosa} 발동`,
                {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    nationId: context.destNation.id,
                    format: LogFormat.YEAR_MONTH,
                    legacyFlushGroup: -1,
                }
            )
        );

        return { effects };
    }
}

// 이호경식 실행을 위한 정의/제약을 구성한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DegradeRelationsArgs, DegradeRelationsResolveContext<TriggerState>> {
    public readonly key = 'che_이호경식';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        initialNationGenLimit = 10
    ) {
        this.resolver = new ActionResolver(modules, initialNationGenLimit);
    }

    parseArgs(raw: unknown): DegradeRelationsArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: DegradeRelationsArgs): Constraint[] {
        return [occupiedCity(), beChief(), availableStrategicCommand()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: DegradeRelationsArgs): Constraint[] {
        void _ctx;
        void _args;
        return [
            occupiedCity(),
            beChief(),
            existsDestNation(),
            allowDiplomacyBetweenStatus([0, 1], '선포, 전쟁중인 상대국에게만 가능합니다.'),
            availableStrategicCommand(),
        ];
    }

    getPostReqTurn(context: DegradeRelationsResolveContext<TriggerState>): number {
        return this.resolver.getPostReqTurn(context);
    }

    resolve(
        context: DegradeRelationsResolveContext<TriggerState>,
        args: DegradeRelationsArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 대상 국가/외교 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder<DegradeRelationsArgs> = (base, options) => {
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
    key: 'che_이호경식',
    category: '외교',
    reqArg: true,
    availabilityArgs: { destNationId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition(env.generalActionModules ?? [], env.initialNationGenLimit),
};
