import type { TraitModule, TraitModuleExport } from '@sammo-ts/logic/triggers/special/types.js';

export const PERSONALITY_TRAIT_KEYS = [
    'che_안전',
    'che_유지',
    'che_재간',
    'che_출세',
    'che_할거',
    'che_정복',
    'che_패권',
    'che_의협',
    'che_대의',
    'che_왕좌',
    'che_은둔',
] as const;

export type PersonalityTraitKey = (typeof PERSONALITY_TRAIT_KEYS)[number];

export type PersonalityTraitModule = TraitModule;

export type PersonalityTraitImporter = () => Promise<TraitModuleExport>;

const defaultImporters: Record<PersonalityTraitKey, PersonalityTraitImporter> = {
    che_안전: async () => import('./che_안전.js'),
    che_유지: async () => import('./che_유지.js'),
    che_재간: async () => import('./che_재간.js'),
    che_출세: async () => import('./che_출세.js'),
    che_할거: async () => import('./che_할거.js'),
    che_정복: async () => import('./che_정복.js'),
    che_패권: async () => import('./che_패권.js'),
    che_의협: async () => import('./che_의협.js'),
    che_대의: async () => import('./che_대의.js'),
    che_왕좌: async () => import('./che_왕좌.js'),
    che_은둔: async () => import('./che_은둔.js'),
};

export const isPersonalityTraitKey = (value: string): value is PersonalityTraitKey =>
    PERSONALITY_TRAIT_KEYS.includes(value as PersonalityTraitKey);

export class PersonalityTraitLoader {
    private readonly cache = new Map<PersonalityTraitKey, Promise<PersonalityTraitModule>>();

    constructor(private readonly importers: Record<PersonalityTraitKey, PersonalityTraitImporter> = defaultImporters) {}

    async load(key: PersonalityTraitKey): Promise<PersonalityTraitModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown personality trait key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('traitModule' in module)) {
                throw new Error(`Missing traitModule for personality trait: ${key}`);
            }
            const resolved = module.traitModule;
            if (resolved.key !== key) {
                throw new Error(`Personality trait key mismatch: expected ${key}, got ${resolved.key}`);
            }
            if (resolved.kind !== 'personality') {
                throw new Error(`Personality trait kind mismatch: ${resolved.key}`);
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadPersonalityTraitModules = async (
    keys: PersonalityTraitKey[],
    loader: PersonalityTraitLoader = new PersonalityTraitLoader()
): Promise<PersonalityTraitModule[]> => {
    const modules: PersonalityTraitModule[] = [];
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
