import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { ARGS_SCHEMA, ActionDefinition as RecruitActionDefinition } from './che_징병.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends RecruitActionDefinition<TriggerState> {
    public override readonly key = 'che_모병';
    public override readonly name = '모병';

    constructor(modules: GeneralActionModule<TriggerState>[]) {
        super(modules, {
            costOffset: 2,
            defaultTrain: 70, // GameConst::$defaultTrainHigh
            defaultAtmos: 70, // GameConst::$defaultAtmosHigh
        });
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_모병',
    category: '군사',
    reqArg: true,
    availabilityArgs: {
        crewType: 'number',
        amount: 'number',
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.generalActionModules ?? []),
};
