import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import {
    createGeneralActionEvent,
    dispatchGeneralActionEventHandlers,
    type GeneralActionEvent,
    type GeneralActionEventContext,
    type GeneralActionEventType,
} from '@sammo-ts/logic/actionModules/events.js';
import { GeneralTriggerCaller, type GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type {
    GeneralStatName,
    TriggerDomesticActionType,
    TriggerDomesticVarType,
    TriggerNationalIncomeType,
    TriggerStrategicActionType,
    TriggerStrategicVarType,
    WarStatName,
} from '@sammo-ts/logic/actionModules/types.js';
import type { WarActionContext, WarActionModule } from '@sammo-ts/logic/war/actions.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule, ItemModuleExport } from './types.js';
import { listEquippedItemKeys } from './utils.js';
import { registerLegacyBattleItemIdentity, removeEquippedItem } from './inventory.js';

export const ITEM_KEYS = [
    'che_간파_노군입산부',
    'che_격노_구정신단경',
    'che_계략_삼략',
    'che_계략_육도',
    'che_계략_이추',
    'che_계략_향낭',
    'che_공성_묵자',
    'che_내정_납금박산로',
    'che_농성_위공자병법',
    'che_농성_주서음부',
    'che_능력치_무력_두강주',
    'che_능력치_지력_이강주',
    'che_능력치_통솔_보령압주',
    'che_명마_01_노기',
    'che_명마_02_조랑',
    'che_명마_03_노새',
    'che_명마_04_나귀',
    'che_명마_05_갈색마',
    'che_명마_06_흑색마',
    'che_명마_07_기주마',
    'che_명마_07_백마',
    'che_명마_07_백상',
    'che_명마_07_오환마',
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
    'che_명마_13_적로',
    'che_명마_13_절영',
    'che_명마_14_적란마',
    'che_명마_14_조황비전',
    'che_명마_15_적토마',
    'che_명마_15_한혈마',
    'che_명성_구석',
    'che_무기_01_단도',
    'che_무기_02_단궁',
    'che_무기_03_단극',
    'che_무기_04_목검',
    'che_무기_05_죽창',
    'che_무기_06_소부',
    'che_무기_07_동추',
    'che_무기_07_맥궁',
    'che_무기_07_철쇄',
    'che_무기_07_철편',
    'che_무기_08_유성추',
    'che_무기_08_철질여골',
    'che_무기_09_동호비궁',
    'che_무기_09_쌍철극',
    'che_무기_10_대부',
    'che_무기_10_삼첨도',
    'che_무기_11_고정도',
    'che_무기_11_이광궁',
    'che_무기_12_철척사모',
    'che_무기_12_칠성검',
    'che_무기_13_사모',
    'che_무기_13_양유기궁',
    'che_무기_14_방천화극',
    'che_무기_14_언월도',
    'che_무기_15_의천검',
    'che_무기_15_청홍검',
    'che_보물_도기',
    'che_부적_태현청생부',
    'che_불굴_상편',
    'che_사기_초선화',
    'che_사기_춘화첩',
    'che_사기_탁주',
    'che_상성보정_과실주',
    'che_서적_01_효경전',
    'che_서적_02_회남자',
    'che_서적_03_변도론',
    'che_서적_04_건상역주',
    'che_서적_05_여씨춘추',
    'che_서적_06_사민월령',
    'che_서적_07_논어',
    'che_서적_07_사마법',
    'che_서적_07_위료자',
    'che_서적_07_한서',
    'che_서적_08_사기',
    'che_서적_08_전론',
    'che_서적_09_역경',
    'che_서적_09_장자',
    'che_서적_10_구국론',
    'che_서적_10_시경',
    'che_서적_11_상군서',
    'che_서적_11_춘추전',
    'che_서적_12_맹덕신서',
    'che_서적_12_산해경',
    'che_서적_13_관자',
    'che_서적_13_병법24편',
    'che_서적_14_오자병법',
    'che_서적_14_한비자',
    'che_서적_15_노자',
    'che_서적_15_손자병법',
    'che_숙련_동작',
    'che_약탈_옥벽',
    'che_위압_조목삭',
    'che_의술_상한잡병론',
    'che_의술_정력견혈산',
    'che_의술_청낭서',
    'che_의술_태평청령',
    'che_저격_매화수전',
    'che_저격_비도',
    'che_저격_수극',
    'che_저지_삼황내문',
    'che_전략_평만지장도',
    'che_조달_주판',
    'che_진압_박혁론',
    'che_집중_전국책',
    'che_징병_낙주',
    'che_척사_오악진형도',
    'che_치료_환약',
    'che_필살_둔갑천서',
    'che_행동_서촉지형도',
    'che_환술_논어집해',
    'che_회피_태평요술',
    'che_훈련_단결도',
    'che_훈련_철벽서',
    'che_훈련_청주',
    'event_전투특기_격노',
    'event_전투특기_견고',
    'event_전투특기_공성',
    'event_전투특기_궁병',
    'event_전투특기_귀병',
    'event_전투특기_기병',
    'event_전투특기_돌격',
    'event_전투특기_무쌍',
    'event_전투특기_반계',
    'event_전투특기_보병',
    'event_전투특기_신산',
    'event_전투특기_신중',
    'event_전투특기_위압',
    'event_전투특기_의술',
    'event_전투특기_저격',
    'event_전투특기_집중',
    'event_전투특기_징병',
    'event_전투특기_척사',
    'event_전투특기_필살',
    'event_전투특기_환술',
    'event_충차',
] as const;

export type ItemKey = (typeof ITEM_KEYS)[number];

export type ItemImporter = () => Promise<ItemModuleExport>;

const defaultImporters: Record<ItemKey, ItemImporter> = {
    che_간파_노군입산부: async () => import('./che_간파_노군입산부.js'),
    che_격노_구정신단경: async () => import('./che_격노_구정신단경.js'),
    che_계략_삼략: async () => import('./che_계략_삼략.js'),
    che_계략_육도: async () => import('./che_계략_육도.js'),
    che_계략_이추: async () => import('./che_계략_이추.js'),
    che_계략_향낭: async () => import('./che_계략_향낭.js'),
    che_공성_묵자: async () => import('./che_공성_묵자.js'),
    che_내정_납금박산로: async () => import('./che_내정_납금박산로.js'),
    che_농성_위공자병법: async () => import('./che_농성_위공자병법.js'),
    che_농성_주서음부: async () => import('./che_농성_주서음부.js'),
    che_능력치_무력_두강주: async () => import('./che_능력치_무력_두강주.js'),
    che_능력치_지력_이강주: async () => import('./che_능력치_지력_이강주.js'),
    che_능력치_통솔_보령압주: async () => import('./che_능력치_통솔_보령압주.js'),
    che_명마_01_노기: async () => import('./che_명마_01_노기.js'),
    che_명마_02_조랑: async () => import('./che_명마_02_조랑.js'),
    che_명마_03_노새: async () => import('./che_명마_03_노새.js'),
    che_명마_04_나귀: async () => import('./che_명마_04_나귀.js'),
    che_명마_05_갈색마: async () => import('./che_명마_05_갈색마.js'),
    che_명마_06_흑색마: async () => import('./che_명마_06_흑색마.js'),
    che_명마_07_기주마: async () => import('./che_명마_07_기주마.js'),
    che_명마_07_백마: async () => import('./che_명마_07_백마.js'),
    che_명마_07_백상: async () => import('./che_명마_07_백상.js'),
    che_명마_07_오환마: async () => import('./che_명마_07_오환마.js'),
    che_명마_08_양주마: async () => import('./che_명마_08_양주마.js'),
    che_명마_08_흉노마: async () => import('./che_명마_08_흉노마.js'),
    che_명마_09_과하마: async () => import('./che_명마_09_과하마.js'),
    che_명마_09_의남백마: async () => import('./che_명마_09_의남백마.js'),
    che_명마_10_대완마: async () => import('./che_명마_10_대완마.js'),
    che_명마_10_옥추마: async () => import('./che_명마_10_옥추마.js'),
    che_명마_11_서량마: async () => import('./che_명마_11_서량마.js'),
    che_명마_11_화종마: async () => import('./che_명마_11_화종마.js'),
    che_명마_12_사륜거: async () => import('./che_명마_12_사륜거.js'),
    che_명마_12_옥란백용구: async () => import('./che_명마_12_옥란백용구.js'),
    che_명마_13_적로: async () => import('./che_명마_13_적로.js'),
    che_명마_13_절영: async () => import('./che_명마_13_절영.js'),
    che_명마_14_적란마: async () => import('./che_명마_14_적란마.js'),
    che_명마_14_조황비전: async () => import('./che_명마_14_조황비전.js'),
    che_명마_15_적토마: async () => import('./che_명마_15_적토마.js'),
    che_명마_15_한혈마: async () => import('./che_명마_15_한혈마.js'),
    che_명성_구석: async () => import('./che_명성_구석.js'),
    che_무기_01_단도: async () => import('./che_무기_01_단도.js'),
    che_무기_02_단궁: async () => import('./che_무기_02_단궁.js'),
    che_무기_03_단극: async () => import('./che_무기_03_단극.js'),
    che_무기_04_목검: async () => import('./che_무기_04_목검.js'),
    che_무기_05_죽창: async () => import('./che_무기_05_죽창.js'),
    che_무기_06_소부: async () => import('./che_무기_06_소부.js'),
    che_무기_07_동추: async () => import('./che_무기_07_동추.js'),
    che_무기_07_맥궁: async () => import('./che_무기_07_맥궁.js'),
    che_무기_07_철쇄: async () => import('./che_무기_07_철쇄.js'),
    che_무기_07_철편: async () => import('./che_무기_07_철편.js'),
    che_무기_08_유성추: async () => import('./che_무기_08_유성추.js'),
    che_무기_08_철질여골: async () => import('./che_무기_08_철질여골.js'),
    che_무기_09_동호비궁: async () => import('./che_무기_09_동호비궁.js'),
    che_무기_09_쌍철극: async () => import('./che_무기_09_쌍철극.js'),
    che_무기_10_대부: async () => import('./che_무기_10_대부.js'),
    che_무기_10_삼첨도: async () => import('./che_무기_10_삼첨도.js'),
    che_무기_11_고정도: async () => import('./che_무기_11_고정도.js'),
    che_무기_11_이광궁: async () => import('./che_무기_11_이광궁.js'),
    che_무기_12_철척사모: async () => import('./che_무기_12_철척사모.js'),
    che_무기_12_칠성검: async () => import('./che_무기_12_칠성검.js'),
    che_무기_13_사모: async () => import('./che_무기_13_사모.js'),
    che_무기_13_양유기궁: async () => import('./che_무기_13_양유기궁.js'),
    che_무기_14_방천화극: async () => import('./che_무기_14_방천화극.js'),
    che_무기_14_언월도: async () => import('./che_무기_14_언월도.js'),
    che_무기_15_의천검: async () => import('./che_무기_15_의천검.js'),
    che_무기_15_청홍검: async () => import('./che_무기_15_청홍검.js'),
    che_보물_도기: async () => import('./che_보물_도기.js'),
    che_부적_태현청생부: async () => import('./che_부적_태현청생부.js'),
    che_불굴_상편: async () => import('./che_불굴_상편.js'),
    che_사기_초선화: async () => import('./che_사기_초선화.js'),
    che_사기_춘화첩: async () => import('./che_사기_춘화첩.js'),
    che_사기_탁주: async () => import('./che_사기_탁주.js'),
    che_상성보정_과실주: async () => import('./che_상성보정_과실주.js'),
    che_서적_01_효경전: async () => import('./che_서적_01_효경전.js'),
    che_서적_02_회남자: async () => import('./che_서적_02_회남자.js'),
    che_서적_03_변도론: async () => import('./che_서적_03_변도론.js'),
    che_서적_04_건상역주: async () => import('./che_서적_04_건상역주.js'),
    che_서적_05_여씨춘추: async () => import('./che_서적_05_여씨춘추.js'),
    che_서적_06_사민월령: async () => import('./che_서적_06_사민월령.js'),
    che_서적_07_논어: async () => import('./che_서적_07_논어.js'),
    che_서적_07_사마법: async () => import('./che_서적_07_사마법.js'),
    che_서적_07_위료자: async () => import('./che_서적_07_위료자.js'),
    che_서적_07_한서: async () => import('./che_서적_07_한서.js'),
    che_서적_08_사기: async () => import('./che_서적_08_사기.js'),
    che_서적_08_전론: async () => import('./che_서적_08_전론.js'),
    che_서적_09_역경: async () => import('./che_서적_09_역경.js'),
    che_서적_09_장자: async () => import('./che_서적_09_장자.js'),
    che_서적_10_구국론: async () => import('./che_서적_10_구국론.js'),
    che_서적_10_시경: async () => import('./che_서적_10_시경.js'),
    che_서적_11_상군서: async () => import('./che_서적_11_상군서.js'),
    che_서적_11_춘추전: async () => import('./che_서적_11_춘추전.js'),
    che_서적_12_맹덕신서: async () => import('./che_서적_12_맹덕신서.js'),
    che_서적_12_산해경: async () => import('./che_서적_12_산해경.js'),
    che_서적_13_관자: async () => import('./che_서적_13_관자.js'),
    che_서적_13_병법24편: async () => import('./che_서적_13_병법24편.js'),
    che_서적_14_오자병법: async () => import('./che_서적_14_오자병법.js'),
    che_서적_14_한비자: async () => import('./che_서적_14_한비자.js'),
    che_서적_15_노자: async () => import('./che_서적_15_노자.js'),
    che_서적_15_손자병법: async () => import('./che_서적_15_손자병법.js'),
    che_숙련_동작: async () => import('./che_숙련_동작.js'),
    che_약탈_옥벽: async () => import('./che_약탈_옥벽.js'),
    che_위압_조목삭: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_위압.js'),
            import('./eventBattleTrait.js'),
        ]);
        return {
            itemModule: createEventBattleTraitItemModule('che_위압_조목삭', traitModule, {
                rawName: '조목삭',
                name: '조목삭(위압)',
                cost: 200,
                buyable: false,
                reqSecu: 0,
            }),
        };
    },
    che_의술_상한잡병론: async () => import('./che_의술_상한잡병론.js'),
    che_의술_정력견혈산: async () => import('./che_의술_정력견혈산.js'),
    che_의술_청낭서: async () => import('./che_의술_청낭서.js'),
    che_의술_태평청령: async () => import('./che_의술_태평청령.js'),
    che_저격_매화수전: async () => import('./che_저격_매화수전.js'),
    che_저격_비도: async () => import('./che_저격_비도.js'),
    che_저격_수극: async () => import('./che_저격_수극.js'),
    che_저지_삼황내문: async () => import('./che_저지_삼황내문.js'),
    che_전략_평만지장도: async () => import('./che_전략_평만지장도.js'),
    che_조달_주판: async () => import('./che_조달_주판.js'),
    che_진압_박혁론: async () => import('./che_진압_박혁론.js'),
    che_집중_전국책: async () => import('./che_집중_전국책.js'),
    che_징병_낙주: async () => import('./che_징병_낙주.js'),
    che_척사_오악진형도: async () => import('./che_척사_오악진형도.js'),
    che_치료_환약: async () => import('./che_치료_환약.js'),
    che_필살_둔갑천서: async () => import('./che_필살_둔갑천서.js'),
    che_행동_서촉지형도: async () => import('./che_행동_서촉지형도.js'),
    che_환술_논어집해: async () => import('./che_환술_논어집해.js'),
    che_회피_태평요술: async () => import('./che_회피_태평요술.js'),
    che_훈련_단결도: async () => import('./che_훈련_단결도.js'),
    che_훈련_철벽서: async () => import('./che_훈련_철벽서.js'),
    che_훈련_청주: async () => import('./che_훈련_청주.js'),
    event_전투특기_격노: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_격노.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_격노', traitModule) };
    },
    event_전투특기_견고: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_견고.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_견고', traitModule) };
    },
    event_전투특기_공성: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_공성.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_공성', traitModule) };
    },
    event_전투특기_궁병: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_궁병.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_궁병', traitModule) };
    },
    event_전투특기_귀병: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_귀병.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_귀병', traitModule) };
    },
    event_전투특기_기병: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_기병.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_기병', traitModule) };
    },
    event_전투특기_돌격: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_돌격.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_돌격', traitModule) };
    },
    event_전투특기_무쌍: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_무쌍.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_무쌍', traitModule) };
    },
    event_전투특기_반계: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_반계.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_반계', traitModule) };
    },
    event_전투특기_보병: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_보병.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_보병', traitModule) };
    },
    event_전투특기_신산: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_신산.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_신산', traitModule) };
    },
    event_전투특기_신중: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_신중.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_신중', traitModule) };
    },
    event_전투특기_위압: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_위압.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_위압', traitModule) };
    },
    event_전투특기_의술: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_의술.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_의술', traitModule) };
    },
    event_전투특기_저격: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_저격.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_저격', traitModule) };
    },
    event_전투특기_집중: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_집중.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_집중', traitModule) };
    },
    event_전투특기_징병: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_징병.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_징병', traitModule) };
    },
    event_전투특기_척사: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_척사.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_척사', traitModule) };
    },
    event_전투특기_필살: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_필살.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_필살', traitModule) };
    },
    event_전투특기_환술: async () => {
        const [{ traitModule }, { createEventBattleTraitItemModule }] = await Promise.all([
            import('../actionModules/traits/war/che_환술.js'),
            import('./eventBattleTrait.js'),
        ]);
        return { itemModule: createEventBattleTraitItemModule('event_전투특기_환술', traitModule) };
    },
    event_충차: async () => import('./event_충차.js'),
};

