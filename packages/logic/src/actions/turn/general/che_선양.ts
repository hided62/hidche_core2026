import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { beLord, existsDestGeneral, friendlyDestGeneral } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

const ACTION_NAME = '선양';
const ACTION_KEY = 'che_선양';
const ARGS_SCHEMA = z.object({
    destGeneralID: z.number().int().positive(),
});
export type AbdicationArgs = z.infer<typeof ARGS_SCHEMA>;

export interface AbdicationResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral?: General<TriggerState>;
}

const blockedPenaltyKeys = ['noChief', 'noFoundNation', 'noAmbassador'] as const;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, AbdicationArgs, AbdicationResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): AbdicationArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: AbdicationArgs): Constraint[] {
        return [beLord()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: AbdicationArgs): Constraint[] {
        return [beLord(), existsDestGeneral(), friendlyDestGeneral()];
    }

    resolve(context: AbdicationResolveContext<TriggerState>, _args: AbdicationArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const destGeneral = context.destGeneral;
        if (!nation) {
            throw new Error('선양은 국가 정보가 필요합니다.');
        }
        if (!destGeneral) {
            throw new Error('선양 대상 장수가 없습니다.');
        }

        const penaltyRaw = destGeneral.meta.penalty;
        if (penaltyRaw && typeof penaltyRaw === 'object' && !Array.isArray(penaltyRaw)) {
            const penaltyMap = penaltyRaw as Record<string, unknown>;
            for (const penaltyKey of blockedPenaltyKeys) {
                if (Object.prototype.hasOwnProperty.call(penaltyMap, penaltyKey)) {
                    return {
                        effects: [
                            createLogEffect('선양할 수 없는 장수입니다.', {
                                scope: LogScope.GENERAL,
                                category: LogCategory.ACTION,
                                format: LogFormat.MONTH,
                            }),
                        ],
                    };
                }
            }
        }

        const josaYi = JosaUtil.pick(general.name, '이');
        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        context.addLog(`<Y><b>【선양】</b></><Y>${general.name}</>${josaYi} <D><b>${nation.name}</b></>의 군주 자리를 <Y>${destGeneral.name}</>에게 선양했습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
        });
        context.addLog(`<Y>${general.name}</>${josaYi} <Y>${destGeneral.name}</>에게 선양`, {
            scope: LogScope.NATION,
            category: LogCategory.HISTORY,
        });
        context.addLog(`<Y>${destGeneral.name}</>에게 군주의 자리를 물려줍니다.`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`<D><b>${nation.name}</b></>의 군주자리를 <Y>${destGeneral.name}</>에게 선양`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
        });

        effects.push(
            createLogEffect(`<Y>${general.name}</>에게서 군주의 자리를 물려받습니다.`, {
                scope: LogScope.GENERAL,
                generalId: destGeneral.id,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
            }),
            createLogEffect(`<D><b>${nation.name}</b></>의 군주자리를 물려 받음`, {
                scope: LogScope.GENERAL,
                generalId: destGeneral.id,
                category: LogCategory.HISTORY,
                format: LogFormat.PLAIN,
            }),
            createGeneralPatchEffect(
                {
                    officerLevel: 12,
                    meta: {
                        ...destGeneral.meta,
                        officer_city: 0,
                        officerCity: 0,
                    },
                },
                destGeneral.id
            ),
            createGeneralPatchEffect(
                {
                    officerLevel: 1,
                    experience: Math.floor(general.experience * 0.7),
                    meta: {
                        ...general.meta,
                        officer_city: 0,
                        officerCity: 0,
                    },
                },
                general.id
            )
        );

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder<AbdicationArgs> = (base, options) => {
    const destGeneralID = options.actionArgs.destGeneralID;
    if (typeof destGeneralID !== 'number') {
        return null;
    }
    const destGeneral = options.worldRef?.getGeneralById(destGeneralID) ?? undefined;
    if (!destGeneral) {
        return null;
    }

    return {
        ...base,
        destGeneral,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '국가',
    reqArg: true,
    availabilityArgs: {
        destGeneralID: 'number',
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
