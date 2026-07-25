export interface NationBettingStake {
    generalId: number;
    userId: string | null;
    selection: number[];
    amount: number;
}

export interface NationBettingReward {
    generalId: number;
    userId: string | null;
    amount: number;
    matchPoint: number;
}

export const purifyNationBettingSelection = (
    selection: readonly number[],
    selectCount: number
): number[] => {
    const purified = [...selection].sort((left, right) => left - right);
    const unique = purified.filter((value, index) => index === 0 || value !== purified[index - 1]);
    if (unique.length !== selectCount) {
        throw new Error('중복된 값이 있습니다.');
    }
    return unique;
};

export const calculateNationBettingRewards = (options: {
    selectCount: number;
    isExclusive: boolean | null;
    winner: readonly number[];
    stakes: readonly NationBettingStake[];
}): NationBettingReward[] => {
    const winner = purifyNationBettingSelection(options.winner, options.selectCount);
    const totalAmount = options.stakes.reduce((sum, stake) => sum + stake.amount, 0);
    if (totalAmount === 0) {
        return [];
    }

    if (options.selectCount === 1 || options.isExclusive === true) {
        const winnerKey = JSON.stringify(winner);
        const winnerList = options.stakes.filter(
            (stake) => stake.generalId > 0 && JSON.stringify(stake.selection) === winnerKey
        );
        const winnerAmount = winnerList.reduce((sum, stake) => sum + stake.amount, 0);
        // Legacy creates a refundList here but accidentally returns an empty
        // result. Preserve that observable no-winner behavior.
        if (winnerAmount === 0) {
            return [];
        }
        const multiplier = totalAmount / winnerAmount;
        return winnerList.map((stake) => ({
            generalId: stake.generalId,
            userId: stake.userId,
            amount: stake.amount * multiplier,
            matchPoint: options.selectCount,
        }));
    }

    const winnerSet = new Set(winner);
    const stakesByMatch = new Map<number, NationBettingStake[]>();
    const amountByMatch = new Map<number, number>();
    for (let matchPoint = 0; matchPoint <= options.selectCount; matchPoint += 1) {
        stakesByMatch.set(matchPoint, []);
        amountByMatch.set(matchPoint, 0);
    }
    for (const stake of options.stakes) {
        const matchPoint = stake.selection.reduce(
            (count, selected) => count + (winnerSet.has(selected) ? 1 : 0),
            0
        );
        if (stake.generalId === 0) {
            continue;
        }
        stakesByMatch.get(matchPoint)?.push(stake);
        amountByMatch.set(matchPoint, (amountByMatch.get(matchPoint) ?? 0) + stake.amount);
    }

    let remainingReward = totalAmount;
    let accumulatedReward = 0;
    let givenReward = totalAmount;
    const rewardByMatch = new Map<number, number>();
    for (let matchPoint = options.selectCount; matchPoint >= 1; matchPoint -= 1) {
        givenReward /= 2;
        accumulatedReward += givenReward;
        if ((stakesByMatch.get(matchPoint)?.length ?? 0) === 0 || (amountByMatch.get(matchPoint) ?? 0) === 0) {
            continue;
        }
        rewardByMatch.set(matchPoint, accumulatedReward);
        remainingReward -= accumulatedReward;
        accumulatedReward = 0;
    }

    for (let matchPoint = options.selectCount; matchPoint >= 0; matchPoint -= 1) {
        const reward = rewardByMatch.get(matchPoint);
        if (reward === undefined) {
            continue;
        }
        rewardByMatch.set(matchPoint, reward + remainingReward);
        break;
    }

    const result: NationBettingReward[] = [];
    for (let matchPoint = options.selectCount; matchPoint >= 1; matchPoint -= 1) {
        const reward = rewardByMatch.get(matchPoint);
        const staked = amountByMatch.get(matchPoint) ?? 0;
        if (!reward || staked === 0) {
            continue;
        }
        const multiplier = reward / staked;
        for (const stake of stakesByMatch.get(matchPoint) ?? []) {
            result.push({
                generalId: stake.generalId,
                userId: stake.userId,
                amount: stake.amount * multiplier,
                matchPoint,
            });
        }
    }
    return result;
};
