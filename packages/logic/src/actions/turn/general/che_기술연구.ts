import type {
    General,
    GeneralTriggerState,
    Nation,
} from '../../../domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
    StateView,
} from '../../../constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    reqGeneralGold,
    suppliedCity,
} from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import {
    createGeneralPatchEffect,
    createLogEffect,
    createNationPatchEffect,
} from '../../engine.js';
import { LogCategory, LogFormat, LogScope } from '../../../logging/types.js';

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
    TriggerState extends GeneralTriggerState = GeneralTriggerState
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

    buildConstraints(
        _ctx: ConstraintContext,
        _args: TechResearchArgs
    ): Constraint[] {
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number =>
            this.env.costGold ?? 0;
        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            suppliedCity(),
            reqGeneralGold(getRequiredGold),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: TechResearchArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation ?? null;
        if (!nation) {
            return {
                effects: [
                    createLogEffect('국가 정보를 찾지 못했습니다.', {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const delta = this.env.techDelta ?? DEFAULT_TECH_DELTA;
        const currentTech = readTech(nation);
        const maxTech =
            typeof this.env.maxTechLevel === 'number' &&
            this.env.maxTechLevel > 0
                ? this.env.maxTechLevel
                : currentTech + delta;
        const nextTech = Math.min(currentTech + delta, maxTech);
        const applied = nextTech - currentTech;
        const costGold = this.env.costGold ?? 0;
        const generalPatch: Partial<General<TriggerState>> = {
            gold: Math.max(0, general.gold - costGold),
        };

        return {
            effects: [
                createNationPatchEffect(
                    {
                        meta: { ...nation.meta, tech: nextTech },
                    } as Partial<Nation>,
                    nation.id
                ),
                createGeneralPatchEffect<TriggerState>(generalPatch, general.id),
                createLogEffect(`${ACTION_NAME}로 기술이 ${applied} 상승했습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}
