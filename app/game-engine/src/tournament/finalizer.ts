import { JosaUtil, asRecord } from '@sammo-ts/common';
import { createGamePostgresConnector } from '@sammo-ts/infra';
import { ActionLogger, LogFormat, type TournamentType } from '@sammo-ts/logic';

import type { TurnDaemonCommand, TurnDaemonCommandResult, TurnDaemonHooks } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';

export interface TournamentRewardFinalizer {
    finalize(command: Extract<TurnDaemonCommand, { type: 'tournamentReward' }>): Promise<TurnDaemonCommandResult>;
    close(): Promise<void>;
}

const resolveTournamentLabel = (type: TournamentType): string => {
    switch (type) {
        case 1:
            return '통솔전';
        case 2:
            return '일기토';
        case 3:
            return '설전';
        case 0:
        default:
            return '전력전';
    }
};

const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const pushLogs = (world: InMemoryTurnWorld, logs: ReturnType<ActionLogger['flush']>): void => {
    if (logs.length === 0) {
        return;
    }
    for (const entry of logs) {
        world.pushLog(entry);
    }
};

const flushWorld = async (world: InMemoryTurnWorld, hooks?: TurnDaemonHooks): Promise<void> => {
    if (!hooks?.flushChanges) {
        return;
    }
    const state = world.getState();
    await hooks.flushChanges({
        lastTurnTime: state.lastTurnTime.toISOString(),
        processedGenerals: 0,
        processedTurns: 0,
        durationMs: 0,
        partial: false,
        checkpoint: world.getCheckpoint(),
    });
};

