import { JosaUtil } from '@sammo-ts/common';
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
    onArbitraryAction: (context, actionType, phase, aux) => {
        if (!aux || actionType !== '장비매매' || phase !== '판매') {
            return aux ?? null;
        }
        if (aux['itemKey'] !== ITEM_KEY && aux['itemCode'] !== ITEM_KEY) {
            return aux;
        }

        const year = resolveNumber(aux['year']);
        const startYear = resolveNumber(aux['startYear']);
        const relYear = Math.max(0, year - startYear);
        const score = Math.round(10000 + 5000 * Math.floor(relYear / 2));

        const rng = context.rng;
        const pick = rng?.nextBool(0.5) ?? true;
        const resName = pick ? '금' : '쌀';
        const resKey = pick ? 'gold' : 'rice';

        const nation = aux['nation'];
        if (nation && typeof nation === 'object') {
            const cast = nation as { gold?: number; rice?: number };
            const half = Math.floor(score / 2);
            if (resKey === 'gold') {
                cast.gold = (cast.gold ?? 0) + half;
            } else {
                cast.rice = (cast.rice ?? 0) + half;
            }
        }

        const selfGain = score - Math.floor(score / 2);
        if (resKey === 'gold') {
            context.general.gold += selfGain;
        } else {
            context.general.rice += selfGain;
        }

        const josa = JosaUtil.pick('도기', '을');
        context.log?.push(
            `<C>${itemModule.name}</>${josa} 판매하여 ${resName} <C>${score.toLocaleString('en-US')}</>을 보충합니다.`
        );
        return aux;
    },
};
