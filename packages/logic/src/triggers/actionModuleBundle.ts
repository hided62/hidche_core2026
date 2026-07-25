import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { compileCrewTypeCatalog } from '@sammo-ts/logic/crewType/catalog.js';
import { createCrewTypeWarTriggerRegistry } from '@sammo-ts/logic/war/crewTypeTriggers.js';
import { createInheritBuffModules } from '@sammo-ts/logic/inheritance/inheritBuff.js';
import {
    createItemActionModules,
    createItemModuleRegistry,
    ITEM_KEYS,
    loadItemModules,
    type ItemModule,
} from '@sammo-ts/logic/items/index.js';
import type { UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import type { GeneralActionModule } from './general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import { createOfficerLevelActionModules } from './officerLevel.js';
import {
    createTraitModuleRegistry,
    DOMESTIC_TRAIT_KEYS,
    loadDomesticTraitModules,
    loadNationTraitModules,
    loadPersonalityTraitModules,
    loadWarTraitModules,
    NATION_TRAIT_KEYS,
    PERSONALITY_TRAIT_KEYS,
    TraitGeneralActionRouter,
    TraitWarActionRouter,
    WAR_TRAIT_KEYS,
} from './special/index.js';
import type { NationTraitModule } from './special/nation/index.js';

export interface ActionModuleBundle<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: GeneralActionModule<TriggerState>[];
    war: WarActionModule<TriggerState>[];
    itemModules: ItemModule<TriggerState>[];
    nationTraitModules: NationTraitModule[];
}

// General::getActionList와 같은 소유권 순서로 실제 턴과 시뮬레이터의 모듈을 조립한다.
export const loadActionModuleBundle = async <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    unitSet?: UnitSetDefinition
): Promise<ActionModuleBundle<TriggerState>> => {
    const [domestic, war, personality, nation, itemModules] = await Promise.all([
        loadDomesticTraitModules([...DOMESTIC_TRAIT_KEYS]),
        loadWarTraitModules([...WAR_TRAIT_KEYS]),
        loadPersonalityTraitModules([...PERSONALITY_TRAIT_KEYS]),
        loadNationTraitModules([...NATION_TRAIT_KEYS]),
        loadItemModules([...ITEM_KEYS]) as Promise<ItemModule<TriggerState>[]>,
    ]);
    const traitRegistry = createTraitModuleRegistry<TriggerState>({ domestic, war, personality, nation });
    const officer = createOfficerLevelActionModules<TriggerState>();
    const items = createItemActionModules(createItemModuleRegistry(itemModules));
    const inherit = createInheritBuffModules();
    const crewTypeCatalog = unitSet?.crewTypes?.length
        ? compileCrewTypeCatalog(unitSet, createCrewTypeWarTriggerRegistry())
        : null;

    return {
        general: [
            new TraitGeneralActionRouter('nation', traitRegistry),
            officer.general,
            new TraitGeneralActionRouter('domestic', traitRegistry),
            new TraitGeneralActionRouter('war', traitRegistry),
            new TraitGeneralActionRouter('personality', traitRegistry),
            ...(crewTypeCatalog ? [crewTypeCatalog.generalActionModule] : []),
            inherit.general as GeneralActionModule<TriggerState>,
            ...items.general,
        ],
        war: [
            new TraitWarActionRouter('nation', traitRegistry),
            officer.war,
            new TraitWarActionRouter('domestic', traitRegistry),
            new TraitWarActionRouter('war', traitRegistry),
            new TraitWarActionRouter('personality', traitRegistry),
            ...(crewTypeCatalog ? [crewTypeCatalog.warActionModule] : []),
            inherit.war as WarActionModule<TriggerState>,
            ...items.war,
        ],
        itemModules,
        nationTraitModules: nation,
    };
};
