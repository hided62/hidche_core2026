import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const registrationKey = 'integration-neutral-auction-180-02';

integration('neutral auction database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const deleteFixtureAuctions = async (): Promise<void> => {
        await db.$executeRaw(
            GamePrisma.sql`
                DELETE FROM auction
                WHERE detail->>'neutralRegistrationKey' = ${registrationKey}
            `
        );
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await deleteFixtureAuctions();
    });

    afterAll(async () => {
        await deleteFixtureAuctions();
        await closeDb?.();
    });

    it('commits the auction with the month state and skips a duplicate registration key', async () => {
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'neutral-auction-integration',
                currentYear: 180,
                currentMonth: 2,
                tickSeconds: 600,
                config: {},
                meta: { killturn: 24, neutralAuctionRegistrationKey: registrationKey },
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 180,
            currentMonth: 2,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:10:00.000Z'),
            meta: { killturn: 24, neutralAuctionRegistrationKey: registrationKey },
        };
        const snapshot: TurnWorldSnapshot = {
            generals: [],
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: {
                id: 'test',
                name: 'test',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            scenarioConfig: {
                stat: {
                    total: 300,
                    min: 10,
                    max: 100,
                    npcTotal: 150,
                    npcMax: 50,
                    npcMin: 10,
                    chiefMin: 70,
                },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const pending = {
            registrationKey,
            type: 'BUY_RICE' as const,
            targetCode: '1150',
            hostGeneralId: 0 as const,
            hostName: '상인' as const,
            detail: {
                title: '쌀 1150 경매',
                hostName: '상인',
                amount: 1150,
                isReverse: false,
                startBidAmount: 920,
                finishBidAmount: 2300,
                neutralRegistrationKey: registrationKey,
            },
            closeAt: new Date('2026-07-25T00:50:00.000Z'),
        };
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            // DB marker는 아직 없도록 되돌려 첫 flush가 실제 생성을 담당하게 한다.
            await db.worldState.update({ where: { id: row.id }, data: { meta: { killturn: 24 } } });
            world.queueNeutralAuction(pending);
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(
                await db.auction.count({
                    where: {
                        hostGeneralId: 0,
                        detail: { path: ['neutralRegistrationKey'], equals: registrationKey },
                    },
                })
            ).toBe(1);

            world.queueNeutralAuction(pending);
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });
            expect(
                await db.auction.count({
                    where: {
                        hostGeneralId: 0,
                        detail: { path: ['neutralRegistrationKey'], equals: registrationKey },
                    },
                })
            ).toBe(1);
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
