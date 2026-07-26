import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowJoinAction,
    beLord,
    beOpeningPart,
    checkNationNameDuplicate,
    neutralCity,
    reqNationGeneralCount,
    reqNationValue,
    wanderingNation,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import {
    createCityPatchEffect,
    createGeneralPatchEffect,
    createNationPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { resolveInitYearMonth } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';
import { JosaUtil } from '@sammo-ts/common';
import {
    FOUNDING_ARGS_SCHEMA,
    getNationTypeDisplayName,
    NATION_COLORS,
    type FoundingArgs,
} from './foundingShared.js';

const ACTION_NAME = '건국';
const ACTION_KEY = 'cr_건국';
interface FoundingResolveContext<TriggerState extends GeneralTriggerState = GeneralTriggerState>
    extends GeneralActionResolveContext<TriggerState> {
    currentYearMonth?: number;
    initYearMonth?: number;
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, FoundingArgs> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    getInheritanceActiveActionAmount(): number {
        return 1;
    }

    parseArgs(raw: unknown): FoundingArgs | null {
        return parseArgsWithSchema(FOUNDING_ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: FoundingArgs): Constraint[] {
        return [beOpeningPart(), reqNationValue('level', '국가규모', '==', 0, '정식 국가가 아니어야합니다.')];
    }

    buildConstraints(_ctx: ConstraintContext, args: FoundingArgs): Constraint[] {
        return [
            beOpeningPart(),
            beLord(),
            wanderingNation(),
            reqNationGeneralCount(2),
            checkNationNameDuplicate(args.nationName),
            allowJoinAction(),
            neutralCity(),
        ];
    }

    resolve(
        context: FoundingResolveContext<TriggerState>,
        args: FoundingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        if (!nation) {
            throw new Error('건국은 국가 정보가 필요합니다.');
        }

        const cityId = general.cityId;
        if ((context.currentYearMonth ?? 0) <= (context.initYearMonth ?? 0)) {
            context.addLog('다음 턴부터 건국할 수 있습니다.', {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return { effects: [], alternative: { commandKey: 'che_인재탐색', args: {} } };
        }
        const color = NATION_COLORS[args.colorType];

        const josaNationUl = JosaUtil.pick(args.nationName, '을');
        const josaNationYi = JosaUtil.pick(args.nationName, '이');
        const josaGeneralYi = JosaUtil.pick(general.name, '이');
        const cityName = context.city?.name ?? '알 수 없는 도시';

        context.addLog(`<D><b>${args.nationName}</b></>${josaNationUl} 건국하였습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`<Y>${general.name}</>${josaGeneralYi} <G><b>${cityName}</b></>에 국가를 건설하였습니다.`, {
            category: LogCategory.SUMMARY,
            scope: LogScope.SYSTEM,
            format: LogFormat.MONTH,
        });
        context.addLog(
            `<Y><b>【건국】</b></>${getNationTypeDisplayName(args.nationType)} <D><b>${args.nationName}</b></>${josaNationYi} 새로이 등장하였습니다.`,
            {
                category: LogCategory.HISTORY,
                scope: LogScope.SYSTEM,
                format: LogFormat.YEAR_MONTH,
            }
        );
        context.addLog(`<D><b>${args.nationName}</b></>${josaNationUl} 건국`, {
            category: LogCategory.HISTORY,
            scope: LogScope.GENERAL,
            format: LogFormat.YEAR_MONTH,
        });
        context.addLog(`<Y>${general.name}</>${josaGeneralYi} <D><b>${args.nationName}</b></>${josaNationUl} 건국`, {
            category: LogCategory.HISTORY,
            scope: LogScope.NATION,
            format: LogFormat.YEAR_MONTH,
        });

        tryApplyUniqueLottery(context, {
            acquireType: '건국',
            reason: ACTION_NAME,
            nationName: args.nationName,
        });

        const effects = [
            createNationPatchEffect(
                {
                    name: args.nationName,
                    typeCode: args.nationType,
                    color: color!,
                    level: 1,
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
                    conflict: {},
                },
                cityId
            ),
            createGeneralPatchEffect<TriggerState>({
                experience: general.experience + 1000,
                dedication: general.dedication + 1000,
            }),
        ];

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const init = resolveInitYearMonth(options.world, options.scenarioMeta);
    return {
        ...base,
        currentYearMonth: options.world.currentYear * 12 + options.world.currentMonth - 1,
        initYearMonth: init.year * 12 + init.month - 1,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '국가',
    reqArg: true,
    availabilityArgs: {
        nationName: 'string',
        nationType: 'string',
        colorType: 'number',
    },
    argsSchema: FOUNDING_ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
