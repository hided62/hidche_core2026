import type { City, General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { beLord, wanderingNation } from '@sammo-ts/logic/constraints/presets.js';
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
import { JosaUtil } from '@sammo-ts/common';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

const ACTION_NAME = '해산';
const ACTION_KEY = 'che_해산';

export interface DisbandFactionArgs {}

export interface DisbandFactionResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    nationGenerals?: General<TriggerState>[];
    nationCities?: City[];
    currentYearMonth?: number;
    initYearMonth?: number;
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DisbandFactionArgs, DisbandFactionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(_raw: unknown): DisbandFactionArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: DisbandFactionArgs): Constraint[] {
        return [beLord(), wanderingNation()];
    }

    resolve(
        context: DisbandFactionResolveContext<TriggerState>,
        _args: DisbandFactionArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        if (!nation) {
            throw new Error('해산은 국가 정보가 필요합니다.');
        }

        if ((context.currentYearMonth ?? 0) <= (context.initYearMonth ?? 0)) {
            context.addLog('다음 턴부터 해산할 수 있습니다.', {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return { effects: [], alternative: { commandKey: 'che_인재탐색', args: {} } };
        }

        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        const baseGold = this.env.baseGold > 0 ? this.env.baseGold : 1000;
        const baseRice = this.env.baseRice > 0 ? this.env.baseRice : 1000;

        const nationGenerals = context.nationGenerals ?? [];
        for (const targetGeneral of nationGenerals) {
            const isActor = targetGeneral.id === general.id;
            effects.push(
                createGeneralPatchEffect(
                    {
                        nationId: 0,
                        officerLevel: 0,
                        troopId: 0,
                        gold: Math.min(targetGeneral.gold, baseGold),
                        rice: Math.min(targetGeneral.rice, baseRice),
                        meta: {
                            ...targetGeneral.meta,
                            belong: 0,
                            officer_city: 0,
                            officerCity: 0,
                            ...(isActor ? { makelimit: 12 } : {}),
                        },
                    },
                    targetGeneral.id
                )
            );
        }

        const nationCities = context.nationCities ?? [];
        for (const city of nationCities) {
            effects.push(
                createCityPatchEffect(
                    {
                        nationId: 0,
                        frontState: 0,
                    },
                    city.id
                )
            );
        }

        effects.push(
            createNationPatchEffect(
                {
                    meta: {
                        ...nation.meta,
                        collapsed: true,
                    },
                },
                nation.id
            )
        );

        const josaYi = JosaUtil.pick(general.name, '이');
        const josaUl = JosaUtil.pick(nation.name, '을');

        context.addLog('세력을 해산했습니다.', {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`<Y>${general.name}</>${josaYi} 세력을 해산했습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.ACTION,
        });
        context.addLog(`<D><b>${nation.name}</b></>${josaUl} 해산`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
        });

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
    const worldRef = options.worldRef;
    const currentYear = options.world.currentYear;
    const currentMonth = options.world.currentMonth;
    const initYear = resolveStartYear(currentYear, options.scenarioMeta?.startYear);
    const initMonth = 1;

    return {
        ...base,
        nationGenerals: worldRef?.listGenerals().filter((general) => general.nationId === nationId) ?? [],
        nationCities: worldRef?.listCities().filter((city) => city.nationId === nationId) ?? [],
        currentYearMonth: currentYear * 12 + currentMonth - 1,
        initYearMonth: initYear * 12 + initMonth - 1,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '국가',
    reqArg: false,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
