import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { readCoreDatabaseSnapshot } from '../src/turn-differential/databaseSnapshot.js';
import { captureCoreDatabaseTurnTrace } from '../src/turn-differential/trace.js';

const databaseUrl = process.env.TURN_DIFFERENTIAL_DATABASE_URL ?? process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const ids = {
    general: 2_147_000_101,
    city: 2_147_000_102,
    nation: 2_147_000_103,
};
const ownerIdentity = 'turn-differential-database-owner';

integration('core2026 turn state database snapshot adapter', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    let createdWorldId: number | null = null;
    let createdMessageId: number | null = null;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();

        const world = await db.worldState.findFirst({ orderBy: { id: 'asc' } });
        if (!world) {
            createdWorldId = (
                await db.worldState.create({
                    data: {
                        scenarioCode: 'turn-differential-adapter',
                        currentYear: 183,
                        currentMonth: 1,
                        tickSeconds: 600,
                        config: {},
                        meta: { lastTurnTime: '0183-01-01T00:00:00.000Z', isUnited: 0 },
                    },
                })
            ).id;
        }
        await db.nation.create({
            data: {
                id: ids.nation,
                name: '비교국',
                color: '#123456',
                capitalCityId: ids.city,
                gold: 100,
                rice: 200,
                tech: 10,
                level: 1,
                typeCode: 'che_중립',
                meta: { gennum: 1, power: 300, war: 0 },
            },
        });
        await db.city.create({
            data: {
                id: ids.city,
                name: '비교도시',
                level: 5,
                nationId: ids.nation,
                population: 10_000,
                populationMax: 20_000,
                agriculture: 1_000,
                agricultureMax: 2_000,
                commerce: 1_000,
                commerceMax: 2_000,
                security: 1_000,
                securityMax: 2_000,
                trust: 80,
                trade: 100,
                defence: 500,
                defenceMax: 1_000,
                wall: 500,
                wallMax: 1_000,
                region: 1,
                meta: { state: 0, term: 0 },
            },
        });
        await db.general.create({
            data: {
                id: ids.general,
                userId: ownerIdentity,
                name: '비교장수',
                nationId: ids.nation,
                cityId: ids.city,
                leadership: 70,
                strength: 60,
                intel: 80,
                gold: 1_000,
                rice: 1_000,
                crew: 500,
                crewTypeId: 1100,
                train: 90,
                atmos: 90,
                turnTime: new Date('0183-01-01T00:00:00.000Z'),
                lastTurn: { command: '휴식' },
                meta: { killturn: 24, myset: 6, intel_exp: 3 },
            },
        });
        await db.troop.create({
            data: {
                troopLeaderId: ids.general,
                nationId: ids.nation,
                name: '비교부대',
            },
        });
        createdMessageId = (
            await db.message.create({
                data: {
                    mailbox: ids.general,
                    type: 'private',
                    src: ids.general,
                    dest: ids.general,
                    time: new Date('0183-01-01T00:01:00.000Z'),
                    validUntil: new Date('9999-12-31T00:00:00.000Z'),
                    message: { text: '비교 메시지' },
                },
            })
        ).id;
    });

    afterAll(async () => {
        if (createdMessageId !== null) {
            await db.message.deleteMany({ where: { id: createdMessageId } });
        }
        await db.troop.deleteMany({ where: { troopLeaderId: ids.general } });
        await db.general.deleteMany({ where: { id: ids.general } });
        await db.city.deleteMany({ where: { id: ids.city } });
        await db.nation.deleteMany({ where: { id: ids.nation } });
        if (createdWorldId !== null) {
            await db.worldState.deleteMany({ where: { id: createdWorldId } });
        }
        await disconnect?.();
    });

    it('projects selected PostgreSQL rows into the canonical comparison schema', async () => {
        const result = await readCoreDatabaseSnapshot(databaseUrl!, {
            generalIds: [ids.general],
            cityIds: [ids.city],
            nationIds: [ids.nation],
            troopIds: [ids.general],
            messageAfterId: (createdMessageId ?? 1) - 1,
        });

        expect(result.engine).toBe('core2026');
        expect(result.generals).toContainEqual(
            expect.objectContaining({
                id: ids.general,
                nationId: ids.nation,
                cityId: ids.city,
                intelligence: 80,
                killTurn: 24,
                mySet: 6,
                ownerIdentity,
            })
        );
        expect(result.cities).toContainEqual(
            expect.objectContaining({
                id: ids.city,
                agriculture: 1_000,
                defence: 500,
                state: 0,
                term: 0,
            })
        );
        expect(result.nations).toContainEqual(
            expect.objectContaining({
                id: ids.nation,
                generalCount: 1,
                power: 300,
            })
        );
        expect(result.troops).toContainEqual({ id: ids.general, nationId: ids.nation, name: '비교부대' });
        expect(result.messages).toContainEqual(
            expect.objectContaining({
                id: createdMessageId,
                mailbox: ids.general,
                type: 'private',
                sourceId: ids.general,
                destinationId: ids.general,
                validUntil: 'infinite',
                payload: { text: '비교 메시지' },
            })
        );
    });

    it('captures before/after state around a real database execution boundary', async () => {
        const trace = await captureCoreDatabaseTurnTrace(
            databaseUrl!,
            {
                kind: 'general',
                actorGeneralId: ids.general,
                action: 'che_농지개간',
                args: null,
                observe: {
                    generalIds: [ids.general],
                    cityIds: [ids.city],
                    nationIds: [ids.nation],
                },
            },
            async () => {
                await db.$transaction([
                    db.general.update({
                        where: { id: ids.general },
                        data: { gold: { decrement: 10 } },
                    }),
                    db.city.update({
                        where: { id: ids.city },
                        data: { agriculture: { increment: 42 } },
                    }),
                ]);
                return { outcome: { ok: true } };
            }
        );

        expect(trace.before.generals[0]?.gold).toBe(1_000);
        expect(trace.after.generals[0]?.gold).toBe(990);
        expect(trace.before.cities[0]?.agriculture).toBe(1_000);
        expect(trace.after.cities[0]?.agriculture).toBe(1_042);
        expect(trace.execution).toMatchObject({
            kind: 'general',
            action: 'che_농지개간',
            seedDomain: 'generalCommand',
        });
    });
});
