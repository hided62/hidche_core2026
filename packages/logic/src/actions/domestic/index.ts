import type { CommandResolver as CommandResolverType } from './che_상업투자.js';

export type DomesticCommandKey = 'che_상업투자';
type CommandResolverCtor = typeof CommandResolverType;
type CommandResolverArgs = ConstructorParameters<CommandResolverCtor>;
type CommandResolverInstance = InstanceType<CommandResolverCtor>;

export type DomesticCommandImporter = () => Promise<{
    CommandResolver: typeof CommandResolverType;
}>;

const defaultImporters: Record<DomesticCommandKey, DomesticCommandImporter> = {
    che_상업투자: async () => import('./che_상업투자.js'),
};

export class DomesticCommandLoader {
    constructor(
        private readonly importers: Record<
            DomesticCommandKey,
            DomesticCommandImporter
        > = defaultImporters
    ) {}

    async load(
        key: DomesticCommandKey
    ): Promise<{ CommandResolver: typeof CommandResolverType }> {
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown domestic command key: ${key}`);
        }
        return importer();
    }

    async create(
        key: DomesticCommandKey,
        ...args: CommandResolverArgs
    ): Promise<CommandResolverInstance> {
        const { CommandResolver } = await this.load(key);
        return new CommandResolver(...args);
    }
}
