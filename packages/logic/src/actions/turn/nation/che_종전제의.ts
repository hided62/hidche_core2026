import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyBetweenStatus,
    beChief,
    existsDestNation,
    notBeNeutral,
    occupiedCity,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect, createMessageEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { NationTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destNationId: z.number().int().positive(),
});
export type StopWarProposalArgs = z.infer<typeof ARGS_SCHEMA>;

interface StopWarProposalContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
    messageValidMinutes: number;
    messageTime: Date;
}

const ACTION_NAME = '종전 제의';

// 종전 제의를 처리하는 국가 커맨드.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, StopWarProposalArgs, StopWarProposalContext<TriggerState>> {
    public readonly key = 'che_종전제의';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): StopWarProposalArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: StopWarProposalArgs): Constraint[] {
        return [beChief(), notBeNeutral(), occupiedCity(), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: StopWarProposalArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestNation(),
            allowDiplomacyBetweenStatus([0, 1], '선포, 전쟁중인 상대국에게만 가능합니다.'),
        ];
    }

    resolve(
        context: StopWarProposalContext<TriggerState>,
        _args: StopWarProposalArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, destNation } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.')] };
        }
        const destNationName = destNation.name;
        const josaRo = JosaUtil.pick(destNationName, '로');
        const validUntil = new Date(context.messageTime.getTime() + context.messageValidMinutes * 60_000);
        return {
            effects: [
                createMessageEffect({
                    msgType: 'diplomacy',
                    src: {
                        generalId: general.id,
                        generalName: general.name,
                        nationId: nation.id,
                        nationName: nation.name,
                        color: nation.color,
                        icon: '',
                    },
                    dest: {
                        generalId: 0,
                        generalName: '',
                        nationId: destNation.id,
                        nationName: destNation.name,
                        color: destNation.color,
                        icon: '',
                    },
                    text: `${nation.name}의 종전 제의 서신`,
                    time: context.messageTime,
                    validUntil,
                    option: { action: 'stopWar', deletable: false },
                }),
                createLogEffect(`<D><b>${destNationName}</b></>${josaRo} 종전 제의 서신을 보냈습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder: ActionContextBuilder<StopWarProposalArgs> = (base, options) => {
    const destNation = options.worldRef?.getNationById(options.actionArgs.destNationId);
    if (!destNation) {
        return null;
    }
    return {
        ...base,
        destNation,
        messageTime: base.general.turnTime,
        messageValidMinutes: Math.max(30, Math.floor((options.world.tickSeconds / 60) * 3)),
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_종전제의',
    category: '외교',
    reqArg: true,
    availabilityArgs: { destNationId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
