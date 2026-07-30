import type { TraitModule } from '@sammo-ts/logic/actionModules/traits/types.js';
import {
    isWarTraitKey,
    type WarTraitKey,
    WarTraitLoader,
} from '@sammo-ts/logic/actionModules/traits/war/index.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_부상무효 } from '@sammo-ts/logic/war/triggers/che_견고.js';

export const EVENT_DOMESTIC_TRAIT_KEYS = [
    'che_event_귀병',
    'che_event_신산',
    'che_event_환술',
    'che_event_집중',
    'che_event_신중',
    'che_event_반계',
    'che_event_보병',
    'che_event_궁병',
    'che_event_기병',
    'che_event_공성',
    'che_event_돌격',
    'che_event_무쌍',
    'che_event_견고',
    'che_event_위압',
    'che_event_저격',
    'che_event_필살',
    'che_event_징병',
    'che_event_의술',
    'che_event_격노',
    'che_event_척사',
] as const;

export type EventDomesticTraitKey = (typeof EVENT_DOMESTIC_TRAIT_KEYS)[number];
export type EventDomesticTraitModule = TraitModule;
export const EVENT_GYEONGO_RAISE_TYPE = BaseWarUnitTrigger.TYPE_ITEM;

export const isEventDomesticTraitKey = (value: string): value is EventDomesticTraitKey =>
    EVENT_DOMESTIC_TRAIT_KEYS.includes(value as EventDomesticTraitKey);

const resolveWarKey = (key: EventDomesticTraitKey): WarTraitKey => {
    const warKey = key.replace(/^che_event_/, 'che_');
    if (!isWarTraitKey(warKey)) {
        throw new Error(`Event domestic trait has no canonical war trait: ${key}`);
    }
    return warKey;
};

const withRefEventOverrides = (
    key: EventDomesticTraitKey,
    canonical: TraitModule
): EventDomesticTraitModule => {
    const { selection: _selection, ...behavior } = canonical;
    const alias: EventDomesticTraitModule = {
        ...behavior,
        key,
        kind: 'domestic',
    };

    if (key === 'che_event_무쌍' && canonical.getWarPowerMultiplier) {
        alias.getWarPowerMultiplier = (context, unit, oppose) => {
            const general =
                'getGeneral' in unit &&
                typeof (unit as { getGeneral?: unknown }).getGeneral === 'function'
                    ? (
                          unit as typeof unit & {
                              getGeneral: () => { role: { specialWar: string | null } };
                          }
                      ).getGeneral()
                    : null;
            return general?.role.specialWar === canonical.key
                ? [1, 1]
                : canonical.getWarPowerMultiplier!(context, unit, oppose);
        };
    }

    if (key === 'che_event_견고') {
        alias.getBattleInitTriggerList = (context) => {
            if (!context.unit) return null;
            return new WarTriggerCaller(
                new che_부상무효(context.unit, EVENT_GYEONGO_RAISE_TYPE)
            );
        };
        alias.getBattlePhaseTriggerList = (context) => {
            if (!context.unit) return null;
            return new WarTriggerCaller(
                new che_부상무효(context.unit, EVENT_GYEONGO_RAISE_TYPE)
            );
        };
    }

    return alias;
};

export class EventDomesticTraitLoader {
    private readonly cache = new Map<EventDomesticTraitKey, Promise<EventDomesticTraitModule>>();

    constructor(private readonly warLoader = new WarTraitLoader()) {}

    async load(key: EventDomesticTraitKey): Promise<EventDomesticTraitModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const loading = this.warLoader
            .load(resolveWarKey(key))
            .then((canonical) => withRefEventOverrides(key, canonical));
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadEventDomesticTraitModules = async (
    keys: EventDomesticTraitKey[],
    loader = new EventDomesticTraitLoader()
): Promise<EventDomesticTraitModule[]> => {
    const modules: EventDomesticTraitModule[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        modules.push(await loader.load(key));
    }
    return modules;
};
