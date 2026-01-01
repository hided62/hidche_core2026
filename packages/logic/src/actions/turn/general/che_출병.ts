import type { GeneralTriggerState } from '../../../domain/entities.js';
import type { Constraint, ConstraintContext } from '../../../constraints/types.js';
import {
    existsDestCity,
    notBeNeutral,
    notOccupiedDestCity,
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
import type { GeneralTurnCommandSpec } from './index.js';

export interface DispatchArgs {
    destCityId: number;
}

const ACTION_NAME = '출병';

const parseCityId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, DispatchArgs> {
    public readonly key = 'che_출병';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): DispatchArgs | null {
        const data = raw as { destCityId?: unknown };
        const destCityId = parseCityId(data?.destCityId);
        if (destCityId === null) {
            return null;
        }
        return { destCityId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: DispatchArgs): Constraint[] {
        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestCity(),
            notOccupiedDestCity(),
        ];
    }

    resolve(
        _context: GeneralActionResolveContext<TriggerState>,
        args: DispatchArgs
    ): GeneralActionOutcome<TriggerState> {
        void _context;
        return {
            effects: [
                createLogEffect(`${ACTION_NAME}을 준비했습니다. (목표 도시 ${args.destCityId})`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_출병',
    category: '군사',
    reqArg: true,
    args: { destCityId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
