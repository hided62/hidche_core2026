import { describe, expect, it } from 'vitest';
import { createEmptyRealtimeReadModelChanges } from '@sammo-ts/common';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';

import {
    applyRealtimeReadModelBaseline,
    createReadModelChangeJournal,
    createRealtimeReadModelBaseline,
    createWorldReadModelSignature,
    mergePersistedVisibleLogChanges,
    summarizeRealtimeReadModelChanges,
} from '../src/turn/databaseHooks.js';
import type { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnWorldChanges } from '../src/turn/inMemoryWorld.js';
import type { ReservedTurnChanges } from '../src/turn/reservedTurnStore.js';

describe('durable read-model change journal mapping', () => {
    it('maps every final engine invalidation to its precise durable domain', () => {
        const changes = {
            ...createEmptyRealtimeReadModelChanges(),
            generalIds: [7],
            cityIds: [3],
            nationIds: [2],
            mapGeneralIds: [8],
            mapCityIds: [4],
            mapNationIds: [5],
            frontStatusGeneralIds: [9],
            frontStatusNationIds: [2],
            frontStatusActorIds: [7],
            lobbyGeneralIds: [7],
            reservedGeneralIds: [7],
            recordGeneralIds: [7],
            worldChanged: true,
            globalRecordsChanged: true,
            worldHistoryChanged: true,
            contactsChanged: true,
            frontStatusChanged: true,
            mapChanged: true,
            lobbyChanged: true,
        };

        expect(createReadModelChangeJournal(changes).snapshot()).toEqual([
            { domain: 'city.content', entityId: 3 },
            { domain: 'contacts.world', entityId: 0 },
            { domain: 'front.general', entityId: 7 },
            { domain: 'front.global', entityId: 0 },
            { domain: 'front.nation', entityId: 2 },
            { domain: 'general.content', entityId: 7 },
            { domain: 'lobby.general', entityId: 7 },
            { domain: 'lobby.world', entityId: 0 },
            { domain: 'map.general', entityId: 8 },
            { domain: 'map.world', entityId: 0 },
            { domain: 'nation.content', entityId: 2 },
            { domain: 'records.general', entityId: 7 },
            { domain: 'records.global', entityId: 0 },
            { domain: 'records.history', entityId: 0 },
            { domain: 'reserved.general', entityId: 7 },
            { domain: 'world.content', entityId: 0 },
        ]);
    });

    it('ignores moving clock and lease metadata but detects month, turn-term, config, and gameplay meta', () => {
        const state = {
            currentYear: 190,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-08-16T00:00:00.000Z'),
            clockBaseTime: new Date('2026-08-16T00:00:00.000Z'),
            clockTick: 1,
            clockMode: 'realtime' as const,
            clockWallAnchor: new Date('2026-08-16T00:00:00.000Z'),
            lastTurnTick: 1,
            meta: {
                lastTurnTime: '2026-08-16T00:00:00.000Z',
                heartbeatAt: '2026-08-16T00:00:00.000Z',
                leaseUntil: '2026-08-16T00:01:00.000Z',
                killturn: 24,
            },
        };
        const config = { const: { feature: 'old' } };
        const world = {
            getState: () => ({ ...state, meta: { ...state.meta } }),
            getScenarioConfig: () => config,
        } as unknown as InMemoryTurnWorld;
        const baseline = createWorldReadModelSignature(world);

        state.lastTurnTime = new Date('2026-08-16T00:05:00.000Z');
        state.clockTick = 2;
        state.lastTurnTick = 2;
        state.meta.lastTurnTime = '2026-08-16T00:05:00.000Z';
        state.meta.heartbeatAt = '2026-08-16T00:00:10.000Z';
        state.meta.leaseUntil = '2026-08-16T00:01:10.000Z';
        expect(createWorldReadModelSignature(world)).toBe(baseline);

        state.currentMonth = 2;
        expect(createWorldReadModelSignature(world)).not.toBe(baseline);
        state.currentMonth = 1;
        state.tickSeconds = 300;
        expect(createWorldReadModelSignature(world)).not.toBe(baseline);
        state.tickSeconds = 600;
        config.const.feature = 'new';
        expect(createWorldReadModelSignature(world)).not.toBe(baseline);
        config.const.feature = 'old';
        state.meta.killturn = 25;
        expect(createWorldReadModelSignature(world)).not.toBe(baseline);
    });
});

