import { describe, expect, it, vi } from 'vitest';

import { ManualClock } from '@sammo-ts/common';
import type { GamePrisma } from '@sammo-ts/infra';
import type { City, MapDefinition, MessagePayload, Nation, ScenarioConfig } from '@sammo-ts/logic';

import { InMemoryControlQueue } from '../src/lifecycle/inMemoryControlQueue.js';
import { TurnDaemonLifecycle } from '../src/lifecycle/turnDaemonLifecycle.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';
import { InMemoryTurnStateStore } from '../src/turn/inMemoryStateStore.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const addMinutes = (time: Date, minutes: number): Date => new Date(time.getTime() + minutes * 60_000);

const liveLastTurnTime = new Date('2026-08-19T21:14:00.000Z');
const liveWallAnchor = new Date('2026-08-20T06:21:58.611Z');
const acceptedAt = addMinutes(liveWallAnchor, 3);

const buildGeneral = (options: {
    id: number;
    name: string;
    userId: string | null;
    officerLevel: number;
    npcState: number;
    turnMinute: number;
}): TurnGeneral => ({
    id: options.id,
    userId: options.userId,
    name: options.name,
    nationId: 6,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 60, intelligence: 50 },
    turnTime: addMinutes(liveLastTurnTime, options.turnMinute),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 240, dex1: 10, dex2: 20, dex3: 30, dex4: 40, dex5: 50 },
    penalty: {},
    officerLevel: options.officerLevel,
    experience: 1_000,
    dedication: 1_000,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: options.npcState,
});

const city = (id: number, level: number): City => ({
    id,
    name: id === 1 ? '업' : '남만',
    nationId: 6,
    level,
    state: 0,
    population: 10_000,
    populationMax: 100_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
});

describe('HWE-shaped unification invader resume', () => {
    it('drains the recipient response while united is halted and resumes the next scheduled month', async () => {
        const recipient = buildGeneral({
            id: 882,
            name: '운영자',
            userId: 'hwe-recipient-882',
            officerLevel: 11,
            npcState: 0,
            turnMinute: 1,
        });
        const generals = [
            buildGeneral({
                id: 41,
                name: 'ⓝ곽가',
                userId: null,
                officerLevel: 12,
                npcState: 2,
                turnMinute: 2,
            }),
            recipient,
            buildGeneral({
                id: 966,
                name: '유여',
                userId: 'hwe-recipient-966',
                officerLevel: 10,
                npcState: 0,
                turnMinute: 3,
            }),
        ];
        const nation: Nation = {
            id: 6,
            name: '㉿곽가',
            color: '#777777',
            capitalCityId: 1,
            chiefGeneralId: 41,
            gold: 1_000,
            rice: 1_000,
            power: 0,
            level: 4,
            typeCode: 'che_유가',
            meta: { tech: 100, war: 1, scout: 1 },
        };
        const scenarioConfig: ScenarioConfig = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        };
        const map: MapDefinition = {
            id: 'test',
            name: 'test',
            cities: [],
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 226,
            currentMonth: 3,
            tickSeconds: 60,
            lastTurnTime: liveLastTurnTime,
            clockBaseTime: new Date('2026-08-19T12:00:00.000Z'),
            clockTick: 19_980_000_000,
            clockMode: 'realtime',
            clockWallAnchor: liveWallAnchor,
            lastTurnTick: 19_944_000_000,
            meta: {
                hiddenSeed: 'hwe-invader-resume-fixture',
                serverId: 'hwe:default_snapshot',
                isUnited: 2,
                isunited: 2,
                refreshLimit: 3_000,
                maxGeneralsPerMinute: 1_000,
            },
        };
        const snapshot: TurnWorldSnapshot = {
            generals,
            cities: [city(1, 3), city(2, 4)],
            nations: [nation],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            scenarioConfig,
            map,
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 1 }] },
        });
        const reservedTurns = new InMemoryReservedTurnStore(
            {
                generalTurn: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
                nationTurn: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
            } as never,
            { maxGeneralTurns: 30, maxNationTurns: 12 }
        );
        const message: MessagePayload = {
            src: { generalId: 0, generalName: '', nationId: 0, nationName: 'System', color: '#000000', icon: '' },
            dest: {
                generalId: recipient.id,
                generalName: recipient.name,
                nationId: nation.id,
                nationName: nation.name,
                color: nation.color,
                icon: '',
            },
            text: '이벤트 게임으로 이민족[쉬움]을 소환',
            option: { action: 'raiseInvader', args: [-1, -1, -0.8, 0], used: false },
        };
        const requestId = 'hwe-invader-resume-message-1014';
        const commandDb = {
            inputEvent: {
                findUnique: vi.fn(async () => ({
                    actorUserId: recipient.userId,
                    target: 'ENGINE',
                    eventType: 'messageRespond',
                    createdAt: acceptedAt,
                })),
            },
            $queryRaw: vi.fn(async () => [
                {
                    id: 1014,
                    mailbox: recipient.id,
                    type: 'private',
                    validUntil: new Date('9999-12-31T00:00:00.000Z'),
                    message,
                },
            ]),
        } as unknown as GamePrisma.TransactionClient;
        const queue = new InMemoryControlQueue();
        queue.enqueue({
            type: 'messageRespond',
            requestId,
            userId: recipient.userId!,
            generalId: recipient.id,
            messageId: 1014,
            response: true,
        });
        const commandHandler = createTurnDaemonCommandHandler({
            world,
            reservedTurns,
            scenarioMeta: {
                title: 'HWE snapshot',
                startYear: 180,
                life: null,
                fiction: null,
                history: [],
                ignoreDefaultEvents: false,
            },
            map,
            loadArchivedNationMaxId: async () => 57,
        });
        const processor = new InMemoryTurnProcessor(world);
        const clock = new ManualClock(acceptedAt.getTime());
        const run = vi.fn(async (...args: Parameters<InMemoryTurnProcessor['run']>) => {
            const result = await processor.run(...args);
            if (world.getState().currentMonth === 4) {
                queue.enqueue({ type: 'shutdown', reason: 'resumed monthly boundary verified' });
            } else {
                clock.advanceMs(2_000);
            }
            return result;
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock,
                controlQueue: queue,
                getNextTickTime: (value) => addMinutes(value, 1),
                stateStore: new InMemoryTurnStateStore(world),
                processor: { run },
                commandHandler,
                hooks: {
                    executeCommand: async (_commandRequestId, execute) => execute({ db: commandDb }),
                },
            },
            {
                profile: 'hwe:default-snapshot',
                defaultBudget: { budgetMs: 5_000, maxGenerals: 200, catchUpCap: 1 },
            }
        );

        await lifecycle.start();

        expect(commandDb.inputEvent.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { requestId } })
        );
        expect(commandDb.$queryRaw).toHaveBeenCalledOnce();
        expect(world.getState()).toMatchObject({
            currentYear: 226,
            currentMonth: 4,
            meta: { isUnited: 1, isunited: 1 },
        });
        expect(world.listNations().filter((entry) => entry.name.startsWith('ⓞ'))).toHaveLength(1);
        expect(world.listGenerals().filter((entry) => entry.npcState === 9)).toHaveLength(10);
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls.map(([targetTime]) => targetTime.toISOString())).toEqual([
            '2026-08-20T06:24:58.611Z',
            '2026-08-20T06:25:00.000Z',
        ]);
        expect(lifecycle.getStatus().lastTurnTime).toBe('2026-08-20T06:25:00.000Z');
    });
});