export const isItemKey = (value: string): value is ItemKey => ITEM_KEYS.includes(value as ItemKey);

export class ItemLoader {
    private readonly cache = new Map<ItemKey, Promise<ItemModule>>();

    constructor(private readonly importers: Record<ItemKey, ItemImporter> = defaultImporters) {}

    async load(key: ItemKey): Promise<ItemModule> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const importer = this.importers[key];
        if (!importer) {
            throw new Error(`Unknown item key: ${key}`);
        }
        const loading = importer().then((module) => {
            if (!('itemModule' in module)) {
                throw new Error(`Missing itemModule for item: ${key}`);
            }
            const resolved: ItemModule = {
                ...module.itemModule,
                // Legacy defines the finite unique pool as every non-buyable
                // scenario item; keep that invariant authoritative instead of
                // relying on duplicated per-module flags.
                unique: !module.itemModule.buyable,
            };
            if (resolved.key !== key) {
                throw new Error(`Item key mismatch: expected ${key}, got ${resolved.key}`);
            }
            return resolved;
        });
        this.cache.set(key, loading);
        return loading;
    }
}

export const loadItemModules = async (
    keys: ItemKey[],
    loader: ItemLoader = new ItemLoader()
): Promise<ItemModule[]> => {
    const modules: ItemModule[] = [];
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

export type ItemModuleRegistry<TriggerState extends GeneralTriggerState = GeneralTriggerState> = Map<
    string,
    ItemModule<TriggerState>
>;

export const createItemModuleRegistry = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    modules: ItemModule<TriggerState>[]
): ItemModuleRegistry<TriggerState> => {
    const registry: ItemModuleRegistry<TriggerState> = new Map();
    for (const module of modules) {
        registry.set(module.key, module);
    }
    return registry;
};

