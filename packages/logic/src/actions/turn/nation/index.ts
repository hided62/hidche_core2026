export type NationTurnCommandKey =
    | '휴식'
    | 'che_포상'
    | 'che_발령'
    | 'che_선전포고';

import type * as NationRestModule from './휴식.js';
import type * as AwardModule from './che_포상.js';
import type * as AssignmentModule from './che_발령.js';
import type * as DeclarationModule from './che_선전포고.js';

export type NationTurnCommandModule =
    | typeof NationRestModule
    | typeof AwardModule
    | typeof AssignmentModule
    | typeof DeclarationModule;

export type NationTurnCommandImporter = () => Promise<NationTurnCommandModule>;

const defaultImporters: Record<
    NationTurnCommandKey,
    NationTurnCommandImporter
> = {
    휴식: async () => import('./휴식.js'),
    che_포상: async () => import('./che_포상.js'),
    che_발령: async () => import('./che_발령.js'),
    che_선전포고: async () => import('./che_선전포고.js'),
};

export class NationTurnCommandLoader {
    constructor(
        private readonly importers: Record<
            NationTurnCommandKey,
            NationTurnCommandImporter
        > = defaultImporters
    ) {}

    async load(
        key: NationTurnCommandKey
    ): Promise<NationTurnCommandModule> {
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown nation turn command key: ${key}`);
        }
        return importer();
    }
}

export {
    ActionDefinition as NationRestActionDefinition,
    ActionResolver as NationRestActionResolver,
} from './휴식.js';
export {
    ActionDefinition as AwardActionDefinition,
    ActionResolver as AwardActionResolver,
    CommandResolver as AwardCommandResolver,
} from './che_포상.js';
export {
    ActionDefinition as AssignmentActionDefinition,
    ActionResolver as AssignmentActionResolver,
} from './che_발령.js';
export {
    ActionDefinition as DeclarationActionDefinition,
} from './che_선전포고.js';
