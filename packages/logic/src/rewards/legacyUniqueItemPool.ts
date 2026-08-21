import { createItemModuleRegistry, ItemLoader, ITEM_KEYS, loadItemModules } from '@sammo-ts/logic/items/index.js';
import type { ItemModule } from '@sammo-ts/logic/items/types.js';
import { resolveUniqueConfig, type UniqueItemPool, type UniqueLotteryConfig } from './uniqueLottery.js';

const LEGACY_UNIQUE_ITEM_KEYS: Readonly<Record<ItemModule['slot'], readonly string[]>> = {
    horse: [
        'che_명마_07_백마',
        'che_명마_07_기주마',
        'che_명마_07_오환마',
        'che_명마_07_백상',
        'che_명마_08_양주마',
        'che_명마_08_흉노마',
        'che_명마_09_과하마',
        'che_명마_09_의남백마',
        'che_명마_10_대완마',
        'che_명마_10_옥추마',
        'che_명마_11_서량마',
        'che_명마_11_화종마',
        'che_명마_12_사륜거',
        'che_명마_12_옥란백용구',
        'che_명마_13_절영',
        'che_명마_13_적로',
        'che_명마_14_적란마',
        'che_명마_14_조황비전',
        'che_명마_15_한혈마',
        'che_명마_15_적토마',
    ],
    weapon: [
        'che_무기_07_동추',
        'che_무기_07_철편',
        'che_무기_07_철쇄',
        'che_무기_07_맥궁',
        'che_무기_08_유성추',
        'che_무기_08_철질여골',
        'che_무기_09_쌍철극',
        'che_무기_09_동호비궁',
        'che_무기_10_삼첨도',
        'che_무기_10_대부',
        'che_무기_11_고정도',
        'che_무기_11_이광궁',
        'che_무기_12_철척사모',
        'che_무기_12_칠성검',
        'che_무기_13_사모',
        'che_무기_13_양유기궁',
        'che_무기_14_언월도',
        'che_무기_14_방천화극',
        'che_무기_15_청홍검',
        'che_무기_15_의천검',
    ],
    book: [
        'che_서적_07_위료자',
        'che_서적_07_사마법',
        'che_서적_07_한서',
        'che_서적_07_논어',
        'che_서적_08_전론',
        'che_서적_08_사기',
        'che_서적_09_장자',
        'che_서적_09_역경',
        'che_서적_10_시경',
        'che_서적_10_구국론',
        'che_서적_11_상군서',
        'che_서적_11_춘추전',
        'che_서적_12_산해경',
        'che_서적_12_맹덕신서',
        'che_서적_13_관자',
        'che_서적_13_병법24편',
        'che_서적_14_한비자',
        'che_서적_14_오자병법',
        'che_서적_15_노자',
        'che_서적_15_손자병법',
    ],
    item: [
        'che_의술_정력견혈산',
        'che_의술_청낭서',
        'che_의술_태평청령',
        'che_의술_상한잡병론',
        'che_보물_도기',
        'che_조달_주판',
        'che_내정_납금박산로',
        'che_전략_평만지장도',
        'che_숙련_동작',
        'che_명성_구석',
        'che_척사_오악진형도',
        'che_격노_구정신단경',
        'che_징병_낙주',
        'che_저격_매화수전',
        'che_저격_비도',
        'che_위압_조목삭',
        'che_공성_묵자',
        'che_집중_전국책',
        'che_환술_논어집해',
        'che_진압_박혁론',
        'che_부적_태현청생부',
        'che_저지_삼황내문',
        'che_행동_서촉지형도',
        'che_간파_노군입산부',
        'che_불굴_상편',
        'che_약탈_옥벽',
        'che_농성_주서음부',
        'che_농성_위공자병법',
        'che_계략_육도',
        'che_계략_삼략',
        'che_상성보정_과실주',
        'che_능력치_지력_이강주',
        'che_능력치_무력_두강주',
        'che_능력치_통솔_보령압주',
        'che_훈련_철벽서',
        'che_훈련_단결도',
        'che_사기_춘화첩',
        'che_사기_초선화',
        'che_회피_태평요술',
        'che_필살_둔갑천서',
    ],
};