class ItemGeneralActionRouter<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    constructor(private readonly registry: ItemModuleRegistry<TriggerState>) {}

    private resolveModules(context: GeneralActionContext<TriggerState>): Array<ItemModule<TriggerState>> {
        const keys = listEquippedItemKeys(context.general);
        const modules: Array<ItemModule<TriggerState>> = [];
        for (const key of keys) {
            const module = this.registry.get(key);
            if (module) {
                modules.push(module);
            }
        }
        return modules;
    }

    getPreTurnExecuteTriggerList(
        context: GeneralActionContext<TriggerState>
    ): GeneralTriggerCaller<TriggerState> | null {
        const caller = new GeneralTriggerCaller<TriggerState>();
        for (const module of this.resolveModules(context)) {
            const triggers = module.getPreTurnExecuteTriggerList?.(context);
            if (triggers) {
                caller.merge(triggers);
            }
        }
        return caller.isEmpty() ? null : caller;
    }

    onCalcDomestic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerDomesticActionType,
        varType: TriggerDomesticVarType,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcDomestic) {
                continue;
            }
            current = module.onCalcDomestic(context, turnType, varType, current, aux);
        }
        return current;
    }

    onCalcStat(
        context: GeneralActionContext<TriggerState>,
        statName: GeneralStatName,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcStat) {
                continue;
            }
            current = module.onCalcStat(context, statName, current, aux);
        }
        return current;
    }

    onCalcOpposeStat(
        context: GeneralActionContext<TriggerState>,
        statName: GeneralStatName,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcOpposeStat) {
                continue;
            }
            current = module.onCalcOpposeStat(context, statName, current, aux);
        }
        return current;
    }

    onCalcStrategic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerStrategicActionType,
        varType: TriggerStrategicVarType,
        value: number
    ): number {
        let current = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcStrategic) {
                continue;
            }
            current = module.onCalcStrategic(context, turnType, varType, current);
        }
        return current;
    }

    onCalcNationalIncome(
        context: GeneralActionContext<TriggerState>,
        type: TriggerNationalIncomeType,
        amount: number
    ): number {
        let current = amount;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcNationalIncome) {
                continue;
            }
            current = module.onCalcNationalIncome(context, type, current);
        }
        return current;
    }

    handleEvent<K extends GeneralActionEventType>(
        context: GeneralActionEventContext<K, TriggerState>,
        event: GeneralActionEvent<K, TriggerState>
    ): GeneralActionEvent<K, TriggerState> {
        let current = event;
        for (const module of this.resolveModules(context)) {
            current = dispatchGeneralActionEventHandlers(module.eventHandlers, context, current);

            if (current.type === 'strategy.succeeded' && module.consumeOnStrategySuccess) {
                const removed = removeEquippedItem(context.general, module.slot);
                if (removed?.itemKey === module.key) {
                    const strategyEvent = current as GeneralActionEvent<'strategy.succeeded', TriggerState>;
                    current = createGeneralActionEvent<TriggerState, 'strategy.succeeded'>('strategy.succeeded', {
                        consumedItems: [...strategyEvent.payload.consumedItems, module.key],
                    }) as GeneralActionEvent<K, TriggerState>;
                }
            }
        }
        return current;
    }
}

