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
    createLogEffect,
    createNationPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { resolveInitYearMonth } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

const ACTION_NAME = '해산';
const ACTION_KEY = 'che_해산';

const readMetaNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

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

        const defaultGold = this.env.defaultNpcGold > 0 ? this.env.defaultNpcGold : 1000;
        const defaultRice = this.env.defaultNpcRice > 0 ? this.env.defaultNpcRice : 1000;

        const nationGenerals = [...(context.nationGenerals ?? [])].sort((left, right) => {
            const leftIsActor = left.id === general.id;
            const rightIsActor = right.id === general.id;
            if (leftIsActor !== rightIsActor) return leftIsActor ? 1 : -1;
            return left.id - right.id;
        });
        const nonActorCount = nationGenerals.filter((targetGeneral) => targetGeneral.id !== general.id).length;
        for (const targetGeneral of nationGenerals) {
            const isActor = targetGeneral.id === general.id;
            const belong = readMetaNumber(targetGeneral.meta.belong);
            const maxBelong = readMetaNumber(targetGeneral.meta.max_belong);
            effects.push(
                createGeneralPatchEffect(
                    {
                        nationId: 0,
                        officerLevel: 0,
                        troopId: 0,
                        gold: Math.min(targetGeneral.gold, defaultGold),
                        // 레거시는 전체 장수의 gold를 먼저 제한한 뒤 rice UPDATE의
                        // WHERE에도 gold를 사용한다. 따라서 다른 장수의 rice는
                        // 그대로 남고, 실행 장수만 아래 명시적 제한을 받는다.
                        rice: isActor ? Math.min(targetGeneral.rice, defaultRice) : targetGeneral.rice,
                        meta: {
                            ...targetGeneral.meta,
                            belong: 0,
                            officer_city: 0,
                            officerCity: 0,
                            permission: 'normal',
                            ...(targetGeneral.npcState < 2 ? { max_belong: Math.max(belong, maxBelong) } : {}),
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
            category: LogCategory.SUMMARY,
        });
        context.addLog(`<D><b>${nation.name}</b></>${josaUl} 해산`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        const josaUn = JosaUtil.pick(nation.name, '은');
        const josaNationYi = JosaUtil.pick(nation.name, '이');
        effects.push(
            createLogEffect(`<R><b>【멸망】</b></><D><b>${nation.name}</b></>${josaUn} <R>멸망</>했습니다.`, {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            })
        );
        for (const [targetIndex, targetGeneral] of nationGenerals.entries()) {
            const legacyFlushGroup = targetGeneral.id === general.id ? undefined : targetIndex - nonActorCount;
            effects.push(
                createLogEffect(`<D><b>${nation.name}</b></>${josaNationYi} <R>멸망</>했습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                    generalId: targetGeneral.id,
                    ...(legacyFlushGroup === undefined ? {} : { legacyFlushGroup }),
                }),
                createLogEffect(`<D><b>${nation.name}</b></>${josaNationYi} <R>멸망</>`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                    generalId: targetGeneral.id,
                    ...(legacyFlushGroup === undefined ? {} : { legacyFlushGroup }),
                })
            );
        }

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const nationId = base.nation?.id ?? base.general.nationId;
    const worldRef = options.worldRef;
    const currentYear = options.world.currentYear;
    const currentMonth = options.world.currentMonth;
    const init = resolveInitYearMonth(options.world, options.scenarioMeta);

    return {
        ...base,
        nationGenerals: worldRef?.listGenerals().filter((general) => general.nationId === nationId) ?? [],
        nationCities: worldRef?.listCities().filter((city) => city.nationId === nationId) ?? [],
        currentYearMonth: currentYear * 12 + currentMonth - 1,
        initYearMonth: init.year * 12 + init.month - 1,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '국가',
    reqArg: false,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
