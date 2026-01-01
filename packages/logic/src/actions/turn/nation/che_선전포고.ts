import type { GeneralTriggerState } from '../../../domain/entities.js';
import type { Constraint, ConstraintContext } from '../../../constraints/types.js';
import {
    beChief,
    existsDestNation,
    notBeNeutral,
    occupiedCity,
    suppliedCity,
} from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import { createLogEffect } from '../../engine.js';
import { LogCategory, LogFormat, LogScope } from '../../../logging/types.js';
import type { TurnCommandEnv } from '../commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';

export interface DeclareWarArgs {
    destNationId: number;
}

const ACTION_NAME = '선전포고';

const parseNationId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, DeclareWarArgs> {
    public readonly key = 'che_선전포고';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): DeclareWarArgs | null {
        const data = raw as { destNationId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        if (destNationId === null) {
            return null;
        }
        return { destNationId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: DeclareWarArgs): Constraint[] {
        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            beChief(),
            existsDestNation(),
        ];
    }

    resolve(
        _context: GeneralActionResolveContext<TriggerState>,
        args: DeclareWarArgs
    ): GeneralActionOutcome<TriggerState> {
        void _context;
        return {
            effects: [
                createLogEffect(
                    `${ACTION_NAME}을 준비했습니다. (국가 ${args.destNationId})`,
                    {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }
                ),
            ],
        };
    }
}

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_선전포고',
    category: '외교',
    reqArg: true,
    args: { destNationId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
