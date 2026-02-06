import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beNeutral,
    existsDestNation,
    reqEnvValue,
    allowJoinAction,
    noPenalty,
    allowJoinDestNation,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

const ACTION_NAME = '임관';
const ARGS_SCHEMA = z.object({
    destNationId: z.number(),
});
export type AppointmentArgs = z.infer<typeof ARGS_SCHEMA>;

const parseNationId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, AppointmentArgs> {
    public readonly key = 'che_임관';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): AppointmentArgs | null {
        const data = parseArgsWithSchema(ARGS_SCHEMA, raw);
        if (!data) {
            return null;
        }
        const destNationId = parseNationId(data.destNationId);
        if (destNationId === null) {
            return null;
        }
        return { destNationId };
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: AppointmentArgs): Constraint[] {
        return [
            reqEnvValue('join_mode', '!=', 'onlyRandom', '랜덤 임관만 가능합니다'),
            beNeutral(),
            allowJoinAction(),
            noPenalty('noChosenAssignment'),
        ];
    }

    buildConstraints(_ctx: ConstraintContext, _args: AppointmentArgs): Constraint[] {
        const env = _ctx.env;
        const year = typeof env.year === 'number' ? env.year : 0;
        const startYear = typeof env.startyear === 'number' ? env.startyear : 0;
        const relYear = year - startYear;

        return [
            reqEnvValue('join_mode', '!=', 'onlyRandom', '랜덤 임관만 가능합니다'),
            beNeutral(),
            existsDestNation(),
            allowJoinDestNation(relYear),
            allowJoinAction(),
            noPenalty('noChosenAssignment'),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        args: AppointmentArgs
    ): GeneralActionOutcome<TriggerState> {
        const destNationName = context.nation?.name ?? `${args.destNationId}`;
        context.addLog(`<D>${destNationName}</>에 임관했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        const effects = [
            createGeneralPatchEffect<TriggerState>({
                nationId: args.destNationId,
                officerLevel: 1, // Common Officer
            }),
        ];

        return { effects };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_임관',
    category: '전략',
    reqArg: true,
    availabilityArgs: { destNationId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
