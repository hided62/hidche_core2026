import type { TraitModule, TraitModuleExport } from '@sammo-ts/logic/triggers/special/types.js';

export const DOMESTIC_TRAIT_KEYS = [
    'che_인덕',
    'che_발명',
    'che_경작',
    'che_상재',
    'che_축성',
    'che_수비',
    'che_통찰',
    'che_귀모',
] as const;

export type DomesticTraitKey = (typeof DOMESTIC_TRAIT_KEYS)[number];

export type DomesticTraitModule = TraitModule;

export type DomesticTraitImporter = () => Promise<TraitModuleExport>;

const defaultImporters: Record<DomesticTraitKey, DomesticTraitImporter> = {
    che_인덕: async () => import('./che_인덕.js'),
    che_발명: async () => import('./che_발명.js'),
    che_경작: async () => import('./che_경작.js'),
    che_상재: async () => import('./che_상재.js'),
    che_축성: async () => import('./che_축성.js'),
    che_수비: async () => import('./che_수비.js'),
    che_통찰: async () => import('./che_통찰.js'),
    che_귀모: async () => import('./che_귀모.js'),
};

export const isDomesticTraitKey = (value: string): value is DomesticTraitKey =>
    DOMESTIC_TRAIT_KEYS.includes(value as DomesticTraitKey);

export class DomesticTraitLoader {
    private readonly cache = new Map<DomesticTraitKey, Promise<DomesticTraitModule>>();

    constructor(private readonly importers: Record<DomesticTraitKey, DomesticTraitImporter> = defaultImporters) {}

    async load(key: DomesticTraitKey): Promise<DomesticTraitModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown domestic trait key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('traitModule' in module)) {
                throw new Error(`Missing traitModule for domestic trait: ${key}`);
            }
            const resolved = module.traitModule;
            if (resolved.key !== key) {
                throw new Error(`Domestic trait key mismatch: expected ${key}, got ${resolved.key}`);
            }
            if (resolved.kind !== 'domestic') {
                throw new Error(`Domestic trait kind mismatch: ${resolved.key}`);
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadDomesticTraitModules = async (
    keys: DomesticTraitKey[],
    loader: DomesticTraitLoader = new DomesticTraitLoader()
): Promise<DomesticTraitModule[]> => {
    const modules: DomesticTraitModule[] = [];
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
