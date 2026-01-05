import type {
    TraitModule,
    TraitModuleExport,
} from '@sammo-ts/logic/triggers/special/types.js';

export const WAR_TRAIT_KEYS = [
    'che_의술',
    'che_징병',
] as const;

export type WarTraitKey =
    (typeof WAR_TRAIT_KEYS)[number];

export type WarTraitModule = TraitModule;

export type WarTraitImporter = () => Promise<TraitModuleExport>;

const defaultImporters: Record<
    WarTraitKey,
    WarTraitImporter
> = {
    che_의술: async () => import('./che_의술.js'),
    che_징병: async () => import('./che_징병.js'),
};

export const isWarTraitKey = (
    value: string
): value is WarTraitKey =>
    WAR_TRAIT_KEYS.includes(value as WarTraitKey);

export class WarTraitLoader {
    private readonly cache = new Map<
        WarTraitKey,
        Promise<WarTraitModule>
    >();

    constructor(
        private readonly importers: Record<
            WarTraitKey,
            WarTraitImporter
        > = defaultImporters
    ) {}

    async load(key: WarTraitKey): Promise<WarTraitModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown war trait key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('traitModule' in module)) {
                throw new Error(`Missing traitModule for war trait: ${key}`);
            }
            const resolved = module.traitModule;
            if (resolved.key !== key) {
                throw new Error(
                    `War trait key mismatch: expected ${key}, got ${resolved.key}`
                );
            }
            if (resolved.kind !== 'war') {
                throw new Error(`War trait kind mismatch: ${resolved.key}`);
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadWarTraitModules = async (
    keys: WarTraitKey[],
    loader: WarTraitLoader = new WarTraitLoader()
): Promise<WarTraitModule[]> => {
    const modules: WarTraitModule[] = [];
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
