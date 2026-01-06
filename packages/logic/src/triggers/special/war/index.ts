import type { TraitModule, TraitModuleExport } from '@sammo-ts/logic/triggers/special/types.js';

export const WAR_TRAIT_KEYS = [
    'che_귀병',
    'che_신산',
    'che_환술',
    'che_집중',
    'che_신중',
    'che_반계',
    'che_보병',
    'che_궁병',
    'che_기병',
    'che_공성',
    'che_돌격',
    'che_무쌍',
    'che_견고',
    'che_위압',
    'che_저격',
    'che_필살',
    'che_징병',
    'che_의술',
    'che_격노',
    'che_척사',
] as const;

export type WarTraitKey = (typeof WAR_TRAIT_KEYS)[number];

export type WarTraitModule = TraitModule;

export type WarTraitImporter = () => Promise<TraitModuleExport>;

const defaultImporters: Record<WarTraitKey, WarTraitImporter> = {
    che_귀병: async () => import('./che_귀병.js'),
    che_신산: async () => import('./che_신산.js'),
    che_환술: async () => import('./che_환술.js'),
    che_집중: async () => import('./che_집중.js'),
    che_신중: async () => import('./che_신중.js'),
    che_반계: async () => import('./che_반계.js'),
    che_보병: async () => import('./che_보병.js'),
    che_궁병: async () => import('./che_궁병.js'),
    che_기병: async () => import('./che_기병.js'),
    che_공성: async () => import('./che_공성.js'),
    che_돌격: async () => import('./che_돌격.js'),
    che_무쌍: async () => import('./che_무쌍.js'),
    che_견고: async () => import('./che_견고.js'),
    che_위압: async () => import('./che_위압.js'),
    che_저격: async () => import('./che_저격.js'),
    che_필살: async () => import('./che_필살.js'),
    che_징병: async () => import('./che_징병.js'),
    che_의술: async () => import('./che_의술.js'),
    che_격노: async () => import('./che_격노.js'),
    che_척사: async () => import('./che_척사.js'),
};

export const isWarTraitKey = (value: string): value is WarTraitKey => WAR_TRAIT_KEYS.includes(value as WarTraitKey);

export class WarTraitLoader {
    private readonly cache = new Map<WarTraitKey, Promise<WarTraitModule>>();

    constructor(private readonly importers: Record<WarTraitKey, WarTraitImporter> = defaultImporters) {}

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
                throw new Error(`War trait key mismatch: expected ${key}, got ${resolved.key}`);
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
