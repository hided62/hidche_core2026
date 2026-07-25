import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowRebellion,
    beChief,
    notBeNeutral,
    notLord,
    occupiedCity,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';

const ACTION_NAME = '모반시도';
const ACTION_KEY = 'che_모반시도';

export interface RebellionArgs {}

export interface RebellionResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    nationGenerals?: General<TriggerState>[];
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, RebellionArgs, RebellionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    getInheritanceActiveActionAmount(): number {
        return 1;
    }

    parseArgs(_raw: unknown): RebellionArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: RebellionArgs): Constraint[] {
        return [notBeNeutral(), beChief(), occupiedCity(), suppliedCity(), notLord(), allowRebellion()];
    }

    resolve(context: RebellionResolveContext<TriggerState>, _args: RebellionArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        if (!nation) {
            throw new Error('모반시도는 국가 정보가 필요합니다.');
        }

        const lord =
            context.nationGenerals?.find(
                (candidate) => candidate.nationId === nation.id && candidate.officerLevel === 12
            ) ?? null;
        if (!lord || lord.id === general.id) {
            throw new Error('모반할 대상 군주가 없습니다.');
        }

        const josaYi = JosaUtil.pick(general.name, '이');
        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        context.addLog(
            `<Y><b>【모반】</b></><Y>${general.name}</>${josaYi} <D><b>${nation.name}</b></>의 군주 자리를 찬탈했습니다.`,
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
            }
        );
        context.addLog(`<Y>${general.name}</>${josaYi} <Y>${lord.name}</>에게서 군주자리를 찬탈`, {
            scope: LogScope.NATION,
            category: LogCategory.HISTORY,
        });
        context.addLog('모반에 성공했습니다.', {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`모반으로 <D><b>${nation.name}</b></>의 군주자리를 찬탈`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
        });

        effects.push(
            createLogEffect(`<Y>${general.name}</>에게 군주의 자리를 뺏겼습니다.`, {
                scope: LogScope.GENERAL,
                generalId: lord.id,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
            }),
            createLogEffect(
                `<D><b>${general.name}</b></>의 모반으로 인해 <D><b>${nation.name}</b></>의 군주자리를 박탈당함`,
                {
                    scope: LogScope.GENERAL,
                    generalId: lord.id,
                    category: LogCategory.HISTORY,
                    format: LogFormat.PLAIN,
                }
            ),
            createGeneralPatchEffect(
                {
                    officerLevel: 12,
                    meta: {
                        ...general.meta,
                        officer_city: 0,
                        officerCity: 0,
                    },
                },
                general.id
            ),
            createGeneralPatchEffect(
                {
                    officerLevel: 1,
                    experience: Math.floor(lord.experience * 0.7),
                    meta: {
                        ...lord.meta,
                        officer_city: 0,
                        officerCity: 0,
                    },
                },
                lord.id
            )
        );

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const nationId = base.nation?.id ?? base.general.nationId;
    return {
        ...base,
        nationGenerals: options.worldRef?.listGenerals().filter((general) => general.nationId === nationId) ?? [],
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '국가',
    reqArg: false,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
