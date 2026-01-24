import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber } from '../../aiUtils.js';
import { t통솔장 } from './helpers.js';

export const doNPC헌납 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const resourceMap: Array<['rice' | 'gold', number, number, number]> = [
        ['rice', ai.nationPolicy.reqNationRice, ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
        ['gold', ai.nationPolicy.reqNationGold, ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
    ];
    const args: Array<[Record<string, unknown>, number]> = [];

    for (const [resKey, reqNation, reqNpcWar, reqNpcDevel] of resourceMap) {
        const genRes = ai.general[resKey];
        let reqRes = reqNpcDevel;

        if (ai.genType & t통솔장) {
            reqRes = reqNpcWar;
        } else {
            if (genRes >= reqNpcWar && reqNpcWar > reqNpcDevel + 1000) {
                const amount = genRes - reqNpcDevel;
                args.push([{ isGold: resKey === 'gold', amount }, amount]);
                continue;
            }
            if (genRes >= reqNpcDevel * 5 && genRes >= 5000) {
                const amount = genRes - reqNpcDevel;
                args.push([{ isGold: resKey === 'gold', amount }, amount]);
                continue;
            }
        }

        if (nation[resKey] >= reqNation) {
            continue;
        }
        if (
            resKey === 'rice' &&
            nation[resKey] <= ai.aiConst.minNationalRice / 2 &&
            genRes >= ai.aiConst.minNationalRice / 2
        ) {
            const amount = genRes < ai.aiConst.minNationalRice ? genRes : genRes / 2;
            args.push([{ isGold: false, amount }, amount]);
        }
        if (genRes < reqRes * 1.5) {
            continue;
        }
        if (reqRes > 0 && !ai.rng.nextBool(genRes / reqRes - 0.5)) {
            continue;
        }
        const amount = genRes - reqRes;
        if (amount < ai.nationPolicy.minimumResourceActionAmount) {
            continue;
        }
        args.push([{ isGold: resKey === 'gold', amount }, amount]);
    }

    if (args.length === 0) {
        return null;
    }

    return ai.buildGeneralCandidate('che_헌납', ai.rng.choiceUsingWeightPair(args), 'NPC헌납');
};

export const doNPC사망대비 = (ai: GeneralAI) => {
    const killturn = readMetaNumber(asRecord(ai.general.meta), 'killturn', 999);
    if (killturn > 5) {
        return null;
    }

    if (ai.general.nationId === 0) {
        const search = ai.buildGeneralCandidate('che_인재탐색', {}, 'NPC사망대비');
        if (search && !ai.rng.nextBool()) {
            return search;
        }
        return ai.buildGeneralCandidate('che_견문', {}, 'NPC사망대비');
    }

    if (ai.general.gold + ai.general.rice === 0) {
        return ai.buildGeneralCandidate('che_물자조달', {}, 'NPC사망대비');
    }

    if (ai.general.gold >= ai.general.rice) {
        return ai.buildGeneralCandidate(
            'che_헌납',
            { isGold: true, amount: ai.aiConst.maxResourceActionAmount },
            'NPC사망대비'
        );
    }
    return ai.buildGeneralCandidate(
        'che_헌납',
        { isGold: false, amount: ai.aiConst.maxResourceActionAmount },
        'NPC사망대비'
    );
};
