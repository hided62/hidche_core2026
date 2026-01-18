import {
    ITEM_KEYS,
    loadItemModules,
    loadNationTraitModules,
    loadPersonalityTraitModules,
    loadWarTraitModules,
    NATION_TRAIT_KEYS,
    PERSONALITY_TRAIT_KEYS,
    WAR_TRAIT_KEYS,
    type ItemModule,
    type TraitModule,
} from '@sammo-ts/logic';

export type BattleSimTraitOption = {
    key: string;
    name: string;
    info: string;
};

export type BattleSimItemOption = {
    key: string;
    name: string;
};

export type BattleSimItemOptions = {
    horse: BattleSimItemOption[];
    weapon: BattleSimItemOption[];
    book: BattleSimItemOption[];
    item: BattleSimItemOption[];
};

export type BattleSimDexLevel = {
    value: number;
    color: string;
    label: string;
};

export const BATTLE_SIM_NATION_LEVELS: Array<{ level: number; name: string }> = [
    { level: 0, name: '방랑군' },
    { level: 1, name: '호족' },
    { level: 2, name: '군벌' },
    { level: 3, name: '주자사' },
    { level: 4, name: '주목' },
    { level: 5, name: '공' },
    { level: 6, name: '왕' },
    { level: 7, name: '황제' },
];

export const BATTLE_SIM_CITY_LEVELS: Array<{ level: number; name: string }> = [
    { level: 1, name: '수' },
    { level: 2, name: '진' },
    { level: 3, name: '관' },
    { level: 4, name: '이' },
    { level: 5, name: '소' },
    { level: 6, name: '중' },
    { level: 7, name: '대' },
    { level: 8, name: '특' },
];

export const BATTLE_SIM_DEX_LEVELS: BattleSimDexLevel[] = [
    { value: 0, color: 'navy', label: 'F-' },
    { value: 350, color: 'navy', label: 'F' },
    { value: 1375, color: 'navy', label: 'F+' },
    { value: 3500, color: 'skyblue', label: 'E-' },
    { value: 7125, color: 'skyblue', label: 'E' },
    { value: 12650, color: 'skyblue', label: 'E+' },
    { value: 20475, color: 'seagreen', label: 'D-' },
    { value: 31000, color: 'seagreen', label: 'D' },
    { value: 44625, color: 'seagreen', label: 'D+' },
    { value: 61750, color: 'teal', label: 'C-' },
    { value: 82775, color: 'teal', label: 'C' },
    { value: 108100, color: 'teal', label: 'C+' },
    { value: 138125, color: 'limegreen', label: 'B-' },
    { value: 173250, color: 'limegreen', label: 'B' },
    { value: 213875, color: 'limegreen', label: 'B+' },
    { value: 260400, color: 'darkorange', label: 'A-' },
    { value: 313225, color: 'darkorange', label: 'A' },
    { value: 372750, color: 'darkorange', label: 'A+' },
    { value: 439375, color: 'tomato', label: 'S-' },
    { value: 513500, color: 'tomato', label: 'S' },
    { value: 595525, color: 'tomato', label: 'S+' },
    { value: 685850, color: 'darkviolet', label: 'Z-' },
    { value: 784875, color: 'darkviolet', label: 'Z' },
    { value: 893000, color: 'darkviolet', label: 'Z+' },
    { value: 1010625, color: 'gold', label: 'EX-' },
    { value: 1138150, color: 'gold', label: 'EX' },
    { value: 1275975, color: 'white', label: 'EX+' },
];

const toTraitOption = (module: TraitModule): BattleSimTraitOption => ({
    key: module.key,
    name: module.name,
    info: module.info,
});

let cachedTraitOptions: Promise<{
    nationTypes: BattleSimTraitOption[];
    warTraits: BattleSimTraitOption[];
    personalities: BattleSimTraitOption[];
}> | null = null;

export const loadBattleSimTraitOptions = async (): Promise<{
    nationTypes: BattleSimTraitOption[];
    warTraits: BattleSimTraitOption[];
    personalities: BattleSimTraitOption[];
}> => {
    if (!cachedTraitOptions) {
        cachedTraitOptions = Promise.all([
            loadNationTraitModules([...NATION_TRAIT_KEYS]),
            loadWarTraitModules([...WAR_TRAIT_KEYS]),
            loadPersonalityTraitModules([...PERSONALITY_TRAIT_KEYS]),
        ]).then(([nationTraits, warTraits, personalities]) => ({
            nationTypes: nationTraits.map(toTraitOption),
            warTraits: warTraits.map(toTraitOption),
            personalities: personalities.map(toTraitOption),
        }));
    }
    return cachedTraitOptions;
};

let cachedItemOptions: Promise<BattleSimItemOptions> | null = null;

const toItemOption = (module: ItemModule): BattleSimItemOption => ({
    key: module.key,
    name: module.name,
});

export const loadBattleSimItemOptions = async (): Promise<BattleSimItemOptions> => {
    if (!cachedItemOptions) {
        cachedItemOptions = loadItemModules([...ITEM_KEYS]).then((modules) => {
            const items: BattleSimItemOptions = {
                horse: [],
                weapon: [],
                book: [],
                item: [],
            };
            for (const module of modules) {
                items[module.slot].push(toItemOption(module));
            }
            return items;
        });
    }
    return cachedItemOptions;
};
