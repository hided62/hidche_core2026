import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    reqGeneralCrew,
    reqGeneralGold,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { clamp } from 'es-toolkit';

export interface BoostMoraleArgs {}

export interface BoostMoraleEnvironment {
    atmosDelta?: number;
    maxAtmosByCommand?: number;
    costGold?: number;
}

const ACTION_NAME = '사기 진작';
const DEFAULT_ATMOS_DELTA = 5;
const DEFAULT_MAX_ATMOS = 100;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
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

    buildMinConstraints(_ctx: ConstraintContext, _args: BoostMoraleArgs): Constraint[] {
        return [notBeNeutral(), notWanderingNation(), occupiedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: BoostMoraleArgs): Constraint[] {
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number => this.env.costGold ?? 0;
        return [notBeNeutral(), notWanderingNation(), occupiedCity(), reqGeneralCrew(), reqGeneralGold(getRequiredGold)];
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
        const delta = this.env.atmosDelta && this.env.atmosDelta > 0 ? this.env.atmosDelta : DEFAULT_ATMOS_DELTA;
        const nextAtmos = clamp(general.atmos + delta, 0, maxAtmos);
        const applied = nextAtmos - general.atmos;
        const costGold = this.env.costGold ?? 0;

        // 직접 수정 (Immer Draft)
        general.atmos = nextAtmos;
        general.gold = Math.max(0, general.gold - costGold);

        context.addLog(`사기치가 <C>${applied}</> 상승했습니다.`);
        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_사기진작',
    category: '군사',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({
            atmosDelta: env.atmosDelta,
            maxAtmosByCommand: env.maxAtmosByCommand,
        }),
};
