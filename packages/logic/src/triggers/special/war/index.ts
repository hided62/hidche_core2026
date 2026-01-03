import type {
    SpecialActionModule,
    SpecialActionModuleExport,
} from '@sammo-ts/logic/triggers/special/types.js';

export const WAR_SPECIAL_KEYS = [
    'che_의술',
    'che_징병',
] as const;

export type WarSpecialKey =
    (typeof WAR_SPECIAL_KEYS)[number];

export type WarSpecialModule = SpecialActionModule;

export type WarSpecialImporter = () => Promise<SpecialActionModuleExport>;

const defaultImporters: Record<
    WarSpecialKey,
    WarSpecialImporter
> = {
    che_의술: async () => import('./che_의술.js'),
    che_징병: async () => import('./che_징병.js'),
};

export const isWarSpecialKey = (
    value: string
): value is WarSpecialKey =>
    WAR_SPECIAL_KEYS.includes(value as WarSpecialKey);

export class WarSpecialLoader {
    private readonly cache = new Map<
        WarSpecialKey,
        Promise<WarSpecialModule>
    >();

    constructor(
        private readonly importers: Record<
            WarSpecialKey,
            WarSpecialImporter
        > = defaultImporters
    ) {}

    async load(key: WarSpecialKey): Promise<WarSpecialModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown war special key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('specialModule' in module)) {
                throw new Error(`Missing specialModule for war special: ${key}`);
            }
            const resolved = module.specialModule;
            if (resolved.key !== key) {
                throw new Error(
                    `War special key mismatch: expected ${key}, got ${resolved.key}`
                );
            }
            if (resolved.kind !== 'war') {
                throw new Error(`War special kind mismatch: ${resolved.key}`);
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadWarSpecialModules = async (
    keys: WarSpecialKey[],
    loader: WarSpecialLoader = new WarSpecialLoader()
): Promise<WarSpecialModule[]> => {
    const modules: WarSpecialModule[] = [];
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
