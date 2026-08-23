import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyStatus,
    availableStrategicCommand,
    beChief,
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
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { JosaUtil } from '@sammo-ts/common';
import type { NationTurnCommandSpec } from './index.js';

export interface DesperateFightArgs {}

export interface DesperateFightResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    nationGenerals: Array<General<TriggerState>>;
}

const ACTION_NAME = '필사즉생';
const DEFAULT_GLOBAL_DELAY = 9;
const PRE_REQ_TURN = 2;
const EXP_DED_GAIN = 5 * (PRE_REQ_TURN + 1);
const TRAIN_CAP = 100;
const ATMOS_CAP = 100;

// 필사즉생 쿨타임 계산을 담당한다.
export class CommandResolver<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        private readonly initialNationGenLimit = 10
    ) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    getPostReqTurn(context: DesperateFightResolveContext<TriggerState>): number {
        const genCount = Math.max(context.nationGenerals.length, this.initialNationGenLimit);
        const base = Math.round(Math.sqrt(genCount * 8) * 10);
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'delay', base));
    }

    getGlobalDelay(context: DesperateFightResolveContext<TriggerState>): number {
        return Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'globalDelay', DEFAULT_GLOBAL_DELAY));
    }
}

// 필사즉생 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, DesperateFightArgs> {
    readonly key = 'che_필사즉생';
    private readonly command: CommandResolver<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        initialNationGenLimit = 10
    ) {
        this.command = new CommandResolver(modules, initialNationGenLimit);
    }

    getPostReqTurn(context: DesperateFightResolveContext<TriggerState>): number {
        return this.command.getPostReqTurn(context);
    }

    resolve(
        context: DesperateFightResolveContext<TriggerState>,
        _args: DesperateFightArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const { general, nation } = context;
        const generalName = general.name;
        const generalJosa = JosaUtil.pick(generalName, '이');
        const broadcastMessage = `<Y>${generalName}</>${generalJosa} <M>${ACTION_NAME}</>을 발동하였습니다.`;

        general.experience += EXP_DED_GAIN;
        general.dedication += EXP_DED_GAIN;

        context.addLog(`${ACTION_NAME} 발동!`, { format: LogFormat.MONTH });
        context.addLog(`<M>${ACTION_NAME}</>을 발동`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        const updateTrainAtmos = (target: General<TriggerState>): { train: number; atmos: number } | null => {
            const nextTrain = Math.max(target.train, TRAIN_CAP);
            const nextAtmos = Math.max(target.atmos, ATMOS_CAP);
            if (nextTrain === target.train && nextAtmos === target.atmos) {
                return null;
            }
            return { train: nextTrain, atmos: nextAtmos };
        };

        const selfPatch = updateTrainAtmos(general);
        if (selfPatch) {
            general.train = selfPatch.train;
            general.atmos = selfPatch.atmos;
        }

        const nationTargets = context.nationGenerals.filter((target) => target.id !== general.id);
        const firstLegacyFlushGroup = -nationTargets.length;
        for (const [index, target] of nationTargets.entries()) {
            const patch = updateTrainAtmos(target);
            if (patch) {
                effects.push(createGeneralPatchEffect(patch, target.id));
            }
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

        if (nation) {
            const globalDelay = this.command.getGlobalDelay(context);
            nation.meta = {
                ...(nation.meta as object),
                strategic_cmd_limit: globalDelay,
            };
            effects.push(
                createLogEffect(`<Y>${generalName}</>${generalJosa} <M>${ACTION_NAME}</>을 발동`, {
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

// 필사즉생 실행을 위한 정의/제약을 구성한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DesperateFightArgs, DesperateFightResolveContext<TriggerState>> {
    public readonly key = 'che_필사즉생';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(
        modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>,
        initialNationGenLimit = 10
    ) {
        this.resolver = new ActionResolver(modules, initialNationGenLimit);
    }

    parseArgs(_raw: unknown): DesperateFightArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: DesperateFightArgs): Constraint[] {
        void _ctx;
        void _args;
        return [
            occupiedCity(),
            beChief(),
            allowDiplomacyStatus([0], '전쟁중이 아닙니다.'),
            availableStrategicCommand(),
        ];
    }

    getPreReqTurn(): number {
        return PRE_REQ_TURN;
    }

    getPostReqTurn(context: DesperateFightResolveContext<TriggerState>): number {
        return this.resolver.getPostReqTurn(context);
    }

    resolve(
        context: DesperateFightResolveContext<TriggerState>,
        args: DesperateFightArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 국가 장수 목록을 구성한다.
export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }
    const nationGenerals = worldRef.listGenerals().filter((entry) => entry.nationId === base.general.nationId);
    return {
        ...base,
        nationGenerals,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_필사즉생',
    category: '전략',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition(env.generalActionModules ?? [], env.initialNationGenLimit),
};
