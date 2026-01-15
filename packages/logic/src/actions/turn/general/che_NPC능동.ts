import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { mustBeNPC, existsDestCity } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import { parseArgsWithSchema } from '../parseArgs.js';

export type NPCSelfResolveContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> =
    GeneralActionResolveContext<TriggerState> & {
        map?: MapDefinition;
    };

const ACTION_NAME = 'NPC능동';
const ACTION_KEY = 'che_NPC능동';
const ARGS_SCHEMA = z.discriminatedUnion('optionText', [
    z.object({
        optionText: z.literal('순간이동'),
        destCityId: z.number(),
    }),
]);
export type NPCSelfArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, NPCSelfArgs> {
    readonly key = ACTION_KEY;

    resolve(context: NPCSelfResolveContext<TriggerState>, args: NPCSelfArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const effects: GeneralActionEffect<TriggerState>[] = [];

        if (args.optionText === '순간이동') {
            if (args.destCityId === undefined) {
                // Should be caught by constraints/validation, but safe guard
                throw new Error('Missing destCityId for instant move');
            }

            const destCityId = args.destCityId;
            let destCityName = `도시(${destCityId})`;
            if (context.map) {
                const c = context.map.cities.find((ct) => ct.id === destCityId);
                if (c) destCityName = c.name;
            }

            const josaRo = JosaUtil.pick(destCityName, '로');

            // Legacy log: "NPC 전용 명령을 이용해 {$cityName}{$josaRo} 이동했습니다."
            // Note: Legacy didn't use <G> tag here based on file content, but most move commands do.
            // Following strict legacy log parity from file:
            // "NPC 전용 명령을 이용해 {$cityName}{$josaRo} 이동했습니다."
            context.addLog(`NPC 전용 명령을 이용해 ${destCityName}${josaRo} 이동했습니다.`, {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });

            effects.push(
                createGeneralPatchEffect(
                    {
                        ...general,
                        cityId: destCityId,
                        // Legacy doesn't show cost/dedication/exp change in 'che_NPC능동.php' run() method for '순간이동'
                        // It only does setVar('city', destCityID) and Logging and LastTurn.
                    },
                    general.id
                )
            );
        }

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, NPCSelfArgs, NPCSelfResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): NPCSelfArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildConstraints(_ctx: ConstraintContext, args: NPCSelfArgs): Constraint[] {
        const constraints = [mustBeNPC()];

        if (args.optionText === '순간이동') {
            constraints.push(existsDestCity());
        }

        return constraints;
    }

    resolve(context: NPCSelfResolveContext<TriggerState>, args: NPCSelfArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_NPC능동',
    category: '특수', // Valid category? Legacy didn't specify category in static prop usually, handled by mapping. Defaulting to '특수'.
    reqArg: true,
    availabilityArgs: { optionText: '', destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
