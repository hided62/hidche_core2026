import type { Prisma } from '@prisma/client';

import { createPostgresConnector } from '@sammo-ts/infra';
import { finalizeLogEntry, type LogEntryDraft } from '@sammo-ts/logic';

import type { TurnDaemonHooks } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';

export interface DatabaseTurnHooks {
    hooks: TurnDaemonHooks;
    close(): Promise<void>;
}

const asJson = (value: unknown): Prisma.InputJsonValue =>
    value as Prisma.InputJsonValue;

const toCode = (value: string | null | undefined): string =>
    value && value !== 'None' ? value : 'None';

const buildGeneralUpdate = (
    general: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['generals'][number]
): Prisma.GeneralUpdateInput => ({
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

const buildCityUpdate = (
    city: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['cities'][number]
): Prisma.CityUpdateInput => ({
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
    meta: asJson(city.meta),
});

const buildNationUpdate = (
    nation: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['nations'][number]
): Prisma.NationUpdateInput => ({
    name: nation.name,
    color: nation.color,
    capitalCityId: nation.capitalCityId,
    gold: nation.gold,
    rice: nation.rice,
    level: nation.level,
    typeCode: nation.typeCode,
    meta: asJson(nation.meta),
});

const buildLogCreateData = (
    entry: LogEntryDraft,
    context: { year: number; month: number; at: Date }
): Prisma.LogEntryCreateManyInput | null => {
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
    world: InMemoryTurnWorld
): Promise<DatabaseTurnHooks> => {
    // 턴 처리 결과를 DB에 반영하는 훅을 만든다.
    const connector = createPostgresConnector({ url: databaseUrl });
    await connector.connect();

    const hooks: TurnDaemonHooks = {
        flushChanges: async () => {
            const state = world.getState();
            const { generals, cities, nations, logs } = world.consumeDirtyState();

            await connector.prisma.worldState.update({
                where: { id: state.id },
                data: {
                    currentYear: state.currentYear,
                    currentMonth: state.currentMonth,
                    tickSeconds: state.tickSeconds,
                    meta: asJson(state.meta),
                },
            });

            await Promise.all([
                ...generals.map((general) =>
                    connector.prisma.general.update({
                        where: { id: general.id },
                        data: buildGeneralUpdate(general),
                    })
                ),
                ...cities.map((city) =>
                    connector.prisma.city.update({
                        where: { id: city.id },
                        data: buildCityUpdate(city),
                    })
                ),
                ...nations.map((nation) =>
                    connector.prisma.nation.update({
                        where: { id: nation.id },
                        data: buildNationUpdate(nation),
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
                    .filter(
                        (entry): entry is Prisma.LogEntryCreateManyInput =>
                            Boolean(entry)
                    );
                if (payload.length > 0) {
                    await connector.prisma.logEntry.createMany({
                        data: payload,
                    });
                }
            }
        },
    };

    return {
        hooks,
        close: () => connector.disconnect(),
    };
};
