import type { TurnCommandModule, TurnCommandSpecBase } from '@sammo-ts/logic/actions/turn/commandModule.js';

export const NATION_TURN_COMMAND_KEYS = [
    '휴식',
    'che_포상',
    'che_발령',
    'che_선전포고',
    'che_불가침제의',
    'che_불가침파기제의',
    'che_의병모집',
] as const;

export type NationTurnCommandKey =
    (typeof NATION_TURN_COMMAND_KEYS)[number];

export type NationTurnCommandSpec =
    TurnCommandSpecBase<NationTurnCommandKey>;

export type NationTurnCommandModule =
    TurnCommandModule<NationTurnCommandSpec>;

export type NationTurnCommandImporter = () => Promise<NationTurnCommandModule>;

const defaultImporters: Record<
    NationTurnCommandKey,
    NationTurnCommandImporter
> = {
    휴식: async () => import('./휴식.js'),
    che_포상: async () => import('./che_포상.js'),
    che_발령: async () => import('./che_발령.js'),
    che_선전포고: async () => import('./che_선전포고.js'),
    che_불가침제의: async () => import('./che_불가침제의.js'),
    che_불가침파기제의: async () => import('./che_불가침파기제의.js'),
    che_의병모집: async () => import('./che_의병모집.js'),
};

export const isNationTurnCommandKey = (
    value: string
): value is NationTurnCommandKey =>
    NATION_TURN_COMMAND_KEYS.includes(value as NationTurnCommandKey);



export class NationTurnCommandLoader {
    private readonly cache = new Map<
        NationTurnCommandKey,
        Promise<NationTurnCommandModule>
    >();

    constructor(
        private readonly importers: Record<
            NationTurnCommandKey,
            NationTurnCommandImporter
        > = defaultImporters
    ) { }

    async load(
        key: NationTurnCommandKey
    ): Promise<NationTurnCommandModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown nation turn command key: ${key}`);
        }
        const loading = importer();
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadNationTurnCommandSpecs = async (
    keys: NationTurnCommandKey[],
    loader: NationTurnCommandLoader = new NationTurnCommandLoader()
): Promise<NationTurnCommandSpec[]> => {
    const specs: NationTurnCommandSpec[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const module = await loader.load(key);
        if (!('commandSpec' in module)) {
            throw new Error(`Missing commandSpec for nation command: ${key}`);
        }
        specs.push(module.commandSpec);
    }
    return specs;
};
