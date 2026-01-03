import type { TurnCommandModule, TurnCommandSpecBase } from '../commandModule.js';

export const GENERAL_TURN_COMMAND_KEYS = [
    'che_거병',
    'che_임관',
    'che_건국',
    'che_훈련',
    'che_사기진작',
    'che_요양',
    'che_출병',
    'che_주민선정',
    'che_농지개간',
    'che_상업투자',
    'che_기술연구',
    'che_치안강화',
    'che_수비강화',
    'che_성벽보수',
    'che_화계',
    'che_인재탐색',
    'che_징병',
    '휴식',
] as const;

export type GeneralTurnCommandKey =
    (typeof GENERAL_TURN_COMMAND_KEYS)[number];

export type GeneralTurnCommandSpec =
    TurnCommandSpecBase<GeneralTurnCommandKey>;

export type GeneralTurnCommandModule =
    TurnCommandModule<GeneralTurnCommandSpec>;

export type GeneralTurnCommandImporter = () => Promise<GeneralTurnCommandModule>;

const defaultImporters: Record<
    GeneralTurnCommandKey,
    GeneralTurnCommandImporter
> = {
    che_거병: async () => import('./che_거병.js'),
    che_임관: async () => import('./che_임관.js'),
    che_건국: async () => import('./che_건국.js'),
    che_훈련: async () => import('./che_훈련.js'),
    che_사기진작: async () => import('./che_사기진작.js'),
    che_요양: async () => import('./che_요양.js'),
    che_출병: async () => import('./che_출병.js'),
    che_주민선정: async () => import('./che_주민선정.js'),
    che_농지개간: async () => import('./che_농지개간.js'),
    che_상업투자: async () => import('./che_상업투자.js'),
    che_기술연구: async () => import('./che_기술연구.js'),
    che_치안강화: async () => import('./che_치안강화.js'),
    che_수비강화: async () => import('./che_수비강화.js'),
    che_성벽보수: async () => import('./che_성벽보수.js'),
    che_화계: async () => import('./che_화계.js'),
    che_인재탐색: async () => import('./che_인재탐색.js'),
    che_징병: async () => import('./che_징병.js'),
    휴식: async () => import('./휴식.js'),
};

export const isGeneralTurnCommandKey = (
    value: string
): value is GeneralTurnCommandKey =>
    GENERAL_TURN_COMMAND_KEYS.includes(value as GeneralTurnCommandKey);


export class GeneralTurnCommandLoader {
    private readonly cache = new Map<
        GeneralTurnCommandKey,
        Promise<GeneralTurnCommandModule>
    >();

    constructor(
        private readonly importers: Record<
            GeneralTurnCommandKey,
            GeneralTurnCommandImporter
        > = defaultImporters
    ) { }

    async load(
        key: GeneralTurnCommandKey
    ): Promise<GeneralTurnCommandModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown general turn command key: ${key}`);
        }
        const loading = importer();
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadGeneralTurnCommandSpecs = async (
    keys: GeneralTurnCommandKey[],
    loader: GeneralTurnCommandLoader = new GeneralTurnCommandLoader()
): Promise<GeneralTurnCommandSpec[]> => {
    const specs: GeneralTurnCommandSpec[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const module = await loader.load(key);
        if (!('commandSpec' in module)) {
            throw new Error(`Missing commandSpec for general command: ${key}`);
        }
        specs.push(module.commandSpec);
    }
    return specs;
};
