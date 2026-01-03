import type {
    SpecialActionModule,
    SpecialActionModuleExport,
} from '../types.js';

export const DOMESTIC_SPECIAL_KEYS = [
    'che_인덕',
    'che_발명',
] as const;

export type DomesticSpecialKey =
    (typeof DOMESTIC_SPECIAL_KEYS)[number];

export type DomesticSpecialModule = SpecialActionModule;

export type DomesticSpecialImporter = () => Promise<SpecialActionModuleExport>;

const defaultImporters: Record<
    DomesticSpecialKey,
    DomesticSpecialImporter
> = {
    che_인덕: async () => import('./che_인덕.js'),
    che_발명: async () => import('./che_발명.js'),
};

export const isDomesticSpecialKey = (
    value: string
): value is DomesticSpecialKey =>
    DOMESTIC_SPECIAL_KEYS.includes(value as DomesticSpecialKey);

export class DomesticSpecialLoader {
    private readonly cache = new Map<
        DomesticSpecialKey,
        Promise<DomesticSpecialModule>
    >();

    constructor(
        private readonly importers: Record<
            DomesticSpecialKey,
            DomesticSpecialImporter
        > = defaultImporters
    ) {}

    async load(key: DomesticSpecialKey): Promise<DomesticSpecialModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown domestic special key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('specialModule' in module)) {
                throw new Error(`Missing specialModule for domestic special: ${key}`);
            }
            const resolved = module.specialModule;
            if (resolved.key !== key) {
                throw new Error(
                    `Domestic special key mismatch: expected ${key}, got ${resolved.key}`
                );
            }
            if (resolved.kind !== 'domestic') {
                throw new Error(
                    `Domestic special kind mismatch: ${resolved.key}`
                );
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadDomesticSpecialModules = async (
    keys: DomesticSpecialKey[],
    loader: DomesticSpecialLoader = new DomesticSpecialLoader()
): Promise<DomesticSpecialModule[]> => {
    const modules: DomesticSpecialModule[] = [];
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