const LEGACY_DEFAULT_BUYABLE_ITEM_KEYS: Readonly<Record<ItemModule['slot'], readonly string[]>> = {
    horse: [
        'che_명마_01_노기',
        'che_명마_02_조랑',
        'che_명마_03_노새',
        'che_명마_04_나귀',
        'che_명마_05_갈색마',
        'che_명마_06_흑색마',
    ],
    weapon: [
        'che_무기_01_단도',
        'che_무기_02_단궁',
        'che_무기_03_단극',
        'che_무기_04_목검',
        'che_무기_05_죽창',
        'che_무기_06_소부',
    ],
    book: [
        'che_서적_01_효경전',
        'che_서적_02_회남자',
        'che_서적_03_변도론',
        'che_서적_04_건상역주',
        'che_서적_05_여씨춘추',
        'che_서적_06_사민월령',
    ],
    item: ['che_치료_환약', 'che_저격_수극', 'che_사기_탁주', 'che_훈련_청주', 'che_계략_이추', 'che_계략_향낭'],
};

/**
 * Ref 장비 매매는 GameConst::$allItems에 있고 수량이 0 이하인 구매 가능 아이템만
 * 노출합니다. 생략/옛 문자열 빈 객체는 GameConstBase의 기본 24종으로 복원합니다.
 */
export const resolveLegacyPurchasableItemKeys = (configConst: Record<string, unknown>): ReadonlySet<string> => {
    const { allItems } = resolveUniqueConfig(configConst);
    const hasExplicitPool = Object.values(allItems).some((entries) => Object.keys(entries ?? {}).length > 0);
    if (!hasExplicitPool) {
        return new Set(Object.values(LEGACY_DEFAULT_BUYABLE_ITEM_KEYS).flat());
    }

    const result = new Set<string>();
    for (const entries of Object.values(allItems)) {
        for (const [itemKey, count] of Object.entries(entries ?? {})) {
            if (count <= 0) {
                result.add(itemKey);
            }
        }
    }
    return result;
};

export const buildLegacyDefaultUniqueItemPool = (itemRegistry: Map<string, ItemModule>): UniqueItemPool => {
    const pool: UniqueItemPool = { horse: {}, weapon: {}, book: {}, item: {} };
    for (const slot of ['horse', 'weapon', 'book', 'item'] as const) {
        const count = slot === 'item' ? 1 : 2;
        for (const itemKey of LEGACY_UNIQUE_ITEM_KEYS[slot]) {
            const item = itemRegistry.get(itemKey);
            if (item?.slot === slot && !item.buyable) {
                pool[slot]![itemKey] = count;
            }
        }
    }
    return pool;
};

let legacyDefaultUniqueItemPoolPromise: Promise<UniqueItemPool> | null = null;

const cloneUniqueItemPool = (pool: UniqueItemPool): UniqueItemPool =>
    Object.fromEntries(Object.entries(pool).map(([slot, entries]) => [slot, { ...entries }]));

export const loadLegacyDefaultUniqueItemPool = async (loader?: ItemLoader): Promise<UniqueItemPool> => {
    if (loader) {
        const modules = await loadItemModules([...ITEM_KEYS], loader);
        return buildLegacyDefaultUniqueItemPool(createItemModuleRegistry(modules));
    }

    legacyDefaultUniqueItemPoolPromise ??= loadItemModules([...ITEM_KEYS], new ItemLoader()).then((modules) =>
        buildLegacyDefaultUniqueItemPool(createItemModuleRegistry(modules))
    );
    return cloneUniqueItemPool(await legacyDefaultUniqueItemPoolPromise);
};

/**
 * Ref의 GameConst 기본값은 시나리오가 allItems를 덮어쓰지 않아도 항상 존재합니다.
 * 오래된 Core snapshot의 생략값/문자열 빈 객체도 같은 기본 풀로 해석합니다.
 */
export const resolveLegacyCompatibleUniqueConfig = async (
    configConst: Record<string, unknown>,
    loader?: ItemLoader
): Promise<UniqueLotteryConfig> => {
    const config = resolveUniqueConfig(configConst);
    if (Object.keys(config.allItems).length > 0) {
        return config;
    }
    return {
        ...config,
        allItems: await loadLegacyDefaultUniqueItemPool(loader),
    };
};