class ItemWarActionRouter<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements WarActionModule<TriggerState> {
    constructor(private readonly registry: ItemModuleRegistry<TriggerState>) {}

    private resolveModules(context: WarActionContext<TriggerState>): Array<ItemModule<TriggerState>> {
        const keys = listEquippedItemKeys(context.general);
        const modules: Array<ItemModule<TriggerState>> = [];
        let itemIdentity = { name: '-', rawName: '-' };
        for (const key of keys) {
            const module = this.registry.get(key);
            if (module) {
                modules.push(module);
                if (module.slot === 'item') {
                    itemIdentity = { name: module.name, rawName: module.rawName };
                }
            }
        }
        registerLegacyBattleItemIdentity(context.general, itemIdentity);
        return modules;
    }

    getBattleInitTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller | null {
        const caller = new WarTriggerCaller();
        for (const module of this.resolveModules(context)) {
            const triggers = module.getBattleInitTriggerList?.(context);
            if (triggers) {
                caller.merge(triggers);
            }
        }
        return caller.isEmpty() ? null : caller;
    }

    getBattlePhaseTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller | null {
        const caller = new WarTriggerCaller();
        for (const module of this.resolveModules(context)) {
            const triggers = module.getBattlePhaseTriggerList?.(context);
            if (triggers) {
                caller.merge(triggers);
            }
        }
        return caller.isEmpty() ? null : caller;
    }

