import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_보물_도기';

const resolveNumber = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '도기',
    name: '도기(보물)',
    info: '[개인] 판매 시 장수 소지금과 국고에 금, 쌀 중 하나를 추가 (총 +10,000, 2년마다 +5,000)',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: true,
    eventHandlers: {
        'item.sold': (context, event) => {
            if (event.payload.itemKey !== ITEM_KEY) {
                return event;
            }

            const year = resolveNumber(context.time.year);
            const startYear = resolveNumber(context.time.startYear);
            const relYear = Math.max(0, year - startYear);
            const score = Math.round(10000 + 5000 * Math.floor(relYear / 2));

            // ref RandUtil::choice([gold, rice])는 index 0을 금으로 고릅니다.
            const pickGold = context.rng.nextInt(0, 2) === 0;
            const resName = pickGold ? '금' : '쌀';
            const resKey = pickGold ? 'gold' : 'rice';

            const nation = context.nation;
            if (nation && nation.id !== 0) {
                const half = Math.floor(score / 2);
                nation[resKey] += half;
            }

            const selfGain = score - Math.floor(score / 2);
            context.general[resKey] += selfGain;
            context.log?.push(`재산과 국고에 총 ${resName} <C>${score.toLocaleString('en-US')}</>을 보충합니다.`);
            return event;
        },
    },
};
