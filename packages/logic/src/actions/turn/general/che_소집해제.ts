import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { reqGeneralCrew } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/triggers/general-action.js';

export interface DisbandArgs {}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DisbandArgs> {
    public readonly key = 'che_소집해제';
    public readonly name = '소집해제';
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.pipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
    }

    parseArgs(_raw: unknown): DisbandArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: DisbandArgs): Constraint[] {
        return [reqGeneralCrew()];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: DisbandArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const city = context.city;
        if (!city) {
            context.addLog('도시 정보를 찾지 못했습니다.');
            return { effects: [] };
        }

        const crewUp = this.pipeline.onCalcDomestic(context, '징집인구', 'score', general.crew);
        general.crew = 0;
        city.population += Math.trunc(crewUp);
        general.experience += 70;
        general.dedication += 100;

        context.addLog(`병사들을 <R>소집해제</>하였습니다.`);

        return { effects: [] };
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_소집해제',
    category: '군사',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
