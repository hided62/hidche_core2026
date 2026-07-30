import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import {
    ARGS_SCHEMA,
    ActionDefinition as RecruitActionDefinition,
    actionContextBuilder as recruitActionContextBuilder,
} from './che_징병.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends RecruitActionDefinition<TriggerState> {
    public override readonly key = 'che_모병';
    public override readonly name = '모병';

    constructor(modules: ReadonlyArray<GeneralActionModule<TriggerState>>) {
        super(modules, {
            actionName: '모병',
            costOffset: 2,
            defaultTrain: 70, // GameConst::$defaultTrainHigh
            defaultAtmos: 70, // GameConst::$defaultAtmosHigh
        });
    }
}

// 모병도 징병과 동일하게 병종/지도/연도 컨텍스트가 필요하다.
export const actionContextBuilder = recruitActionContextBuilder;

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
