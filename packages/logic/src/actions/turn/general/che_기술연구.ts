import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    reqGeneralGold,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface TechResearchArgs {}

export interface TechResearchEnvironment {
    costGold?: number;
    techDelta?: number;
    maxTechLevel?: number;
}

const ACTION_NAME = '기술 연구';
const DEFAULT_TECH_DELTA = 1;

const readTech = (nation: Nation | null | undefined): number => {
    if (!nation) {
        return 0;
    }
    const tech = nation.meta.tech;
    return typeof tech === 'number' ? tech : 0;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, TechResearchArgs> {
    public readonly key = 'che_기술연구';
    public readonly name = ACTION_NAME;
    private readonly env: TechResearchEnvironment;

    constructor(env: TechResearchEnvironment = {}) {
        this.env = env;
    }

    parseArgs(_raw: unknown): TechResearchArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: TechResearchArgs): Constraint[] {
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number => this.env.costGold ?? 0;
        return [notBeNeutral(), notWanderingNation(), occupiedCity(), suppliedCity(), reqGeneralGold(getRequiredGold)];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: TechResearchArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        if (!nation) {
            context.addLog('국가 정보를 찾지 못했습니다.');
            return { effects: [] };
        }

        const delta = this.env.techDelta ?? DEFAULT_TECH_DELTA;
        const currentTech = readTech(nation);
        const maxTech =
            typeof this.env.maxTechLevel === 'number' && this.env.maxTechLevel > 0
                ? this.env.maxTechLevel
                : currentTech + delta;
        const nextTech = Math.min(currentTech + delta, maxTech);
        const applied = nextTech - currentTech;
        const costGold = this.env.costGold ?? 0;

        // 직접 수정 (Immer Draft)
        nation.meta = { ...nation.meta, tech: nextTech };
        general.gold = Math.max(0, general.gold - costGold);

        context.addLog(`${ACTION_NAME}로 기술이 ${applied} 상승했습니다.`);

        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_기술연구',
    category: '내정',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({
            costGold: env.develCost,
            maxTechLevel: env.maxTechLevel,
        }),
};