    onCalcStat(
        context: WarActionContext<TriggerState>,
        statName: WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        let current: number | [number, number] = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcStat) {
                continue;
            }
            current = module.onCalcStat(context, statName, current, aux);
        }
        return current;
    }

    onCalcOpposeStat(
        context: WarActionContext<TriggerState>,
        statName: WarStatName,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        let current: number | [number, number] = value;
        for (const module of this.resolveModules(context)) {
            if (!module.onCalcOpposeStat) {
                continue;
            }
            current = module.onCalcOpposeStat(context, statName, current, aux);
        }
        return current;
    }

    getWarPowerMultiplier(
        context: WarActionContext<TriggerState>,
        unit: WarUnit<TriggerState>,
        oppose: WarUnit<TriggerState>
    ): [number, number] {
        let attack = 1;
        let defence = 1;
        for (const module of this.resolveModules(context)) {
            if (!module.getWarPowerMultiplier) {
                continue;
            }
            const [attMul, defMul] = module.getWarPowerMultiplier(context, unit, oppose);
            attack *= attMul;
            defence *= defMul;
        }
        return [attack, defence];
    }
}

export const createItemActionModules = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    registry: ItemModuleRegistry<TriggerState>
): { general: ReadonlyArray<GeneralActionModule<TriggerState>>; war: WarActionModule<TriggerState>[] } => ({
    general: [new ItemGeneralActionRouter(registry)],
    war: [new ItemWarActionRouter(registry)],
});

export type { ItemModule, ItemModuleExport, ItemSlot } from './types.js';
export {
    cloneItemInventory,
    ensureItemInventory,
    equipNewItem,
    getEquippedItemInstance,
    projectItemSlots,
    readItemInventoryFromMeta,
    removeEquippedItem,
    withSerializedItemInventory,
} from './inventory.js';
