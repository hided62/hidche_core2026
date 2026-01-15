import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beMonarch,
    beWanderingNation,
    beNeutralCity,
    reqCityLevel,
    reqNationGeneralCount,
    checkNationNameDuplicate,
    beOpeningPart,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import {
    createCityPatchEffect,
    createGeneralPatchEffect,
    createNationPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

const ACTION_NAME = '건국';
const ARGS_SCHEMA = z.object({
    nationName: z.string().min(1),
    nationType: z.string().min(1),
    colorType: z.number(),
});
export type FoundingArgs = z.infer<typeof ARGS_SCHEMA>;

const NATION_COLORS = [
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#FFA500',
    '#FFDAB9',
    '#FFD700',
    '#FFFF00',
    '#7CFC00',
    '#00FF00',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#20B2AA',
    '#6495ED',
    '#7FFFD4',
    '#AFEEEE',
    '#87CEEB',
    '#00FFFF',
    '#00BFFF',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#BA55D3',
    '#800080',
    '#FF00FF',
    '#FFC0CB',
    '#F5F5DC',
    '#E0FFFF',
    '#FFFFFF',
    '#A9A9A9',
];

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, FoundingArgs> {
    public readonly key = 'che_건국';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): FoundingArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: FoundingArgs): Constraint[] {
        return [beOpeningPart(), beWanderingNation()];
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
        const nation = context.nation!;
        const cityId = general.cityId!;

        if (args.colorType < 0 || args.colorType >= NATION_COLORS.length) {
            throw new Error('Invalid color type');
        }
        const color = NATION_COLORS[args.colorType];

        const josaUl = '을'; // Mock JosaUtil.pick
        const josaYi = '이';
        const city = context.city;

        context.addLog(`${args.nationName}${josaUl} 건국하였습니다.`, {
            category: LogCategory.USER,
            format: LogFormat.PLAIN,
        });
        context.addLog(`${general.name}${josaYi} ${city?.name}에 국가를 건설하였습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`【건국】${args.nationType} ${args.nationName}${josaYi} 새로이 등장하였습니다.`, {
            category: LogCategory.HISTORY,
            format: LogFormat.PLAIN,
        });
        context.addLog(`${args.nationName}${josaUl} 건국`, {
            category: LogCategory.HISTORY,
            format: LogFormat.PLAIN,
        });
        context.addLog(`${general.name}${josaYi} ${args.nationName}${josaUl} 건국`, {
            category: LogCategory.HISTORY,
            format: LogFormat.PLAIN,
        });

        const effects = [
            createNationPatchEffect(
                {
                    name: args.nationName,
                    typeCode: args.nationType,
                    color: color!,
                    level: 1, // Normal Nation
                    capitalCityId: cityId,
                    meta: {
                        ...nation.meta,
                        can_국기변경: 1,
                    },
                },
                nation.id
            ),
            createCityPatchEffect(
                {
                    nationId: nation.id,
                },
                cityId
            ),
            createGeneralPatchEffect<TriggerState>({
                experience: (general.experience || 0) + 1000,
                dedication: (general.dedication || 0) + 1000,
            }),
        ];

        return { effects };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_건국',
    category: '전략',
    reqArg: true,
    availabilityArgs: {
        nationName: 'string',
        nationType: 'string',
        colorType: 'number',
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
