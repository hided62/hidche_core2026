import type { TraitModule, TraitModuleExport } from '@sammo-ts/logic/triggers/special/types.js';

export const NATION_TRAIT_KEYS = [
    'che_중립',
    'che_도적',
    'che_명가',
    'che_음양가',
    'che_종횡가',
    'che_불가',
    'che_오두미도',
    'che_태평도',
    'che_도가',
    'che_묵가',
    'che_덕가',
    'che_병가',
    'che_유가',
    'che_법가',
] as const;

export type NationTraitKey = (typeof NATION_TRAIT_KEYS)[number];

export type NationTraitModule = TraitModule;

export type NationTraitImporter = () => Promise<TraitModuleExport>;

const defaultImporters: Record<NationTraitKey, NationTraitImporter> = {
    che_중립: async () => import('./che_중립.js'),
    che_도적: async () => import('./che_도적.js'),
    che_명가: async () => import('./che_명가.js'),
    che_음양가: async () => import('./che_음양가.js'),
    che_종횡가: async () => import('./che_종횡가.js'),
    che_불가: async () => import('./che_불가.js'),
    che_오두미도: async () => import('./che_오두미도.js'),
    che_태평도: async () => import('./che_태평도.js'),
    che_도가: async () => import('./che_도가.js'),
    che_묵가: async () => import('./che_묵가.js'),
    che_덕가: async () => import('./che_덕가.js'),
    che_병가: async () => import('./che_병가.js'),
    che_유가: async () => import('./che_유가.js'),
    che_법가: async () => import('./che_법가.js'),
};

export const isNationTraitKey = (value: string): value is NationTraitKey =>
    NATION_TRAIT_KEYS.includes(value as NationTraitKey);

export class NationTraitLoader {
    private readonly cache = new Map<NationTraitKey, Promise<NationTraitModule>>();

    constructor(private readonly importers: Record<NationTraitKey, NationTraitImporter> = defaultImporters) {}

    async load(key: NationTraitKey): Promise<NationTraitModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown nation trait key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('traitModule' in module)) {
                throw new Error(`Missing traitModule for nation trait: ${key}`);
            }
            const resolved = module.traitModule;
            if (resolved.key !== key) {
                throw new Error(`Nation trait key mismatch: expected ${key}, got ${resolved.key}`);
            }
            if (resolved.kind !== 'nation') {
                throw new Error(`Nation trait kind mismatch: ${resolved.key}`);
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadNationTraitModules = async (
    keys: NationTraitKey[],
    loader: NationTraitLoader = new NationTraitLoader()
): Promise<NationTraitModule[]> => {
    const modules: NationTraitModule[] = [];
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