export const createTournamentRewardFinalizer = async (options: {
    databaseUrl: string;
    world: InMemoryTurnWorld;
    hooks?: TurnDaemonHooks;
}): Promise<TournamentRewardFinalizer> => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    await connector.connect();
    const prisma = connector.prisma;

    const finalize = async (
        command: Extract<TurnDaemonCommand, { type: 'tournamentReward' }>
    ): Promise<TurnDaemonCommandResult> => {
        const { world, hooks } = options;
        const { winnerId, runnerUpId } = command;
        const rewardMap = new Map<
            number,
            { gold: number; exp: number; label: string; inheritPoint: number }
        >();

        const applyTier = (
            ids: number[],
            tier: { gold: number; exp: number; label: string; inheritPoint: number }
        ): void => {
            for (const id of new Set(ids)) {
                const current = rewardMap.get(id) ?? { gold: 0, exp: 0, label: tier.label, inheritPoint: 0 };
                rewardMap.set(id, {
                    gold: current.gold + tier.gold,
                    exp: current.exp + tier.exp,
                    label: tier.label,
                    inheritPoint: tier.inheritPoint > 0 ? tier.inheritPoint : current.inheritPoint,
                });
            }
        };

        const constValues = asRecord(world.getScenarioConfig().const ?? {});
        const develCost = resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0);

        applyTier(command.top16, { gold: develCost, exp: 25, label: '16강 진출', inheritPoint: 10 });
        applyTier(command.top8, { gold: develCost * 2, exp: 50, label: '8강 진출', inheritPoint: 0 });
        applyTier(command.top4, { gold: develCost * 3, exp: 50, label: '4강 진출', inheritPoint: 10 });
        applyTier([runnerUpId], { gold: develCost * 6, exp: 100, label: '준우승', inheritPoint: 50 });
        applyTier([winnerId], { gold: develCost * 8, exp: 200, label: '우승', inheritPoint: 100 });

        if (rewardMap.size === 0) {
            return {
                type: 'tournamentReward',
                ok: false,
                winnerId,
                runnerUpId,
                reason: '보상 대상이 없습니다.',
            };
        }

        const nameMap = new Map<number, string>();
        const generals = await prisma.general.findMany({
            where: { id: { in: Array.from(rewardMap.keys()) } },
            select: { id: true, userId: true, name: true },
        });
        const userMap = new Map<number, string>();
        for (const general of generals) {
            nameMap.set(general.id, general.name);
            if (general.userId) {
                userMap.set(general.id, general.userId);
            }
        }

        const tournamentLabel = resolveTournamentLabel(command.tournamentType as TournamentType);
        const logs: ReturnType<ActionLogger['flush']> = [];
        let rewarded = 0;
        let missing = 0;
        let totalGold = 0;
        let totalExp = 0;

        for (const [generalId, reward] of rewardMap) {
            const general = world.getGeneralById(generalId);
            if (!general) {
                missing += 1;
                continue;
            }
            world.updateGeneral(generalId, {
                gold: general.gold + reward.gold,
                experience: general.experience + reward.exp,
            });
            totalGold += reward.gold;
            totalExp += reward.exp;
            rewarded += 1;

            const rewardText = reward.gold.toLocaleString('ko-KR');
            const logger = new ActionLogger({ generalId, nationId: general.nationId });
            logger.pushGeneralActionLog(
                `<C>${tournamentLabel}</> 대회의 ${reward.label}로 <C>${rewardText}</>의 <S>상금</>, 약간의 <S>명성</> 획득!`,
                LogFormat.PLAIN
            );
            logs.push(...logger.flush());
        }

        const winnerName = nameMap.get(winnerId);
        const runnerUpName = nameMap.get(runnerUpId);
        const winnerReward = rewardMap.get(winnerId)?.gold ?? 0;
        const runnerUpReward = rewardMap.get(runnerUpId)?.gold ?? 0;
        if (winnerName) {
            const winnerLogger = new ActionLogger({ generalId: winnerId });
            winnerLogger.pushGeneralHistoryLog(`<C>${tournamentLabel}</> 대회에서 우승`);
            logs.push(...winnerLogger.flush());
        }
        if (runnerUpName) {
            const runnerLogger = new ActionLogger({ generalId: runnerUpId });
            runnerLogger.pushGeneralHistoryLog(`<C>${tournamentLabel}</> 대회에서 준우승`);
            logs.push(...runnerLogger.flush());
        }
        if (winnerName && runnerUpName) {
            const globalLogger = new ActionLogger();
            const josaWinner = JosaUtil.pick(winnerName, '이');
            const josaRunner = JosaUtil.pick(runnerUpName, '이');
            const winnerRewardText = winnerReward.toLocaleString('ko-KR');
            const runnerRewardText = runnerUpReward.toLocaleString('ko-KR');
            globalLogger.pushGlobalHistoryLog(
                `<B><b>【대회】</b></><C>${tournamentLabel}</> 대회에서 <Y>${winnerName}</>${josaWinner} <C>우승</>, <Y>${runnerUpName}</>${josaRunner} <C>준우승</>을 차지하여 천하에 이름을 떨칩니다!`,
                LogFormat.YEAR_MONTH
            );
            globalLogger.pushGlobalHistoryLog(
                `<B><b>【대회】</b></><C>${tournamentLabel}</> 대회의 <S>우승자</>에게는 <C>${winnerRewardText}</>, <S>준우승자</>에겐 <C>${runnerRewardText}</>의 <S>상금</>과 약간의 <S>명성</>이 주어집니다!`,
                LogFormat.YEAR_MONTH
            );
            logs.push(...globalLogger.flush());
        }

        pushLogs(world, logs);

        const pointUpdates = Array.from(rewardMap.entries())
            .filter(([, reward]) => reward.inheritPoint > 0)
            .map(([generalId, reward]) => ({
                generalId,
                userId: userMap.get(generalId),
                value: reward.inheritPoint,
            }))
            .filter((entry) => !!entry.userId);

        for (const entry of pointUpdates) {
            await prisma.inheritancePoint.upsert({
                where: {
                    userId_key: { userId: entry.userId!, key: 'tournament' },
                },
                update: { value: { increment: entry.value } },
                create: { userId: entry.userId!, key: 'tournament', value: entry.value },
            });
        }

        await flushWorld(world, hooks);

        return {
            type: 'tournamentReward',
            ok: true,
            winnerId,
            runnerUpId,
            rewarded,
            missing,
            totalGold,
            totalExp,
        };
    };

    return {
        finalize,
        close: async () => {
            await connector.disconnect();
        },
    };
};