describe('summarizeRealtimeReadModelChanges', () => {
    it('classifies the committed log rows even when they bypass in-memory log drafts', () => {
        expect(
            mergePersistedVisibleLogChanges(createEmptyRealtimeReadModelChanges(), [
                {
                    id: 10,
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: 7,
                },
                {
                    id: 11,
                    scope: LogScope.SYSTEM,
                    category: LogCategory.SUMMARY,
                    generalId: null,
                },
                {
                    id: 12,
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    generalId: null,
                },
            ])
        ).toMatchObject({
            recordGeneralIds: [7],
            globalRecordsChanged: true,
            worldHistoryChanged: true,
        });
    });

    it('emits deterministic entity and record invalidations from committed changes', () => {
        const worldChanges = {
            generals: [{ id: 9 }, { id: 7 }],
            createdGenerals: [{ id: 8 }],
            deletedGenerals: [9],
            cities: [{ id: 4 }],
            nations: [{ id: 3 }],
            createdNations: [],
            deletedNations: [],
            deletedNationSnapshots: [],
            lifecycleEvents: [],
            logs: [
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: 7,
                    format: LogFormat.PLAIN,
                    text: 'general',
                },
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.SUMMARY,
                    format: LogFormat.PLAIN,
                    text: 'summary',
                },
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.PLAIN,
                    text: 'history',
                },
            ],
        } as unknown as TurnWorldChanges;
        const reservedChanges: ReservedTurnChanges = {
            generalIds: [9],
            generalInitializationIds: [7],
            generalLeaseIds: [9, 8],
            nationKeys: [],
            nationInitializationKeys: [],
            nationLeaseKeys: [],
        };

        expect(summarizeRealtimeReadModelChanges(worldChanges, reservedChanges)).toEqual({
            generalIds: [7, 8, 9],
            cityIds: [4],
            nationIds: [3],
            mapGeneralIds: [7, 8, 9],
            mapCityIds: [4],
            mapNationIds: [3],
            frontStatusGeneralIds: [7, 8, 9],
            frontStatusNationIds: [3],
            lobbyGeneralIds: [7, 8, 9],
            reservedGeneralIds: [7, 8, 9],
            recordGeneralIds: [7],
            worldChanged: false,
            globalRecordsChanged: true,
            worldHistoryChanged: true,
            contactsChanged: true,
            frontStatusChanged: false,
            lobbyChanged: true,
        });
    });

    it('separates content changes from map and contact projections', () => {
        const baseline = createRealtimeReadModelBaseline({
            listGenerals: () => [
                {
                    id: 7,
                    name: '장수',
                    cityId: 1,
                    nationId: 1,
                    officerLevel: 1,
                    npcState: 0,
                    gold: 100,
                    meta: { permission: 'normal' },
                    penalty: {},
                },
            ],
            listCities: () => [{ id: 1, level: 1, nationId: 1, state: 0, supplyState: 1, population: 100 }],
            listNations: () => [{ id: 1, name: '위', color: '#008000', capitalCityId: 1, gold: 100 }],
        } as unknown as InMemoryTurnWorld);
        const changes = {
            generals: [
                {
                    id: 7,
                    name: '장수',
                    cityId: 1,
                    nationId: 1,
                    officerLevel: 1,
                    npcState: 0,
                    gold: 90,
                    meta: { permission: 'normal' },
                    penalty: {},
                },
            ],
            createdGenerals: [],
            deletedGenerals: [],
            cities: [{ id: 1, level: 1, nationId: 1, state: 0, supplyState: 1, population: 101 }],
            nations: [{ id: 1, name: '위', color: '#008000', capitalCityId: 1, gold: 90 }],
            createdNations: [],
            deletedNations: [],
            deletedNationSnapshots: [],
            lifecycleEvents: [],
            logs: [],
        } as unknown as TurnWorldChanges;

        expect(summarizeRealtimeReadModelChanges(changes, undefined, baseline)).toMatchObject({
            generalIds: [7],
            cityIds: [1],
            nationIds: [1],
            mapGeneralIds: [],
            mapCityIds: [],
            mapNationIds: [],
            frontStatusGeneralIds: [],
            frontStatusNationIds: [],
            lobbyGeneralIds: [],
            contactsChanged: false,
            frontStatusChanged: false,
            lobbyChanged: false,
        });

        applyRealtimeReadModelBaseline(baseline, changes);
        expect(summarizeRealtimeReadModelChanges(changes, undefined, baseline)).toMatchObject({
            generalIds: [],
            cityIds: [],
            nationIds: [],
            mapGeneralIds: [],
            mapCityIds: [],
            mapNationIds: [],
            frontStatusGeneralIds: [],
            frontStatusNationIds: [],
            lobbyGeneralIds: [],
            contactsChanged: false,
            frontStatusChanged: false,
            lobbyChanged: false,
        });
    });

    it('classifies defence, nation policy, and current-city state changes by canonical projection', () => {
        const baseline = createRealtimeReadModelBaseline({
            listGenerals: () => [],
            listCities: () => [
                {
                    id: 3,
                    name: '업',
                    level: 8,
                    nationId: 2,
                    state: 0,
                    supplyState: 1,
                    defence: 1_000,
                    defenceMax: 2_000,
                },
            ],
            listNations: () => [
                {
                    id: 2,
                    name: '위',
                    color: '#008000',
                    capitalCityId: 3,
                    meta: { rate: 20, bill: 100 },
                },
            ],
        } as unknown as InMemoryTurnWorld);
        const emptyChanges = {
            generals: [],
            createdGenerals: [],
            deletedGenerals: [],
            createdNations: [],
            deletedNations: [],
            deletedNationSnapshots: [],
            lifecycleEvents: [],
            logs: [],
        };

        const defenceChanges = {
            ...emptyChanges,
            cities: [
                {
                    id: 3,
                    name: '업',
                    level: 8,
                    nationId: 2,
                    state: 0,
                    supplyState: 1,
                    defence: 900,
                    defenceMax: 2_000,
                },
            ],
            nations: [],
        } as unknown as TurnWorldChanges;
        expect(summarizeRealtimeReadModelChanges(defenceChanges, undefined, baseline)).toMatchObject({
            cityIds: [3],
            mapCityIds: [],
            nationIds: [],
        });

        const policyChanges = {
            ...emptyChanges,
            cities: [],
            nations: [
                {
                    id: 2,
                    name: '위',
                    color: '#008000',
                    capitalCityId: 3,
                    meta: { rate: 25, bill: 120 },
                },
            ],
        } as unknown as TurnWorldChanges;
        expect(summarizeRealtimeReadModelChanges(policyChanges, undefined, baseline)).toMatchObject({
            cityIds: [],
            nationIds: [2],
            mapNationIds: [],
            frontStatusNationIds: [],
        });

        const stateChanges = {
            ...emptyChanges,
            cities: [
                {
                    id: 3,
                    name: '업',
                    level: 8,
                    nationId: 2,
                    state: 5,
                    supplyState: 1,
                    defence: 1_000,
                    defenceMax: 2_000,
                },
            ],
            nations: [],
        } as unknown as TurnWorldChanges;
        expect(summarizeRealtimeReadModelChanges(stateChanges, undefined, baseline)).toMatchObject({
            cityIds: [3],
            mapCityIds: [3],
            nationIds: [],
        });
    });

    it('detects map, contact, and front-status fields independently', () => {
        const baseline = createRealtimeReadModelBaseline({
            listGenerals: () => [
                {
                    id: 7,
                    name: '장수',
                    cityId: 1,
                    nationId: 1,
                    officerLevel: 1,
                    npcState: 0,
                    meta: { permission: 'normal' },
                    penalty: {},
                },
            ],
            listCities: () => [{ id: 1, level: 1, nationId: 1, state: 0, supplyState: 1 }],
            listNations: () => [{ id: 1, name: '위', color: '#008000', capitalCityId: 1, meta: { notice: '이전' } }],
        } as unknown as InMemoryTurnWorld);
        const changes = {
            generals: [
                {
                    id: 7,
                    name: '장수',
                    cityId: 1,
                    nationId: 1,
                    officerLevel: 5,
                    npcState: 0,
                    meta: { permission: 'normal' },
                    penalty: {},
                },
            ],
            createdGenerals: [],
            deletedGenerals: [],
            cities: [{ id: 1, level: 2, nationId: 1, state: 0, supplyState: 1 }],
            nations: [{ id: 1, name: '위', color: '#008000', capitalCityId: 1, meta: { notice: '새 방침' } }],
            createdNations: [],
            deletedNations: [],
            deletedNationSnapshots: [],
            lifecycleEvents: [],
            logs: [],
        } as unknown as TurnWorldChanges;

        expect(summarizeRealtimeReadModelChanges(changes, undefined, baseline)).toMatchObject({
            generalIds: [7],
            cityIds: [1],
            nationIds: [1],
            mapGeneralIds: [],
            mapCityIds: [1],
            mapNationIds: [],
            frontStatusGeneralIds: [],
            frontStatusNationIds: [1],
            lobbyGeneralIds: [],
            contactsChanged: true,
            frontStatusChanged: false,
            lobbyChanged: false,
        });
    });

    it('separates global front-status names from nation-targeted notices', () => {
        const baseline = createRealtimeReadModelBaseline({
            listGenerals: () => [
                {
                    id: 7,
                    name: '장수',
                    cityId: 1,
                    nationId: 1,
                    officerLevel: 1,
                    npcState: 0,
                    meta: {},
                    penalty: {},
                },
            ],
            listCities: () => [],
            listNations: () => [{ id: 1, name: '위', color: '#008000', capitalCityId: 1, meta: { notice: '이전' } }],
        } as unknown as InMemoryTurnWorld);
        const changes = {
            generals: [
                {
                    id: 7,
                    name: '새 장수',
                    cityId: 1,
                    nationId: 1,
                    officerLevel: 1,
                    npcState: 0,
                    meta: {},
                    penalty: {},
                },
            ],
            createdGenerals: [],
            deletedGenerals: [],
            cities: [],
            nations: [{ id: 1, name: '촉', color: '#008000', capitalCityId: 1, meta: { notice: '새 공지' } }],
            createdNations: [],
            deletedNations: [],
            deletedNationSnapshots: [],
            lifecycleEvents: [],
            logs: [],
        } as unknown as TurnWorldChanges;

        expect(summarizeRealtimeReadModelChanges(changes, undefined, baseline)).toMatchObject({
            frontStatusGeneralIds: [7],
            frontStatusNationIds: [1],
            frontStatusChanged: true,
        });
    });
});
