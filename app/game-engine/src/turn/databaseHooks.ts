import {
    createGamePostgresConnector,
    type InputJsonValue,
    type TurnEngineCityUpdateInput,
    type TurnEngineDiplomacyCreateManyInput,
    type TurnEngineDiplomacyUpdateInput,
    type TurnEngineGeneralCreateManyInput,
    type TurnEngineGeneralUpdateInput,
    type TurnEngineLogEntryCreateManyInput,
    type TurnEngineNationUpdateInput,
    type TurnEngineTroopCreateManyInput,
    type TurnEngineTroopUpdateInput,
    type TurnEngineWorldStateUpdateInput,
} from '@sammo-ts/infra';
import { finalizeLogEntry, type LogEntryDraft } from '@sammo-ts/logic';

import type { TurnDaemonHooks } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import { buildDiplomacyMeta } from '@sammo-ts/logic';

export interface DatabaseTurnHooks {
    hooks: TurnDaemonHooks;
    close(): Promise<void>;
}

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

const toCode = (value: string | null | undefined): string => (value && value !== 'None' ? value : 'None');

const readMetaNumber = (meta: Record<string, unknown>, key: string): number | null => {
    const value = meta[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const buildGeneralUpdate = (
    general: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['generals'][number]
): TurnEngineGeneralUpdateInput => ({
    name: general.name,
    nationId: general.nationId,
    cityId: general.cityId,
    troopId: general.troopId,
    leadership: general.stats.leadership,
    strength: general.stats.strength,
    intel: general.stats.intelligence,
    experience: general.experience,
    dedication: general.dedication,
    officerLevel: general.officerLevel,
    injury: general.injury,
    gold: general.gold,
    rice: general.rice,
    crew: general.crew,
    crewTypeId: general.crewTypeId,
    train: general.train,
    atmos: general.atmos,
    age: general.age,
    npcState: general.npcState,
    horseCode: toCode(general.role.items.horse),
    weaponCode: toCode(general.role.items.weapon),
    bookCode: toCode(general.role.items.book),
    itemCode: toCode(general.role.items.item),
    personalCode: toCode(general.role.personality),
    specialCode: toCode(general.role.specialDomestic),
    special2Code: toCode(general.role.specialWar),
    meta: asJson(general.meta),
    turnTime: general.turnTime,
    recentWarTime: general.recentWarTime ?? null,
});

const buildGeneralCreate = (
    general: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['generals'][number]
): TurnEngineGeneralCreateManyInput => ({
    id: general.id,
    name: general.name,
    nationId: general.nationId,
    cityId: general.cityId,
    troopId: general.troopId,
    npcState: general.npcState,
    leadership: general.stats.leadership,
    strength: general.stats.strength,
    intel: general.stats.intelligence,
    experience: general.experience,
    dedication: general.dedication,
    officerLevel: general.officerLevel,
    injury: general.injury,
    gold: general.gold,
    rice: general.rice,
    crew: general.crew,
    crewTypeId: general.crewTypeId,
    train: general.train,
    atmos: general.atmos,
    age: general.age,
    horseCode: toCode(general.role.items.horse),
    weaponCode: toCode(general.role.items.weapon),
    bookCode: toCode(general.role.items.book),
    itemCode: toCode(general.role.items.item),
    personalCode: toCode(general.role.personality),
    specialCode: toCode(general.role.specialDomestic),
    special2Code: toCode(general.role.specialWar),
    meta: asJson(general.meta),
    turnTime: general.turnTime,
    recentWarTime: general.recentWarTime ?? null,
});

const buildCityUpdate = (
    city: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['cities'][number]
): TurnEngineCityUpdateInput => {
    const meta = {
        ...(city.meta as Record<string, unknown>),
        state: city.state,
    };
    const trust = readMetaNumber(meta, 'trust');
    const trade = readMetaNumber(meta, 'trade');
    const region = readMetaNumber(meta, 'region');

    const data: TurnEngineCityUpdateInput = {
        name: city.name,
        nationId: city.nationId,
        level: city.level,
        population: city.population,
        populationMax: city.populationMax,
        agriculture: city.agriculture,
        agricultureMax: city.agricultureMax,
        commerce: city.commerce,
        commerceMax: city.commerceMax,
        security: city.security,
        securityMax: city.securityMax,
        supplyState: city.supplyState,
        frontState: city.frontState,
        defence: city.defence,
        defenceMax: city.defenceMax,
        wall: city.wall,
        wallMax: city.wallMax,
        meta: asJson(meta),
    };

    if (trust !== null) {
        data.trust = trust;
    }
    if (trade !== null) {
        data.trade = trade;
    }
    if (region !== null) {
        data.region = region;
    }

    return data;
};

const buildNationUpdate = (
    nation: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['nations'][number]
): TurnEngineNationUpdateInput => ({
    name: nation.name,
    color: nation.color,
    capitalCityId: nation.capitalCityId,
    gold: nation.gold,
    rice: nation.rice,
    level: nation.level,
    typeCode: nation.typeCode,
    meta: asJson(nation.meta),
});

const buildTroopUpdate = (
    troop: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['troops'][number]
): TurnEngineTroopUpdateInput => ({
    nationId: troop.nationId,
    name: troop.name,
});

const buildTroopCreate = (
    troop: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['troops'][number]
): TurnEngineTroopCreateManyInput => ({
    troopLeaderId: troop.id,
    nationId: troop.nationId,
    name: troop.name,
});

const buildDiplomacyCreate = (
    entry: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['diplomacy'][number]
): TurnEngineDiplomacyCreateManyInput => ({
    srcNationId: entry.fromNationId,
    destNationId: entry.toNationId,
    stateCode: entry.state,
    term: entry.term,
    meta: asJson(buildDiplomacyMeta(entry)),
});

const buildDiplomacyUpdate = (
    entry: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['diplomacy'][number]
): TurnEngineDiplomacyUpdateInput => ({
    stateCode: entry.state,
    term: entry.term,
    meta: asJson(buildDiplomacyMeta(entry)),
});

const buildLogCreateData = (
    entry: LogEntryDraft,
    context: { year: number; month: number; at: Date }
): TurnEngineLogEntryCreateManyInput | null => {
    const record = finalizeLogEntry(entry, {
        year: context.year,
        month: context.month,
        at: context.at,
    });
    if (!record) {
        return null;
    }

    return {
        scope: record.scope,
        category: record.category,
        subType: record.subType ?? null,
        year: record.year,
        month: record.month,
        text: record.text,
        generalId: record.generalId ?? null,
        nationId: record.nationId ?? null,
        userId: record.userId ?? null,
        meta: asJson(record.meta ?? {}),
        createdAt: record.createdAt,
    };
};

export const createDatabaseTurnHooks = async (
    databaseUrl: string,
    world: InMemoryTurnWorld,
    options?: { reservedTurns?: InMemoryReservedTurnStore }
): Promise<DatabaseTurnHooks> => {
    // 턴 처리 결과를 DB에 반영하는 훅을 만든다.
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    const prisma = connector.prisma;

    const hooks: TurnDaemonHooks = {
        flushChanges: async () => {
            const state = world.getState();
            const {
                generals,
                cities,
                nations,
                troops,
                deletedTroops,
                deletedGenerals,
                diplomacy,
                logs,
                createdGenerals,
                createdNations,
                createdTroops,
                createdDiplomacy,
            } = world.consumeDirtyState();

            const worldStateUpdate: TurnEngineWorldStateUpdateInput = {
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                tickSeconds: state.tickSeconds,
                meta: asJson(state.meta),
            };
            await prisma.worldState.update({
                where: { id: state.id },
                data: worldStateUpdate,
            });

            const createdIds = new Set(createdGenerals.map((general) => general.id));
            const createdNationIds = new Set(createdNations.map((nation) => nation.id));
            const createdTroopIds = new Set(createdTroops.map((troop) => troop.id));
            const createdDiplomacyKeys = new Set(
                createdDiplomacy.map((entry) => `${entry.fromNationId}:${entry.toNationId}`)
            );

            if (createdGenerals.length > 0) {
                await prisma.general.createMany({
                    data: createdGenerals.map(buildGeneralCreate),
                });
            }
            if (createdNations.length > 0) {
                await prisma.nation.createMany({
                    data: createdNations.map((nation) => ({
                        id: nation.id,
                        name: nation.name,
                        color: nation.color,
                        capitalCityId: nation.capitalCityId,
                        gold: nation.gold,
                        rice: nation.rice,
                        level: nation.level,
                        typeCode: nation.typeCode,
                        meta: asJson(nation.meta),
                    })),
                });
            }
            if (createdTroops.length > 0) {
                await prisma.troop.createMany({
                    data: createdTroops.map(buildTroopCreate),
                });
            }
            if (createdDiplomacy.length > 0) {
                await prisma.diplomacy.createMany({
                    data: createdDiplomacy.map(buildDiplomacyCreate),
                });
            }
            if (deletedTroops.length > 0) {
                await prisma.troop.deleteMany({
                    where: { troopLeaderId: { in: deletedTroops } },
                });
            }

            if (deletedGenerals.length > 0) {
                await prisma.general.deleteMany({
                    where: { id: { in: deletedGenerals } },
                });
            }

            await Promise.all([
                ...generals
                    .filter((general) => !createdIds.has(general.id))
                    .map((general) =>
                        prisma.general.update({
                            where: { id: general.id },
                            data: buildGeneralUpdate(general),
                        })
                    ),
                ...cities.map((city) =>
                    prisma.city.update({
                        where: { id: city.id },
                        data: buildCityUpdate(city),
                    })
                ),
                ...nations
                    .filter((nation) => !createdNationIds.has(nation.id))
                    .map((nation) =>
                        prisma.nation.update({
                            where: { id: nation.id },
                            data: buildNationUpdate(nation),
                        })
                    ),
                ...troops
                    .filter((troop) => !createdTroopIds.has(troop.id))
                    .map((troop) =>
                        prisma.troop.update({
                            where: { troopLeaderId: troop.id },
                            data: buildTroopUpdate(troop),
                        })
                    ),
                ...diplomacy
                    .filter((entry) => !createdDiplomacyKeys.has(`${entry.fromNationId}:${entry.toNationId}`))
                    .map((entry) =>
                        prisma.diplomacy.update({
                            where: {
                                srcNationId_destNationId: {
                                    srcNationId: entry.fromNationId,
                                    destNationId: entry.toNationId,
                                },
                            },
                            data: buildDiplomacyUpdate(entry),
                        })
                    ),
            ]);

            if (logs.length > 0) {
                const logContext = {
                    year: state.currentYear,
                    month: state.currentMonth,
                    at: state.lastTurnTime,
                };
                const payload = logs
                    .map((entry) => buildLogCreateData(entry, logContext))
                    .filter((entry): entry is TurnEngineLogEntryCreateManyInput => Boolean(entry));
                if (payload.length > 0) {
                    await prisma.logEntry.createMany({
                        data: payload,
                    });
                }
            }
            if (options?.reservedTurns) {
                await options.reservedTurns.flushChanges();
            }
        },
    };

    return {
        hooks,
        close: () => connector.disconnect(),
    };
};
