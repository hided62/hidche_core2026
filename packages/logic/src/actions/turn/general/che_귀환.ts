import type { City, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    // allow,
    notBeNeutral,
    notWanderingNation,
    notCapital,
    readMetaNumberFromUnknown,
    // unknownOrDeny,
} from '@sammo-ts/logic/constraints/presets.js';
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
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface ReturnArgs {}

const ACTION_NAME = '귀환';
const ACTION_KEY = 'che_귀환';

export interface ReturnResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    nationCities?: City[];
    // Need city list to find officer city name? Or just assume it exists if ID is valid?
    // Actually we need the city object to get its name for logging.
    // Legacy: CityConst::byID($destCityID)->name
}

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, ReturnArgs> {
    readonly key = ACTION_KEY;

    resolve(context: ReturnResolveContext<TriggerState>, _args: ReturnArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const effects: GeneralActionEffect<TriggerState>[] = [];

        if (!nation) {
            throw new Error('Return requires a nation context.');
        }

        const officerLevel = general.officerLevel;
        let destCityId: number | null = null;

        // Logic: specific officer levels return to their assigned city
        // 2 (Chief?), 3 (Staff?), 4 (Governor/Taishu)
        if (officerLevel >= 2 && officerLevel <= 4) {
            const officerCity = readMetaNumberFromUnknown(general.meta, 'officer_city');
            if (officerCity) {
                destCityId = officerCity;
            }
        }

        if (destCityId === null) {
            destCityId = nation.capitalCityId;
        }

        if (destCityId === null) {
            throw new Error('Destination city not found (No capital?).');
        }

        // We need city name for log.
        // If we don't have city object in context, we can't log name easily unless we fetch it.
        // We should add `getWorldCity(id)` to context or something.
        // Or assume resolving involves looking up city.

        // For now, let's look it up from `context.nationCities` if available, or request it in context builder.
        // Actually context has `city` (location), but dest is different.
        // We need to request `destCity` in context builder? But we determine it dynamically.
        // We can request ALL cities or use `worldRef` if available in context?
        // `GeneralActionResolveContext` usually doesn't have `worldRef`.
        // We must rely on `contextBuilder` to populate necessary data.

        // Let's iterate `nationCities` if provided.
        // Or use `ActionContextBuilder` to fetch city by ID if we knew it?
        // We don't know ID until we check logic.

        // In `ActionContextBuilder`, we can just load all cities of the nation?
        // `nationCities` is common.

        let destCityName = '알 수 없는 도시';
        let foundDestCity: City | undefined;

        if (context.nationCities) {
            foundDestCity = context.nationCities.find((c) => c.id === destCityId);
            if (foundDestCity) {
                destCityName = foundDestCity.name;
            }
        }

        const josaRo = JosaUtil.pick(destCityName, '로');
        // const date = 'XX:XX';
        // Legacy: <1>$date</>
        // LogFormat.MONTH handles date prefix usually. LogFormat.HM handles HH:MM.
        // Legacy output: "StartCity로 귀환했습니다. 10:00"

        context.addLog(`<G><b>${destCityName}</b></>${josaRo} 귀환했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH, // Or HM if we want HH:MM suffix?
            // Legacy uses explicit date at end.
            // We can just use standard MONTH format for now.
        });

        const exp = 70;
        const ded = 100;

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    cityId: destCityId,
                    experience: general.experience + exp,
                    dedication: general.dedication + ded,
                    stats: {
                        ...general.stats,
                        leadership: general.stats.leadership, // Update not needed unless verified
                    },
                    // leadership_exp + 1 in legacy?
                    // "increaseVar('leadership_exp', 1)"
                    // General entity doesn't show leadership_exp in Interface?
                    // Checking `entities.ts`... `stats` is Leadership/Strength/Intel.
                    // `experience` is total exp?
                    // If `leadership_exp` is missing in Entity, we must use meta or omit.
                    // Default to meta if needed.
                    meta: {
                        ...general.meta,
                        leadership_exp: (readMetaNumberFromUnknown(general.meta, 'leadership_exp') ?? 0) + 1,
                    },
                },
                general.id
            )
        );

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ReturnArgs, ReturnResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(_raw: unknown): ReturnArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: ReturnArgs): Constraint[] {
        return [
            notBeNeutral(),
            notWanderingNation(),
            notCapital(true), // Check if ALREADY in capital (true = check current city)
        ];
    }

    resolve(context: ReturnResolveContext<TriggerState>, args: ReturnArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    return {
        ...base,
        // We effectively need all cities to find the destination name if it's not the capital.
        // Or at least nation cities.
        nationCities: options.worldRef?.listCities().filter((c) => c.nationId === base.nation?.id) ?? [],
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_귀환',
    category: '군사',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
