import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    reqGeneralAtmosMargin,
    reqGeneralCrew,
    reqGeneralGold,
    reqGeneralRice,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { clamp } from 'es-toolkit';
import { GeneralActionPipeline } from '@sammo-ts/logic/triggers/general-action.js';

export interface BoostMoraleArgs {}

export interface BoostMoraleEnvironment {
    atmosDelta?: number;
    maxAtmosByCommand?: number;
    costGold?: number;
    trainSideEffectByAtmosTurn?: number;
    unitSet?: TurnCommandEnv['unitSet'];
    generalActionModules?: TurnCommandEnv['generalActionModules'];
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
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(env: BoostMoraleEnvironment = {}) {
        this.env = env;
        this.pipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
    }

    parseArgs(_raw: unknown): BoostMoraleArgs | null {
        void _raw;
        return {};
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: BoostMoraleArgs): Constraint[] {
        return [notBeNeutral(), notWanderingNation(), occupiedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: BoostMoraleArgs): Constraint[] {
        const getRequiredGold = (context: ConstraintContext, view: StateView): number => {
            const general = view.get({ kind: 'general', id: context.actorId }) as { crew?: number } | null;
            return this.env.costGold ?? Math.round((general?.crew ?? 0) / 100);
        };
        const maxAtmos =
            this.env.maxAtmosByCommand && this.env.maxAtmosByCommand > 0
                ? this.env.maxAtmosByCommand
                : DEFAULT_MAX_ATMOS;
        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            reqGeneralCrew(),
            reqGeneralGold(getRequiredGold),
            reqGeneralRice(() => 0),
            reqGeneralAtmosMargin(maxAtmos),
        ];
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
        const leadership = this.pipeline.onCalcStat(context, 'leadership', general.stats.leadership);
        const score = Math.round((leadership * 100 * delta) / general.crew);
        const nextAtmos = clamp(general.atmos + score, 0, maxAtmos);
        const applied = nextAtmos - general.atmos;
        const costGold = this.env.costGold ?? Math.round(general.crew / 100);
        const trainSideEffect = Math.max(0, Math.trunc(general.train * (this.env.trainSideEffectByAtmosTurn ?? 1)));

        general.atmos = nextAtmos;
        general.train = trainSideEffect;
        general.gold = Math.max(0, general.gold - costGold);
        general.experience += 100;
        general.dedication += 70;
        const leadershipExp = typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0;
        general.meta.leadership_exp = leadershipExp + 1;
        const crewType = this.env.unitSet?.crewTypes?.find((entry) => entry.id === general.crewTypeId);
        if (crewType) {
            const dexKey = `dex${crewType.armType}`;
            const dex = typeof general.meta[dexKey] === 'number' ? general.meta[dexKey] : 0;
            general.meta[dexKey] = dex + applied;
        }

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
            ...(env.trainSideEffectByAtmosTurn !== undefined
                ? { trainSideEffectByAtmosTurn: env.trainSideEffectByAtmosTurn }
                : {}),
            ...(env.unitSet ? { unitSet: env.unitSet } : {}),
            ...(env.generalActionModules ? { generalActionModules: env.generalActionModules } : {}),
        }),
};
