import type { City, General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowJoinAction,
    beLord,
    beOpeningPart,
    checkNationNameDuplicate,
    reqNationGeneralCount,
    reqNationValue,
    wanderingNation,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import {
    createCityPatchEffect,
    createGeneralPatchEffect,
    createNationPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';
import { JosaUtil } from '@sammo-ts/common';

const ACTION_NAME = '무작위 도시 건국';
const ACTION_KEY = 'che_무작위건국';
const ARGS_SCHEMA = z.object({
    nationName: z.string().min(1),
    nationType: z.string().min(1),
    colorType: z.number(),
});
export type FoundingArgs = z.infer<typeof ARGS_SCHEMA>;

export interface RandomFoundingResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    allCities?: City[];
    nationGenerals?: General<TriggerState>[];
    currentYearMonth?: number;
    initYearMonth?: number;
}

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
> implements GeneralActionDefinition<TriggerState, FoundingArgs, RandomFoundingResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): FoundingArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
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
        ];
    }

    resolve(
        context: RandomFoundingResolveContext<TriggerState>,
        args: FoundingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        if (!nation) {
            throw new Error('건국은 국가 정보가 필요합니다.');
        }

        if ((context.currentYearMonth ?? 0) <= (context.initYearMonth ?? 0)) {
            context.addLog('다음 턴부터 건국할 수 있습니다.', {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return { effects: [], alternative: { commandKey: 'che_인재탐색', args: {} } };
        }

        if (args.colorType < 0 || args.colorType >= NATION_COLORS.length) {
            throw new Error('Invalid color type');
        }

        const candidates = (context.allCities ?? []).filter((city) => city.nationId === 0 && [5, 6].includes(city.level));
        if (candidates.length === 0) {
            context.addLog('건국할 수 있는 도시가 없습니다.', {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return { effects: [], alternative: { commandKey: 'che_해산', args: {} } };
        }

        const picked = candidates[context.rng.nextInt(0, candidates.length)]!;
        const cityId = picked.id;

        const josaNationUl = JosaUtil.pick(args.nationName, '을');
        const josaNationYi = JosaUtil.pick(args.nationName, '이');
        const josaGeneralYi = JosaUtil.pick(general.name, '이');

        context.addLog(`<D><b>${args.nationName}</b></>${josaNationUl} 건국하였습니다.`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`<Y>${general.name}</>${josaGeneralYi} <G><b>${picked.name}</b></>에 국가를 건설하였습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.ACTION,
        });
        context.addLog(`<Y><b>【건국】</b></>${args.nationType} <D><b>${args.nationName}</b></>${josaNationYi} 새로이 등장하였습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
        });
        context.addLog(`<D><b>${args.nationName}</b></>${josaNationUl} 건국`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
        });
        context.addLog(`<Y>${general.name}</>${josaGeneralYi} <D><b>${args.nationName}</b></>${josaNationUl} 건국`, {
            scope: LogScope.NATION,
            category: LogCategory.HISTORY,
        });

        tryApplyUniqueLottery(context, { acquireType: '건국', reason: ACTION_NAME });

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createNationPatchEffect(
                {
                    name: args.nationName,
                    typeCode: args.nationType,
                    color: NATION_COLORS[args.colorType]!,
                    level: 1,
                    capitalCityId: cityId,
                    meta: {
                        ...nation.meta,
                        can_국기변경: 1,
                        can_무작위수도이전: 1,
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
                experience: general.experience + 1000,
                dedication: general.dedication + 1000,
            }),
        ];

        if (general.cityId !== cityId) {
            effects.push(createGeneralPatchEffect({ cityId }, general.id));
            const nationGenerals = context.nationGenerals ?? [];
            for (const nationGeneral of nationGenerals) {
                if (nationGeneral.id === general.id) {
                    continue;
                }
                effects.push(createGeneralPatchEffect({ cityId }, nationGeneral.id));
            }
        }

        return { effects };
    }
}

const resolveStartYear = (currentYear: number, raw: unknown): number => {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.floor(raw);
    }
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return currentYear;
};

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const nationId = base.nation?.id ?? base.general.nationId;
    const currentYear = options.world.currentYear;
    const currentMonth = options.world.currentMonth;

    const startYear = resolveStartYear(currentYear, options.scenarioMeta?.startYear);
    const initYear = startYear;
    const initMonth = 1;

    return {
        ...base,
        allCities: options.worldRef?.listCities() ?? [],
        nationGenerals: options.worldRef?.listGenerals().filter((general) => general.nationId === nationId) ?? [],
        currentYearMonth: currentYear * 12 + currentMonth - 1,
        initYearMonth: initYear * 12 + initMonth - 1,
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
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
