import { describe, expect, it, vi } from 'vitest';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';

vi.mock('@sammo-ts/infra', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        createGamePostgresConnector: vi.fn(() => ({
            connect: vi.fn(async () => undefined),
            disconnect: vi.fn(async () => undefined),
            prisma: {},
        })),
    };
});

import {
    buildAuctionCancellationMessage,
    buildUniqueAuctionAwardLogs,
    buildUniqueAuctionInheritanceLogData,
    createAuctionFinalizer,
    hasAuctionFinalizeDeadlineArrived,
    isAuctionFinalizeGenerationCurrent,
    isUniqueAuctionSupplyExhausted,
    resolveAuctionResourceAmount,
    resolveUniqueSupplyRetryCloseAt,
} from '../src/auction/finalizer.js';
import { buildInitialUniqueAuctionBidMeta, openAuction } from '../src/auction/opener.js';
import type { TurnGeneral } from '../src/turn/types.js';

describe('unique auction inheritance log compatibility', () => {
    it('keeps the authenticated UUID owner instead of coercing it to a legacy number', () => {
        const userId = '4c2f2f6d-8a37-4f22-a4f9-1a6f5e4c22ec';

        expect(
            buildUniqueAuctionInheritanceLogData({
                userId,
                year: 193,
                month: 7,
                itemName: '논어(+7)',
                amount: 6_000,
            })
        ).toEqual({
            userId,
            year: 193,
            month: 7,
            logType: 'inheritPoint',
            text: '유니크 논어(+7) 경매로 6000 포인트 사용',
        });
    });

    it('tracks the complete opening bid so rollback can restore rank and point escrow', () => {
        expect(buildInitialUniqueAuctionBidMeta('익명의 수배자', 6_000)).toEqual({
            obfuscatedName: '익명의 수배자',
            tryExtendCloseDate: false,
            inheritSpentTrackedAmount: 6_000,
        });
    });

    it('deducts and mirrors the initial unique bid in the same engine transaction', async () => {
        const general = {
            id: 7,
            name: '관우',
            nationId: 1,
            role: { items: { horse: null, weapon: null, book: null, item: null } },
            inheritancePoints: { previous: 7_000 },
            meta: { killturn: 24, inherit_spent_dyn: 0 },
        } as unknown as TurnGeneral;
        const captured: {
            auction: { bids: { create: { meta: unknown } } } | null;
            pointUpdate: { data: unknown } | null;
        } = { auction: null, pointUpdate: null };
        const executedSql: string[] = [];
        const db = {
            auction: {
                findFirst: async () => null,
                create: async ({ data }: { data: Record<string, unknown> }) => {
                    captured.auction = data as unknown as NonNullable<typeof captured.auction>;
                    return { id: 31 };
                },
            },
            inheritancePoint: {
                update: async (args: Record<string, unknown>) => {
                    captured.pointUpdate = args as unknown as NonNullable<typeof captured.pointUpdate>;
                    return args;
                },
            },
            $queryRaw: async (query: { strings: readonly string[] }) => {
                const text = query.strings.join(' ');
                if (text.includes('user_id as "userId"')) return [{ userId: 'owner-uuid' }];
                if (text.includes('FROM inheritance_point')) return [{ value: 7_000 }];
                return [];
            },
            $executeRaw: async (query: { strings: readonly string[] }) => {
                executedSql.push(query.strings.join(' '));
                return 1;
            },
        };
        const world = {
            getGeneralById: (id: number) => (id === general.id ? general : null),
            getScenarioConfig: () => ({
                const: {
                    inheritItemUniqueMinPoint: 5_000,
                    allItems: { weapon: { che_무기_12_칠성검: 1 } },
                },
            }),
            listGenerals: () => [general],
            getState: () => ({
                id: 1,
                currentYear: 193,
                currentMonth: 7,
                tickSeconds: 600,
                meta: { initYear: 190, initMonth: 1, hiddenSeed: 'seed' },
            }),
            getGameNow: () => new Date('0193-07-01T00:00:00.000Z'),
            dateToGameTick: (date: Date) => Math.floor(date.getTime() / 1_000),
            updateGeneral: (_id: number, patch: Partial<TurnGeneral>) => Object.assign(general, patch),
            pushLog: () => {},
        };

        const result = await openAuction(
            {
                type: 'auctionOpen',
                auctionType: 'UNIQUE_ITEM',
                generalId: general.id,
                amount: 6_000,
                itemKey: 'che_무기_12_칠성검',
            },
            world as unknown as Parameters<typeof openAuction>[1],
            db as unknown as NonNullable<Parameters<typeof openAuction>[2]>
        );

        expect(result).toMatchObject({ type: 'auctionOpen', ok: true, auctionId: 31 });
        expect(captured.auction?.bids.create.meta).toEqual(
            expect.objectContaining({ inheritSpentTrackedAmount: 6_000 })
        );
        expect(captured.pointUpdate?.data).toEqual({ value: 1_000 });
        expect(executedSql.some((text) => text.includes('INSERT INTO rank_data'))).toBe(true);
        expect(general.inheritancePoints?.previous).toBe(1_000);
        expect(general.meta.inherit_spent_dyn).toBe(6_000);
    });

    it('recovers a resource amount from the legacy target field when detail is malformed', () => {
        expect(resolveAuctionResourceAmount(undefined, '1200')).toBe(1_200);
        expect(resolveAuctionResourceAmount(900, '1200')).toBe(900);
        expect(resolveAuctionResourceAmount(undefined, 'invalid')).toBeNull();
    });

    it('uses the Ref-inclusive close boundary and the logical tick as the deadline generation', () => {
        const closeAt = new Date('0193-07-01T00:00:00.000Z');
        const auction = { closeAt, closeTick: 72_000_000n };

        expect(hasAuctionFinalizeDeadlineArrived(auction, closeAt, 71_999_999)).toBe(false);
        expect(hasAuctionFinalizeDeadlineArrived(auction, closeAt, 72_000_000)).toBe(true);
        expect(
            isAuctionFinalizeGenerationCurrent(auction, {
                expectedCloseAt: new Date(closeAt.getTime() + 60_000).toISOString(),
                expectedCloseTick: 72_000_000,
            })
        ).toBe(true);
        expect(isAuctionFinalizeGenerationCurrent(auction, { expectedCloseTick: 72_000_001 })).toBe(false);
    });

    it('locks a due OPEN row, owns OPEN to FINALIZING, and settles through the same transaction client', async () => {
        const closeAt = new Date('0193-07-01T00:00:00.000Z');
        const queryTexts: string[] = [];
        const executeTexts: string[] = [];
        const commandDb = {
            $queryRaw: vi.fn(async (query: { strings: readonly string[] }) => {
                const text = query.strings.join(' ');
                queryTexts.push(text);
                if (text.includes('FROM auction_bid')) return [];
                return [
                    {
                        id: 31,
                        type: 'BUY_RICE',
                        targetCode: '100',
                        hostGeneralId: 0,
                        hostName: '(상인)',
                        detail: { amount: 100 },
                        status: 'OPEN',
                        closeAt,
                        closeTick: 72_000_000n,
                    },
                ];
            }),
            $executeRaw: vi.fn(async (query: { strings: readonly string[] }) => {
                executeTexts.push(query.strings.join(' '));
                return 1;
            }),
        };
        const world = {
            getGameNow: () => closeAt,
            dateToGameTick: () => 72_000_000,
            pushLog: vi.fn(),
        };
        const finalizer = await createAuctionFinalizer({
            databaseUrl: 'postgresql://unused',
            world: world as unknown as Parameters<typeof createAuctionFinalizer>[0]['world'],
        });

        await expect(
            finalizer.finalize(
                {
                    type: 'auctionFinalize',
                    auctionId: 31,
                    expectedCloseAt: closeAt.toISOString(),
                    expectedCloseTick: 72_000_000,
                },
                commandDb as unknown as NonNullable<Parameters<typeof finalizer.finalize>[1]>
            )
        ).resolves.toEqual({ type: 'auctionFinalize', ok: true, auctionId: 31 });
        expect(queryTexts[0]).toContain('FOR UPDATE');
        expect(executeTexts[0]).toContain("SET status = 'FINALIZING'");
        expect(executeTexts[1]).toContain('SET status =');
        expect(executeTexts[1]).toContain('finished_at');

        await finalizer.close();
    });

    it('leaves OPEN unchanged when the event generation is stale or the locked deadline is not due', async () => {
        const closeAt = new Date('0193-07-01T00:00:00.000Z');
        const executeRaw = vi.fn(async () => 1);
        const commandDb = {
            $queryRaw: vi.fn(async () => [
                {
                    id: 31,
                    type: 'BUY_RICE',
                    targetCode: '100',
                    hostGeneralId: 0,
                    hostName: '(상인)',
                    detail: { amount: 100 },
                    status: 'OPEN',
                    closeAt,
                    closeTick: 72_000_000n,
                },
            ]),
            $executeRaw: executeRaw,
        };
        let nowTick = 71_999_999;
        const world = {
            getGameNow: () => closeAt,
            dateToGameTick: () => nowTick,
        };
        const finalizer = await createAuctionFinalizer({
            databaseUrl: 'postgresql://unused',
            world: world as unknown as Parameters<typeof createAuctionFinalizer>[0]['world'],
        });
        const db = commandDb as unknown as NonNullable<Parameters<typeof finalizer.finalize>[1]>;

        await expect(
            finalizer.finalize({ type: 'auctionFinalize', auctionId: 31, expectedCloseTick: 72_000_000 }, db)
        ).resolves.toMatchObject({ ok: false, reason: '경매 마감 시각이 아직 지나지 않았습니다.' });
        nowTick = 72_000_000;
        await expect(
            finalizer.finalize({ type: 'auctionFinalize', auctionId: 31, expectedCloseTick: 71_999_999 }, db)
        ).resolves.toMatchObject({ ok: false, reason: '경매 마감 세대가 변경되었습니다.' });
        expect(executeRaw).not.toHaveBeenCalled();

        await finalizer.close();
    });

    it('fails before settlement when the locked OPEN transition is not applied', async () => {
        const closeAt = new Date('0193-07-01T00:00:00.000Z');
        const queryRaw = vi.fn(async (query: { strings: readonly string[] }) => {
            if (query.strings.join(' ').includes('FROM auction_bid')) {
                throw new Error('settlement query must not run');
            }
            return [
                {
                    id: 31,
                    type: 'BUY_RICE',
                    targetCode: '100',
                    hostGeneralId: 0,
                    hostName: '(상인)',
                    detail: { amount: 100 },
                    status: 'OPEN',
                    closeAt,
                    closeTick: null,
                },
            ];
        });
        const commandDb = { $queryRaw: queryRaw, $executeRaw: vi.fn(async () => 0) };
        const world = { getGameNow: () => closeAt, dateToGameTick: () => 72_000_000 };
        const finalizer = await createAuctionFinalizer({
            databaseUrl: 'postgresql://unused',
            world: world as unknown as Parameters<typeof createAuctionFinalizer>[0]['world'],
        });

        await expect(
            finalizer.finalize(
                { type: 'auctionFinalize', auctionId: 31, expectedCloseAt: closeAt.toISOString() },
                commandDb as unknown as NonNullable<Parameters<typeof finalizer.finalize>[1]>
            )
        ).rejects.toThrow('경매 확정 상태 전이에 실패했습니다: 31');
        expect(queryRaw).toHaveBeenCalledTimes(1);

        await finalizer.close();
    });

    it('keeps both escrows and FINALIZING when a resource amount cannot be recovered', async () => {
        const bidder = {
            id: 7,
            name: '관우',
            nationId: 1,
            gold: 1_000,
            rice: 1_000,
        } as TurnGeneral;
        const host = {
            id: 8,
            name: '장비',
            nationId: 1,
            gold: 1_000,
            rice: 1_000,
        } as TurnGeneral;
        const updateGeneral = vi.fn();
        const queueMessage = vi.fn();
        const world = {
            getGameNow: () => new Date('0193-07-01T00:00:00.000Z'),
            getGeneralById: (id: number) => (id === bidder.id ? bidder : id === host.id ? host : null),
            getNationById: () => ({ name: '촉', color: '#ff0000' }),
            updateGeneral,
            queueMessage,
        };
        const executeRaw = vi.fn(async () => 1);
        const commandDb = {
            $queryRaw: vi.fn(async (query: { strings: readonly string[] }) =>
                query.strings.join(' ').includes('FROM auction_bid')
                    ? [{ id: 41, generalId: bidder.id, amount: 500, meta: {} }]
                    : [
                          {
                              id: 31,
                              type: 'BUY_RICE',
                              targetCode: 'invalid',
                              hostGeneralId: host.id,
                              hostName: host.name,
                              detail: { title: '손상된 경매', isReverse: false },
                              status: 'FINALIZING',
                              closeAt: new Date('0193-07-01T00:00:00.000Z'),
                              closeTick: null,
                          },
                      ]
            ),
            $executeRaw: executeRaw,
        };
        const finalizer = await createAuctionFinalizer({
            databaseUrl: 'postgresql://unused',
            world: world as unknown as Parameters<typeof createAuctionFinalizer>[0]['world'],
        });

        await expect(
            finalizer.finalize(
                { type: 'auctionFinalize', auctionId: 31 },
                commandDb as unknown as NonNullable<Parameters<typeof finalizer.finalize>[1]>
            )
        ).resolves.toMatchObject({
            type: 'auctionFinalize',
            ok: false,
            auctionId: 31,
            reason: '경매 거래량 정보가 없습니다.',
        });
        expect(executeRaw).not.toHaveBeenCalled();
        expect(updateGeneral).not.toHaveBeenCalled();
        expect(queueMessage).not.toHaveBeenCalled();
        expect(bidder.gold).toBe(1_000);
        expect(host.rice).toBe(1_000);

        await finalizer.close();
    });

    it('rejects a final award once the configured unique supply is occupied', () => {
        expect(isUniqueAuctionSupplyExhausted(2, 1)).toBe(false);
        expect(isUniqueAuctionSupplyExhausted(2, 2)).toBe(true);
        expect(resolveUniqueSupplyRetryCloseAt(new Date('0193-07-01T00:00:00.000Z'), 10).toISOString()).toBe(
            '0193-07-01T00:10:00.000Z'
        );
    });

    it('builds all four Ref award logs in the original flush order with the original formats and labels', () => {
        const bidder = {
            id: 7,
            name: '관우',
            nationId: 1,
        } as TurnGeneral;

        expect(
            buildUniqueAuctionAwardLogs({
                bidder,
                nationName: '촉',
                itemName: '칠성검(+12)',
                itemRawName: '칠성검',
            })
        ).toEqual([
            expect.objectContaining({
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
                generalId: 7,
                text: '<C>칠성검(+12)</>을 습득',
            }),
            expect.objectContaining({
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
                generalId: 7,
                text: '<C>칠성검(+12)</>을 습득했습니다!',
            }),
            expect.objectContaining({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
                text: '<C><b>【보물수배】</b></><D><b>촉</b></>의 <Y>관우</>가 <C>칠성검(+12)</>을 습득했습니다!',
            }),
            expect.objectContaining({
                scope: LogScope.SYSTEM,
                category: LogCategory.SUMMARY,
                format: LogFormat.MONTH,
                text: '<Y>관우</>가 <C>칠성검(+12)</>을 습득했습니다!',
            }),
        ]);
    });

    it('builds the Ref cancellation refund message for the affected bidder only', () => {
        const bidder = {
            id: 7,
            name: '관우',
            nationId: 1,
            picture: 'generals/7.png',
        } as TurnGeneral;
        const time = new Date('0193-07-01T00:00:00.000Z');

        expect(
            buildAuctionCancellationMessage({
                auctionId: 31,
                title: '논어 경매',
                bidder,
                nation: { name: '촉', color: '#ff0000' },
                time,
            })
        ).toMatchObject({
            msgType: 'private',
            dest: { generalId: 7, nationId: 1, nationName: '촉' },
            text: '31번 논어 경매가 취소되었습니다.',
            sendDestOnly: true,
        });
    });
});
