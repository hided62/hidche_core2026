import type {
    City,
    General,
    GeneralTriggerState,
    Nation,
} from '../../../domain/entities.js';
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
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import {
    createCityPatchEffect,
    createDiplomacyPatchEffect,
    createGeneralPatchEffect,
    createNationPatchEffect,
} from '../../engine.js';
import type { TurnCommandEnv } from '../commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type {
    WarAftermathConfig,
    WarEngineConfig,
    WarTimeContext,
} from '../../../war/types.js';
import { resolveWarAftermath } from '../../../war/aftermath.js';
import { resolveWarBattle } from '../../../war/engine.js';
import { simpleSerialize } from '../../../war/utils.js';
import type { UnitSetDefinition } from '../../../world/types.js';

export interface DispatchArgs {
    destCityId: number;
}

export interface DispatchResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    destNation?: Nation | null;
    cities: City[];
    nations: Nation[];
    generals: General<TriggerState>[];
    unitSet: UnitSetDefinition;
    time: WarTimeContext;
    seedBase: string;
    warConfig: WarEngineConfig;
    aftermathConfig: WarAftermathConfig;
}

const ACTION_NAME = '출병';

const parseCityId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

const cloneGeneral = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>
): General<TriggerState> => ({
    ...general,
    stats: { ...general.stats },
    role: {
        ...general.role,
        items: {
            ...general.role.items,
        },
    },
    triggerState: {
        ...general.triggerState,
        flags: { ...general.triggerState.flags },
        counters: { ...general.triggerState.counters },
        modifiers: { ...general.triggerState.modifiers },
        meta: { ...general.triggerState.meta },
    },
    meta: { ...general.meta },
});

const cloneCity = (city: City): City => ({
    ...city,
    meta: { ...city.meta },
});

const cloneNation = (nation: Nation): Nation => ({
    ...nation,
    meta: { ...nation.meta },
});

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements
        GeneralActionDefinition<
            TriggerState,
            DispatchArgs,
            DispatchResolveContext<TriggerState>
        > {
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
        context: DispatchResolveContext<TriggerState>,
        args: DispatchArgs
    ): GeneralActionOutcome<TriggerState> {
        void args;
        const attackerCity = context.city;
        if (!attackerCity) {
            throw new Error('Dispatch requires a city context.');
        }
        const attackerNation = context.nation;
        if (!attackerNation) {
            throw new Error('Dispatch requires a nation context.');
        }

        const destCity = context.destCity;
        const unitSet = context.unitSet;
        const time = context.time;
        const seed = simpleSerialize(
            context.seedBase,
            this.key,
            time.year,
            time.month,
            context.general.id,
            destCity.id
        );

        const cities = context.cities.map(cloneCity);
        const nations = context.nations.map(cloneNation);
        const generals = context.generals.map(cloneGeneral);

        const cityMap = new Map(cities.map((city) => [city.id, city]));
        const nationMap = new Map(nations.map((nation) => [nation.id, nation]));

        const defenderCity = cityMap.get(destCity.id) ?? cloneCity(destCity);
        const defenderNation =
            defenderCity.nationId > 0
                ? nationMap.get(defenderCity.nationId) ?? null
                : null;

        const defenderGenerals = generals.filter(
            (general) =>
                general.cityId === defenderCity.id &&
                general.nationId === defenderCity.nationId
        );

        const battle = resolveWarBattle({
            seed,
            unitSet,
            config: context.warConfig,
            time,
            attacker: {
                general: context.general,
                city: attackerCity,
                nation: attackerNation,
            },
            defenders: defenderGenerals.map((general) => ({
                general,
                city: defenderCity,
                nation: defenderNation,
            })),
            defenderCity,
            defenderNation,
        });

        const aftermath = resolveWarAftermath({
            battle,
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations,
            cities,
            generals,
            unitSet,
            config: context.aftermathConfig,
            time,
            hiddenSeed: context.seedBase,
        });

        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        for (const entry of battle.logs) {
            effects.push({ type: 'log', entry });
        }
        for (const entry of aftermath.logs) {
            effects.push({ type: 'log', entry });
        }

        const generalPatches = new Map<number, General<TriggerState>>();
        const cityPatches = new Map<number, City>();
        const nationPatches = new Map<number, Nation>();

        const addGeneralPatch = (general: General<TriggerState>): void => {
            if (general.id === context.general.id) {
                return;
            }
            generalPatches.set(general.id, cloneGeneral(general));
        };
        const addCityPatch = (city: City): void => {
            if (context.city && city.id === context.city.id) {
                return;
            }
            cityPatches.set(city.id, cloneCity(city));
        };
        const addNationPatch = (nation: Nation): void => {
            if (context.nation && nation.id === context.nation.id) {
                return;
            }
            nationPatches.set(nation.id, cloneNation(nation));
        };

        for (const defender of battle.defenders) {
            addGeneralPatch(defender);
        }
        for (const general of aftermath.generals) {
            addGeneralPatch(general);
        }
        addCityPatch(defenderCity);
        for (const city of aftermath.cities) {
            addCityPatch(city);
        }
        if (defenderNation) {
            addNationPatch(defenderNation);
        }
        for (const nation of aftermath.nations) {
            addNationPatch(nation);
        }

        for (const [id, patch] of generalPatches) {
            effects.push(createGeneralPatchEffect(patch, id));
        }
        for (const [id, patch] of cityPatches) {
            effects.push(createCityPatchEffect(patch, id));
        }
        for (const [id, patch] of nationPatches) {
            effects.push(createNationPatchEffect(patch, id));
        }

        for (const delta of aftermath.diplomacyDeltas) {
            effects.push(
                createDiplomacyPatchEffect(delta.fromNationId, delta.toNationId, {
                    deadDelta: delta.deadDelta,
                })
            );
        }

        return { effects };
    }
}

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_출병',
    category: '군사',
    reqArg: true,
    args: { destCityId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
