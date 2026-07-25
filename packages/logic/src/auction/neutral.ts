import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import { simpleSerialize } from '../war/utils.js';

export type NeutralResourceAuctionType = 'BUY_RICE' | 'SELL_RICE';

export interface NeutralAuctionPlanInput {
    hiddenSeed: string | number;
    seedYear: number;
    seedMonth: number;
    nationCount: number;
    consumeTournamentRoll: boolean;
    averageGold: number;
    averageRice: number;
    buyRiceAuctionCount: number;
    sellRiceAuctionCount: number;
}

export interface NeutralResourceAuctionPlan {
    auctionType: NeutralResourceAuctionType;
    amount: number;
    startBidAmount: number;
    finishBidAmount: number;
    closeTurnCnt: number;
}

const clamp = (value: number, min: number, max: number): number => {
    if (max < min) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
};

const roundToTens = (value: number): number => Math.round(value / 10) * 10;

const normalizeCount = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

const normalizeAverage = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 1_000, 20_000);

const canOpenResourceAuction = (plan: NeutralResourceAuctionPlan): boolean =>
    plan.closeTurnCnt >= 1 &&
    plan.closeTurnCnt <= 24 &&
    plan.amount >= 100 &&
    plan.amount <= 10_000 &&
    plan.startBidAmount >= plan.amount * 0.5 &&
    plan.startBidAmount <= plan.amount * 2 &&
    plan.finishBidAmount >= plan.amount * 1.1 &&
    plan.finishBidAmount <= plan.amount * 2 &&
    plan.finishBidAmount >= plan.startBidAmount * 1.1;

export const buildNeutralResourceAuctionPlan = (input: NeutralAuctionPlanInput): NeutralResourceAuctionPlan[] => {
    // ref TurnExecutionHelper는 날짜를 넘기기 전에 이전 연월로 monthly RNG를 만든다.
    const rng = new RandUtil(
        new LiteHashDRBG(simpleSerialize(input.hiddenSeed, 'monthly', input.seedYear, input.seedMonth))
    );

    // ref postUpdateMonthly()의 국가 국력 보정이 registerAuction()보다 먼저 RNG를 소비한다.
    for (let nationIdx = 0; nationIdx < normalizeCount(input.nationCount); nationIdx += 1) {
        rng.nextRange(0.95, 1.05);
    }
    // 토너먼트가 없고 자동 개시가 켜진 경우 성공 여부와 무관하게 한 번 소비한다.
    if (input.consumeTournamentRoll) {
        rng.nextBool(0.4);
    }

    const averageGold = normalizeAverage(input.averageGold);
    const averageRice = normalizeAverage(input.averageRice);
    const result: NeutralResourceAuctionPlan[] = [];

    const buyRiceAuctionCount = normalizeCount(input.buyRiceAuctionCount);
    if (rng.nextBool(1 / (buyRiceAuctionCount + 5))) {
        const multiplier = rng.nextRangeInt(1, 5);
        const rawAmount = (averageRice / 20) * multiplier;
        const rawStartBid = clamp((averageGold / 20) * 0.9 * multiplier, rawAmount * 0.8, rawAmount * 1.2);
        const plan: NeutralResourceAuctionPlan = {
            auctionType: 'BUY_RICE',
            amount: roundToTens(rawAmount),
            startBidAmount: roundToTens(rawStartBid),
            finishBidAmount: roundToTens(rawAmount * 2),
            closeTurnCnt: rng.nextRangeInt(3, 12),
        };
        if (canOpenResourceAuction(plan)) {
            result.push(plan);
        }
    }

    const sellRiceAuctionCount = normalizeCount(input.sellRiceAuctionCount);
    if (rng.nextBool(1 / (sellRiceAuctionCount + 5))) {
        const multiplier = rng.nextRangeInt(1, 5);
        const rawAmount = (averageGold / 20) * multiplier;
        const rawStartBid = clamp((averageRice / 20) * 1.1 * multiplier, rawAmount * 0.8, rawAmount * 1.2);
        const plan: NeutralResourceAuctionPlan = {
            auctionType: 'SELL_RICE',
            amount: roundToTens(rawAmount),
            startBidAmount: roundToTens(rawStartBid),
            finishBidAmount: roundToTens(rawAmount * 2),
            closeTurnCnt: rng.nextRangeInt(3, 12),
        };
        if (canOpenResourceAuction(plan)) {
            result.push(plan);
        }
    }

    return result;
};
