export type GeneralTurnCommandKey = 'che_상업투자' | 'che_화계';

export type GeneralTurnCommandModule =
    | typeof import('./che_상업투자.js')
    | typeof import('./che_화계.js');

export type GeneralTurnCommandImporter = () => Promise<GeneralTurnCommandModule>;

const defaultImporters: Record<
    GeneralTurnCommandKey,
    GeneralTurnCommandImporter
> = {
    che_상업투자: async () => import('./che_상업투자.js'),
    che_화계: async () => import('./che_화계.js'),
};

export class GeneralTurnCommandLoader {
    constructor(
        private readonly importers: Record<
            GeneralTurnCommandKey,
            GeneralTurnCommandImporter
        > = defaultImporters
    ) {}

    async load(
        key: GeneralTurnCommandKey
    ): Promise<GeneralTurnCommandModule> {
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown general turn command key: ${key}`);
        }
        return importer();
    }
}

export {
    ActionDefinition as CommerceInvestmentActionDefinition,
    ActionResolver as CommerceInvestmentActionResolver,
    CommandResolver as CommerceInvestmentCommandResolver,
} from './che_상업투자.js';
export {
    ActionDefinition as FireAttackActionDefinition,
    ActionResolver as FireAttackActionResolver,
    CommandResolver as FireAttackCommandResolver,
} from './che_화계.js';
