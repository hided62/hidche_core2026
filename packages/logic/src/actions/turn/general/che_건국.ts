import type { GeneralTriggerState, TriggerValue } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beMonarch,
    beWanderingNation,
    reqNationGeneralCount,
    beOpeningPart,
    beNeutralCity,
    reqCityLevel,
    checkNationNameDuplicate,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface FoundingArgs {
    nationName: string;
    nationType: string;
    colorType: number;
}

const ACTION_NAME = '건국';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, FoundingArgs> {
    public readonly key = 'che_건국';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): FoundingArgs | null {
        if (typeof raw !== 'object' || raw === null) return null;
        const { nationName, nationType, colorType } = raw as any;
        if (typeof nationName !== 'string' || !nationName) return null;
        if (typeof nationType !== 'string' || !nationType) return null;
        if (typeof colorType !== 'number') return null;

        return { nationName, nationType, colorType };
    }

    buildConstraints(_ctx: ConstraintContext, args: FoundingArgs): Constraint[] {
        return [
            beOpeningPart(),
            beMonarch(),
            beWanderingNation(),
            reqNationGeneralCount(2),
            beNeutralCity(),
            reqCityLevel([5, 6]), // 소, 중 도시
            checkNationNameDuplicate(args.nationName),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: FoundingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;

        // 직접 수정 (Immer Draft)
        general.meta = {
            ...(general.meta as object),
            founding: true as TriggerValue,
            foundingArgs: args as unknown as TriggerValue, // Cast to TriggerValue to solve type mismatch
        };

        context.addLog(`${args.nationName} 건국을 준비했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_건국',
    category: '전략',
    reqArg: true,
    args: {
        nationName: 'string',
        nationType: 'string',
        colorType: 'number',
    },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
