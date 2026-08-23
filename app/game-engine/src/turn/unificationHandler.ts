import { asNumber, asRecord, JosaUtil } from '@sammo-ts/common';
import { LogCategory, LogFormat, LogScope, type LogEntryDraft } from '@sammo-ts/logic';

import type { InMemoryTurnWorld, TurnCalendarContext, TurnCalendarHandler } from './inMemoryWorld.js';
import type { PendingUnificationAuctionCancellation } from './types.js';
import { queueYearbookSnapshot, updateDynastyStatistics } from './yearbookHandler.js';

const UNIFIER_POINT = 2000;
const INVADER_MESSAGE_OPTIONS = [
    { args: [-2, -1.2, 15_000, -1], difficulty: '어려움' },
    { args: [-2, -1.2, -1, -0.5], difficulty: '보통' },
    { args: [-1, -1, -0.8, 0], difficulty: '쉬움' },
] as const;

const buildUnificationLog = (nationName: string): LogEntryDraft => ({
    scope: LogScope.SYSTEM,
    category: LogCategory.HISTORY,
    format: LogFormat.YEAR_MONTH,
    text: `<C>●</><Y><b>【통일】</b></><D><b>${nationName}</b></>${JosaUtil.pick(nationName, '이')} 전토를 통일하였습니다.`,
    meta: {},
});

const buildNationHistoryLog = (nationId: number, nationName: string): LogEntryDraft => ({
    scope: LogScope.NATION,
    category: LogCategory.HISTORY,
    format: LogFormat.YEAR_MONTH,
    nationId,
    text: `<D><b>${nationName}</b></>${JosaUtil.pick(nationName, '이')} 전토를 통일`,
    meta: {},
});

const buildGeneralActionLog = (generalId: number, nationId: number, nationName: string): LogEntryDraft => ({
    scope: LogScope.GENERAL,
    category: LogCategory.ACTION,
    format: LogFormat.YEAR_MONTH,
    generalId,
    nationId,
    text: `<D><b>${nationName}</b></>${JosaUtil.pick(nationName, '이')} 전토를 통일하였습니다.`,
    meta: {},
});

const resolveServerId = (world: InMemoryTurnWorld, fallback: string): string => {
    const serverId = world.getState().meta.serverId;
    return typeof serverId === 'string' && serverId.trim() ? serverId.trim() : fallback;
};

export const createUnificationHandler = (options: {
    profileName: string;
    getWorld: () => InMemoryTurnWorld | null;
    loadPendingUniqueAuctions?: () => Promise<PendingUnificationAuctionCancellation[]>;
    dispatchUnitedEvents: (context: TurnCalendarContext) => Promise<void>;
}): { handler: TurnCalendarHandler } => ({
    handler: {
        onMonthChanged: async (context) => {
            const world = options.getWorld();
            if (!world) return;

            const state = world.getState();
            const meta = asRecord(state.meta);
            if (asNumber(meta.isunited ?? meta.isUnited, 0) !== 0) return;

            const activeNations = world.listNations().filter((nation) => nation.level > 0);
            if (activeNations.length !== 1) return;

            const winner = activeNations[0]!;
            const cities = world.listCities();
            if (cities.length === 0 || cities.some((city) => city.nationId !== winner.id)) return;

            const serverId = resolveServerId(world, options.profileName);
            updateDynastyStatistics(world);
            world.pushLog(buildNationHistoryLog(winner.id, winner.name));

            const auctionCancellations = (await options.loadPendingUniqueAuctions?.()) ?? [];
            for (const cancellation of auctionCancellations) {
                if (cancellation.highestBidId === null) continue;
                const bidderId = cancellation.bidderGeneralId;
                const amount = cancellation.amount;
                if (bidderId === null || amount === null || amount <= 0) {
                    throw new Error(`Unification auction ${cancellation.auctionId} has an invalid refund plan.`);
                }
                const bidder = world.getGeneralById(bidderId);
                if (!bidder?.userId) {
                    throw new Error(`Unification auction ${cancellation.auctionId} bidder is unavailable.`);
                }
                const spentDynamic = asNumber(bidder.meta.inherit_spent_dyn, 0);
                if (cancellation.rankTrackedAmount > spentDynamic) {
                    throw new Error(`Unification auction ${cancellation.auctionId} rank refund exceeds tracked spend.`);
                }
                world.updateGeneral(bidder.id, {
                    inheritancePoints: {
                        ...bidder.inheritancePoints,
                        previous: asNumber(bidder.inheritancePoints?.previous, 0) + amount,
                    },
                    meta: {
                        ...bidder.meta,
                        inherit_spent_dyn: spentDynamic - cancellation.rankTrackedAmount,
                    },
                });
            }

            for (const general of world
                .listGenerals()
                .filter(
                    (entry) =>
                        entry.userId && entry.npcState < 2 && entry.nationId === winner.id && entry.officerLevel > 4
                )) {
                world.updateGeneral(general.id, {
                    inheritancePoints: {
                        ...general.inheritancePoints,
                        unifier: asNumber(general.inheritancePoints?.unifier, 0) + UNIFIER_POINT,
                    },
                });
            }

            await options.dispatchUnitedEvents(context);

            world.updateWorldMeta({
                isUnited: 2,
                isunited: 2,
                refreshLimit: asNumber(meta.refreshLimit, 0) * 100,
            });
            for (const general of world.listGenerals().filter((entry) => entry.nationId === winner.id)) {
                world.pushLog(buildGeneralActionLog(general.id, winner.id, winner.name));
            }
            world.pushLog(buildUnificationLog(winner.name));

            if (cities.some((city) => city.level === 4)) {
                const eligibleGenerals = world
                    .listGenerals()
                    .filter(
                        (general) => Boolean(general.userId) && general.nationId === winner.id && general.npcState < 2
                    )
                    .sort((left, right) => left.id - right.id);
                const recipients: (typeof eligibleGenerals)[number][] = [];
                for (let officerLevel = 12; officerLevel >= 5 && recipients.length < 2; officerLevel -= 1) {
                    const recipient = eligibleGenerals.find((general) => general.officerLevel === officerLevel);
                    if (recipient) recipients.push(recipient);
                }
                for (const recipient of recipients) {
                    for (const invader of INVADER_MESSAGE_OPTIONS) {
                        world.queueMessage({
                            msgType: 'private',
                            src: {
                                generalId: 0,
                                generalName: '',
                                nationId: 0,
                                nationName: 'System',
                                color: '#000000',
                                icon: '',
                            },
                            dest: {
                                generalId: recipient.id,
                                generalName: recipient.name,
                                nationId: winner.id,
                                nationName: winner.name,
                                color: winner.color,
                                icon: recipient.picture ?? '',
                            },
                            text: `이벤트 게임으로 이민족[${invader.difficulty}]을 소환`,
                            time: context.turnTime,
                            validUntil: new Date('9999-12-31T00:00:00.000Z'),
                            option: { action: 'raiseInvader', args: [...invader.args], used: false },
                        });
                    }
                }
            }

            queueYearbookSnapshot(world, options.profileName, context.currentYear, context.currentMonth);
            world.queueUnificationFinalization({
                generationKey: `unification:${serverId}`,
                serverId,
                profileName: options.profileName,
                winnerNationId: winner.id,
                year: context.currentYear,
                month: context.currentMonth,
                completedAt: new Date(state.lastTurnTime.getTime()),
                auctionCancellations,
            });
        },
    },
});
