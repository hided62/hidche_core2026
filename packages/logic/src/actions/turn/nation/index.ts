import type { TurnCommandModule, TurnCommandSpecBase } from '@sammo-ts/logic/actions/turn/commandModule.js';

export const NATION_TURN_COMMAND_KEYS = [
    '휴식',
    'che_포상',
    'che_부대탈퇴지시',
    'che_발령',
    'che_선전포고',
    'che_종전제의',
    'che_불가침제의',
    'che_불가침파기제의',
    'che_의병모집',
    'che_허보',
    'che_필사즉생',
    'che_백성동원',
    'che_이호경식',
    'che_수몰',
    'che_급습',
    'che_피장파장',
    'che_초토화',
    'che_천도',
    'che_국호변경',
    'che_무작위수도이전',
    'che_국기변경',
    'che_증축',
    'che_감축',
    'cr_인구이동',
    'che_몰수',
    'che_물자원조',
    'event_원융노병연구',
    'event_화시병연구',
    'event_음귀병연구',
    'event_대검병연구',
    'event_화륜차연구',
    'event_산저병연구',
    'event_극병연구',
    'event_상병연구',
    'event_무희연구',
] as const;

export type NationTurnCommandKey = (typeof NATION_TURN_COMMAND_KEYS)[number];

export type NationTurnCommandSpec = TurnCommandSpecBase<NationTurnCommandKey>;

export type NationTurnCommandModule = TurnCommandModule<NationTurnCommandSpec>;

export type NationTurnCommandImporter = () => Promise<NationTurnCommandModule>;

const defaultImporters: Record<NationTurnCommandKey, NationTurnCommandImporter> = {
    휴식: async () => import('./휴식.js'),
    che_포상: async () => import('./che_포상.js'),
    che_부대탈퇴지시: async () => import('./che_부대탈퇴지시.js'),
    che_발령: async () => import('./che_발령.js'),
    che_선전포고: async () => import('./che_선전포고.js'),
    che_종전제의: async () => import('./che_종전제의.js'),
    che_불가침제의: async () => import('./che_불가침제의.js'),
    che_불가침파기제의: async () => import('./che_불가침파기제의.js'),
    che_의병모집: async () => import('./che_의병모집.js'),
    che_허보: async () => import('./che_허보.js'),
    che_필사즉생: async () => import('./che_필사즉생.js'),
    che_백성동원: async () => import('./che_백성동원.js'),
    che_이호경식: async () => import('./che_이호경식.js'),
    che_수몰: async () => import('./che_수몰.js'),
    che_급습: async () => import('./che_급습.js'),
    che_피장파장: async () => import('./che_피장파장.js'),
    che_초토화: async () => import('./che_초토화.js'),
    che_천도: async () => import('./che_천도.js'),
    che_국호변경: async () => import('./che_국호변경.js'),
    che_무작위수도이전: async () => import('./che_무작위수도이전.js'),
    che_국기변경: async () => import('./che_국기변경.js'),
    che_증축: async () => import('./che_증축.js'),
    che_감축: async () => import('./che_감축.js'),
    cr_인구이동: async () => import('./cr_인구이동.js'),
    che_몰수: async () => import('./che_몰수.js'),
    che_물자원조: async () => import('./che_물자원조.js'),
    event_원융노병연구: async () => import('./event_원융노병연구.js'),
    event_화시병연구: async () => import('./event_화시병연구.js'),
    event_음귀병연구: async () => import('./event_음귀병연구.js'),
    event_대검병연구: async () => import('./event_대검병연구.js'),
    event_화륜차연구: async () => import('./event_화륜차연구.js'),
    event_산저병연구: async () => import('./event_산저병연구.js'),
    event_극병연구: async () => import('./event_극병연구.js'),
    event_상병연구: async () => import('./event_상병연구.js'),
    event_무희연구: async () => import('./event_무희연구.js'),
};

export const isNationTurnCommandKey = (value: string): value is NationTurnCommandKey =>
    NATION_TURN_COMMAND_KEYS.includes(value as NationTurnCommandKey);

export class NationTurnCommandLoader {
    private readonly cache = new Map<NationTurnCommandKey, Promise<NationTurnCommandModule>>();

    constructor(
        private readonly importers: Record<NationTurnCommandKey, NationTurnCommandImporter> = defaultImporters
    ) {}

    async load(key: NationTurnCommandKey): Promise<NationTurnCommandModule> {
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
