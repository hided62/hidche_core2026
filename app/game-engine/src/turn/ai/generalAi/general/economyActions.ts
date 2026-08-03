import { GeneralActionPipeline } from '@sammo-ts/logic';
import { findCrewTypeById, getTechCost } from '@sammo-ts/logic/world/unitSet.js';

import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber, valueFit } from '../../aiUtils.js';

export const do금쌀구매 = (ai: GeneralAI) => {
    const traceEnabled = (process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(ai.general.id));
    const trace = (stage: string, values: Record<string, unknown> = {}) => {
        if (!traceEnabled) {
            return;
        }
        process.stderr.write(
            `AI_ECONOMY_TRACE ${JSON.stringify({ generalId: ai.general.id, stage, ...values })}\n`
        );
    };
    const city = ai.city;
    if (!city) {
        trace('no-city');
        return null;
    }

    const trade = readMetaNumber(asRecord(city.meta), 'trade', 0);
    if (trade === 0 && !ai.generalPolicy.can('상인무시')) {
        return null;
    }

    const generalMeta = asRecord(ai.general.meta);
    const kill = readMetaNumber(generalMeta, 'rank_killcrew', readMetaNumber(generalMeta, 'killcrew', 0)) + 50000;
    const death = readMetaNumber(generalMeta, 'rank_deathcrew', readMetaNumber(generalMeta, 'deathcrew', 0)) + 50000;
    const deathRate = death / kill;

    const absGold = ai.general.gold;
    const absRice = ai.general.rice;
    const relGold = absGold;
    const relRice = absRice * deathRate;

    const baseDevelCost = ai.commandEnv.develCost * 12;
    trace('resources', {
        absGold,
        absRice,
        relGold,
        relRice,
        deathRate,
        baseDevelCost,
        canIgnoreTrader: ai.generalPolicy.can('상인무시'),
        trade,
    });
    if (absGold + absRice < baseDevelCost * 2) {
        trace('insufficient-base-resource');
        return null;
    }

    const crewType = findCrewTypeById(ai.unitSet, ai.general.crewTypeId ?? ai.commandEnv.defaultCrewTypeId);
    const tech = readMetaNumber(asRecord(ai.nation?.meta ?? {}), 'tech', 0);
    const fullLeadership = readMetaNumber(generalMeta, 'fullLeadership', ai.general.stats.leadership);
    const crewAmount = fullLeadership * 100;
    const rawGoldCost = crewType ? (crewType.cost * getTechCost(tech) * crewAmount) / 100 : 0;
    const actionPipeline = new GeneralActionPipeline(ai.commandEnv.generalActionModules ?? []);
    const goldCost = Math.round(
        actionPipeline.onCalcDomestic(
            {
                general: ai.general,
                nation: ai.nation ?? undefined,
                ...(ai.worldRef
                    ? {
                          worldView: {
                              listGenerals: () => ai.worldRef!.listGenerals(),
                              listGeneralsByCity: (cityId: number) =>
                                  ai.worldRef!.listGenerals().filter((candidate) => candidate.cityId === cityId),
                              listNations: () => ai.worldRef!.listNations(),
                          },
                      }
                    : {}),
                time: {
                    year: ai.world.currentYear,
                    month: ai.world.currentMonth,
                    startYear: ai.startYear,
                },
            },
            '징병',
            'cost',
            rawGoldCost,
            { armType: crewType?.armType ?? 0 }
        ) * (ai.generalPolicy.can('모병') ? 2 : 1)
    );
    const riceCost = crewType ? (crewType.rice * getTechCost(tech) * crewAmount) / 100 : 0;
    trace('recruit-cost', {
        crewTypeId: crewType?.id ?? null,
        crewCost: crewType?.cost ?? null,
        crewRice: crewType?.rice ?? null,
        tech,
        crewAmount,
        goldCost,
        riceCost,
    });

    if ((relGold + relRice) * 1.5 <= goldCost + riceCost) {
        return null;
    }

    if (ai.general.npcState < 2 && relGold >= goldCost * 3 && relRice >= riceCost * 3) {
        return null;
    }

    let tryBuying = false;
    if (ai.generalPolicy.can('상인무시')) {
        if (relRice * 1.5 < relGold && relRice < riceCost * 2) {
            tryBuying = true;
        } else if (relRice * 2 < relGold) {
            tryBuying = true;
        }
    } else if (relRice * 2 < relGold && relRice < riceCost * 3) {
        tryBuying = true;
    }

    if (tryBuying) {
        const amount = valueFit(
            Math.floor((relGold - relRice) / (1 + deathRate)),
            100,
            ai.aiConst.maxResourceActionAmount
        );
        if (amount >= ai.nationPolicy.minimumResourceActionAmount) {
            const result = ai.buildGeneralCandidate('che_군량매매', { buyRice: true, amount }, '금쌀구매');
            trace('buy', { amount, minimumResourceActionAmount: ai.nationPolicy.minimumResourceActionAmount, result });
            return result;
        }
    }

    let trySelling = false;
    if (ai.generalPolicy.can('상인무시')) {
        if (relGold * 1.5 < relRice && relGold < goldCost * 2) {
            trySelling = true;
        } else if (relGold * 2 < relRice) {
            trySelling = true;
        }
    } else if (relGold * 2 < relRice && relGold < goldCost * 3) {
        trySelling = true;
    }

    if (trySelling) {
        const amount = valueFit(
            Math.floor((relRice - relGold) / (1 + deathRate)),
            100,
            ai.aiConst.maxResourceActionAmount
        );
        if (amount >= ai.nationPolicy.minimumResourceActionAmount) {
            return ai.buildGeneralCandidate('che_군량매매', { buyRice: false, amount }, '금쌀구매');
        }
    }

    return null;
};
