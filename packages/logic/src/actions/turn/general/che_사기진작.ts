import type {
    General,
    GeneralTriggerState,
} from '../../../domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
    StateView,
} from '../../../constraints/types.js';
import { notBeNeutral, reqGeneralGold } from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import { createGeneralPatchEffect, createLogEffect } from '../../engine.js';
import { LogCategory, LogFormat, LogScope } from '../../../logging/types.js';
import type { TurnCommandEnv } from '../commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface BoostMoraleArgs {}

export interface BoostMoraleEnvironment {
    atmosDelta?: number;
    maxAtmosByCommand?: number;
    costGold?: number;
}

const ACTION_NAME = '사기 진작';
const DEFAULT_ATMOS_DELTA = 5;
const DEFAULT_MAX_ATMOS = 100;

const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, BoostMoraleArgs> {
    public readonly key = 'che_사기진작';
    public readonly name = ACTION_NAME;
    private readonly env: BoostMoraleEnvironment;

    constructor(env: BoostMoraleEnvironment = {}) {
        this.env = env;
    }

    parseArgs(_raw: unknown): BoostMoraleArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(
        _ctx: ConstraintContext,
        _args: BoostMoraleArgs
    ): Constraint[] {
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number =>
            this.env.costGold ?? 0;
        return [notBeNeutral(), reqGeneralGold(getRequiredGold)];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: BoostMoraleArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const maxAtmos =
            this.env.maxAtmosByCommand && this.env.maxAtmosByCommand > 0
                ? this.env.maxAtmosByCommand
                : DEFAULT_MAX_ATMOS;
        const delta =
            this.env.atmosDelta && this.env.atmosDelta > 0
                ? this.env.atmosDelta
                : DEFAULT_ATMOS_DELTA;
        const nextAtmos = clamp(general.atmos + delta, 0, maxAtmos);
        const applied = nextAtmos - general.atmos;
        const costGold = this.env.costGold ?? 0;
        const patch: Partial<General<TriggerState>> = {
            atmos: nextAtmos,
            gold: Math.max(0, general.gold - costGold),
        };

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>(patch, general.id),
                createLogEffect(`${ACTION_NAME}로 사기가 ${applied} 증가했습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_사기진작',
    category: '군사',
    reqArg: false,
    args: {},
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({
            atmosDelta: env.atmosDelta,
            maxAtmosByCommand: env.maxAtmosByCommand,
        }),
};
