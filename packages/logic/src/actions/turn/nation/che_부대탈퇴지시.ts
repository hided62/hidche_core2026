import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    alwaysFail,
    beChief,
    existsDestGeneral,
    friendlyDestGeneral,
    notBeNeutral,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destGeneralId: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().positive()
    ),
});
export type TroopKickArgs = z.infer<typeof ARGS_SCHEMA>;

export interface TroopKickResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral: General<TriggerState>;
}

const ACTION_NAME = '부대 탈퇴 지시';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, TroopKickArgs, TroopKickResolveContext<TriggerState>> {
    public readonly key = 'che_부대탈퇴지시';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): TroopKickArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: TroopKickArgs): Constraint[] {
        return [notBeNeutral(), beChief()];
    }

    buildConstraints(ctx: ConstraintContext, _args: TroopKickArgs): Constraint[] {
        if (ctx.destGeneralId !== undefined && ctx.destGeneralId === ctx.actorId) {
            return [alwaysFail('본인입니다')];
        }
        return [notBeNeutral(), beChief(), existsDestGeneral(), friendlyDestGeneral()];
    }

    resolve(context: TroopKickResolveContext<TriggerState>, _args: TroopKickArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const destGeneral = context.destGeneral;
        const destGeneralName = destGeneral.name;
        const josaUn = JosaUtil.pick(destGeneralName, '은');
        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        if (destGeneral.troopId === 0) {
            context.addLog(`<Y>${destGeneralName}</>${josaUn} 부대원이 아닙니다.`);
            return { effects };
        }

        if (destGeneral.troopId === destGeneral.id) {
            context.addLog(`<Y>${destGeneralName}</>${josaUn} 부대장입니다.`);
            return { effects };
        }

        effects.push(createGeneralPatchEffect({ troopId: 0 } as Partial<General<TriggerState>>, destGeneral.id));

        effects.push(
            createLogEffect(`<Y>${destGeneralName}</>에게 부대 탈퇴를 지시했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            })
        );
        effects.push(
            createLogEffect(`<Y>${general.name}</>에게 부대 탈퇴를 지시 받았습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
                generalId: destGeneral.id,
            })
        );

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder<TroopKickArgs> = (base, options) => {
    const destGeneralId = options.actionArgs.destGeneralId;
    if (typeof destGeneralId !== 'number') {
        return null;
    }
    const destGeneral = options.worldRef?.getGeneralById(destGeneralId);
    if (!destGeneral) {
        return null;
    }
    return {
        ...base,
        destGeneral,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_부대탈퇴지시',
    category: '인사',
    reqArg: true,
    availabilityArgs: { destGeneralId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
