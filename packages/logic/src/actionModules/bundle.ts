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
import type { GeneralActionModule } from './general.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import { createOfficerLevelActionModules } from './officerLevel.js';
import {
    createTraitCatalog,
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
} from './traits/index.js';
import type { NationTraitModule } from './traits/nation/index.js';
import { createScenarioEffectActionModules } from './scenarioEffect.js';
import type { ScenarioEffectKey } from '@sammo-ts/logic/scenario/scenarioEffect.js';

export interface ActionModuleBundle<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: RefOrderedActionStack<GeneralActionModule<TriggerState>>;
    war: RefOrderedActionStack<WarActionModule<TriggerState>>;
    itemModules: ItemModule<TriggerState>[];
    nationTraitModules: NationTraitModule[];
}

const refActionOrderBrand: unique symbol = Symbol('RefOrderedActionStack');

export type RefOrderedActionStack<Module> = ReadonlyArray<Module> & {
    readonly [refActionOrderBrand]: true;
};

interface RefActionSlots<Module> {
    nation: Module;
    officer: Module;
    domestic: Module;
    war: Module;
    personality: Module;
    crewType: Module | null;
    inheritance: Module;
    scenario: Module | null;
    items: readonly Module[];
}

const markRefOrderedActionStack: <Module>(
    stack: Module[]
) => asserts stack is Module[] & { readonly [refActionOrderBrand]: true } = (stack) => {
    Object.defineProperty(stack, refActionOrderBrand, {
        value: true,
        enumerable: false,
        writable: false,
    });
};

// ref General::getActionList()의 소유권 순서를 한 곳에서만 조립합니다.
export const createRefOrderedActionStack = <Module>(slots: RefActionSlots<Module>): RefOrderedActionStack<Module> => {
    const stack = [
        slots.nation,
        slots.officer,
        slots.domestic,
        slots.war,
        slots.personality,
        ...(slots.crewType ? [slots.crewType] : []),
        slots.inheritance,
        ...(slots.scenario ? [slots.scenario] : []),
        ...slots.items,
    ];
    markRefOrderedActionStack(stack);
    return stack;
};

// General::getActionList와 같은 소유권 순서로 실제 턴과 시뮬레이터의 모듈을 조립한다.
export const loadActionModuleBundle = async <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    unitSet?: UnitSetDefinition,
    scenarioEffect?: ScenarioEffectKey | null
): Promise<ActionModuleBundle<TriggerState>> => {
    const [domestic, war, personality, nation, itemModules] = await Promise.all([
        loadDomesticTraitModules([...DOMESTIC_TRAIT_KEYS]),
        loadWarTraitModules([...WAR_TRAIT_KEYS]),
        loadPersonalityTraitModules([...PERSONALITY_TRAIT_KEYS]),
        loadNationTraitModules([...NATION_TRAIT_KEYS]),
        loadItemModules([...ITEM_KEYS]) as Promise<ItemModule<TriggerState>[]>,
    ]);
    const traitCatalog = createTraitCatalog<TriggerState>({ domestic, war, personality, nation });
    const officer = createOfficerLevelActionModules<TriggerState>();
    const items = createItemActionModules(createItemModuleRegistry(itemModules));
    const inherit = createInheritBuffModules();
    const scenario = createScenarioEffectActionModules<TriggerState>(scenarioEffect);
    const crewTypeCatalog = unitSet?.crewTypes?.length
        ? compileCrewTypeCatalog(unitSet, createCrewTypeWarTriggerRegistry())
        : null;

    return {
        general: createRefOrderedActionStack<GeneralActionModule<TriggerState>>({
            nation: new TraitGeneralActionRouter('nation', traitCatalog),
            officer: officer.general,
            domestic: new TraitGeneralActionRouter('domestic', traitCatalog),
            war: new TraitGeneralActionRouter('war', traitCatalog),
            personality: new TraitGeneralActionRouter('personality', traitCatalog),
            crewType: crewTypeCatalog
                ? (crewTypeCatalog.generalActionModule as GeneralActionModule<TriggerState>)
                : null,
            inheritance: inherit.general as GeneralActionModule<TriggerState>,
            scenario: scenario.general,
            items: items.general,
        }),
        war: createRefOrderedActionStack<WarActionModule<TriggerState>>({
            nation: new TraitWarActionRouter('nation', traitCatalog),
            officer: officer.war,
            domestic: new TraitWarActionRouter('domestic', traitCatalog),
            war: new TraitWarActionRouter('war', traitCatalog),
            personality: new TraitWarActionRouter('personality', traitCatalog),
            crewType: crewTypeCatalog ? (crewTypeCatalog.warActionModule as WarActionModule<TriggerState>) : null,
            inheritance: inherit.war as WarActionModule<TriggerState>,
            scenario: scenario.war,
            items: items.war,
        }),
        itemModules,
        nationTraitModules: nation,
    };
};
