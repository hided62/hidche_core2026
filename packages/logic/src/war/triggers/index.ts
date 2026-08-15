import type { WarTriggerModule, WarTriggerModuleExport } from './types.js';

export type WarTriggerKey = 'che_필살' | 'che_의술';

export type WarTriggerImporter = () => Promise<WarTriggerModuleExport>;

const defaultImporters: Record<WarTriggerKey, WarTriggerImporter> = {
    che_필살: async () => import('./che_필살.js'),
    che_의술: async () => import('./che_의술.js'),
};

export class WarTriggerLoader {
    private readonly cache = new Map<WarTriggerKey, Promise<WarTriggerModule>>();

    constructor(private readonly importers: Record<WarTriggerKey, WarTriggerImporter> = defaultImporters) {}

    async load(key: WarTriggerKey): Promise<WarTriggerModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown war trigger key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('triggerModule' in module)) {
                throw new Error(`Missing triggerModule for war trigger: ${key}`);
            }
            const resolved = module.triggerModule;
            if (resolved.key !== key) {
                throw new Error(`War trigger key mismatch: expected ${key}, got ${resolved.key}`);
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadWarTriggerModules = async (
    keys: WarTriggerKey[],
    loader: WarTriggerLoader = new WarTriggerLoader()
): Promise<WarTriggerModule[]> => {
    const modules: WarTriggerModule[] = [];
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

export type { WarTriggerModule, WarTriggerModuleExport } from './types.js';
