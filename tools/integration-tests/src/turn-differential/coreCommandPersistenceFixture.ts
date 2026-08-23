import { buildPersistedRankRows } from '@sammo-ts/game-engine/turn/rankData.js';
import type { GamePrismaClient, InputJsonValue } from '@sammo-ts/infra';

import type { CanonicalTurnSnapshot } from './canonical.js';
import type { buildCoreTurnCommandWorldInput } from './coreCommandTrace.js';

type CoreTurnCommandWorldInput = ReturnType<typeof buildCoreTurnCommandWorldInput>;

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;
const nullableCode = (value: string | null | undefined): string => value ?? 'None';
const turnArgs = (value: unknown): InputJsonValue =>
    asJson(typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {});

const createManyIfPresent = async <Row>(
    rows: Row[],
    createMany: (args: { data: Row[] }) => Promise<unknown>
): Promise<void> => {
    if (rows.length > 0) {
        await createMany({ data: rows });
    }
};

export const clearCoreTurnCommandPersistenceFixture = async (db: GamePrismaClient): Promise<void> => {
    await db.message.deleteMany();
    await db.messageReadState.deleteMany();
    await db.webPushOutbox.deleteMany();
    await db.readModelOutbox.deleteMany();
    await db.readModelRevision.deleteMany();
    await db.logEntry.deleteMany();
    await db.oldNation.deleteMany();
    await db.rankData.deleteMany();
    await db.generalTurn.deleteMany();
    await db.generalTurnRevision.deleteMany();
    await db.nationTurn.deleteMany();
    await db.nationTurnRevision.deleteMany();
    await db.diplomacy.deleteMany();
    await db.general.deleteMany();
    await db.troop.deleteMany();
    await db.city.deleteMany();
    await db.nation.deleteMany();
    await db.worldState.deleteMany();
};

export const seedCoreTurnCommandPersistenceFixture = async (
    db: GamePrismaClient,
    input: {
        worldInput: CoreTurnCommandWorldInput;
        generalTurns: CanonicalTurnSnapshot['generalTurns'];
        nationTurns?: CanonicalTurnSnapshot['nationTurns'];
        scenarioCode: string;
    }
): Promise<void> => {
    const { state, snapshot, map } = input.worldInput;
    await db.worldState.create({
        data: {
            id: state.id,
            scenarioCode: input.scenarioCode,
            currentYear: state.currentYear,
            currentMonth: state.currentMonth,
            tickSeconds: state.tickSeconds,
            config: asJson(snapshot.scenarioConfig),
            meta: asJson({
                ...state.meta,
                ...(snapshot.scenarioMeta ? { scenarioMeta: snapshot.scenarioMeta } : {}),
            }),
        },
    });

    await createManyIfPresent(
        snapshot.nations.map((nation) => ({
            id: nation.id,
            name: nation.name,
            color: nation.color,
            capitalCityId: nation.capitalCityId,
            chiefGeneralId: nation.chiefGeneralId,
            gold: nation.gold,
            rice: nation.rice,
            tech: Number(nation.meta.tech ?? 0),
            level: nation.level,
            typeCode: nation.typeCode,
            meta: asJson(nation.meta),
        })),
        (args) => db.nation.createMany(args)
    );
    await createManyIfPresent(
        snapshot.cities.map((city) => {
            const definition = map.cities.find((entry) => entry.id === city.id);
            return {
                id: city.id,
                name: city.name,
                level: city.level,
                nationId: city.nationId,
                supplyState: city.supplyState,
                frontState: city.frontState,
                population: Math.round(city.population),
                populationMax: city.populationMax,
                agriculture: Math.round(city.agriculture),
                agricultureMax: city.agricultureMax,
                commerce: Math.round(city.commerce),
                commerceMax: city.commerceMax,
                security: Math.round(city.security),
                securityMax: city.securityMax,
                trust: Number(city.meta.trust ?? 0),
                trade: Number(city.meta.trade ?? 100),
                defence: Math.round(city.defence),
                defenceMax: city.defenceMax,
                wall: Math.round(city.wall),
                wallMax: city.wallMax,
                region: definition?.region ?? 0,
                conflict: asJson(city.conflict ?? {}),
                meta: asJson({ ...city.meta, state: city.state }),
            };
        }),
        (args) => db.city.createMany(args)
    );
    await createManyIfPresent(
        snapshot.troops.map((troop) => ({
            troopLeaderId: troop.id,
            nationId: troop.nationId,
            name: troop.name,
        })),
        (args) => db.troop.createMany(args)
    );
    await createManyIfPresent(
        snapshot.generals.map((general) => ({
            id: general.id,
            userId: general.userId,
            name: general.name,
            nationId: general.nationId,
            cityId: general.cityId,
            troopId: general.troopId,
            npcState: general.npcState,
            affinity: general.affinity,
            bornYear: general.bornYear,
            deadYear: general.deadYear,
            picture: general.picture,
            leadership: Math.round(general.stats.leadership),
            strength: Math.round(general.stats.strength),
            intel: Math.round(general.stats.intelligence),
            injury: Math.round(general.injury),
            experience: Math.round(general.experience),
            dedication: Math.round(general.dedication),
            officerLevel: general.officerLevel,
            gold: Math.round(general.gold),
            rice: Math.round(general.rice),
            crew: Math.round(general.crew),
            crewTypeId: general.crewTypeId,
            train: Math.round(general.train),
            atmos: Math.round(general.atmos),
            age: general.age,
            startAge: general.startAge,
            personalCode: nullableCode(general.role.personality),
            specialCode: nullableCode(general.role.specialDomestic),
            special2Code: nullableCode(general.role.specialWar),
            horseCode: nullableCode(general.role.items.horse),
            weaponCode: nullableCode(general.role.items.weapon),
            bookCode: nullableCode(general.role.items.book),
            itemCode: nullableCode(general.role.items.item),
            turnTime: general.turnTime,
            recentWarTime: general.recentWarTime,
            // Preserve the canonical fixture's container exactly. Ref's
            // pre-command last_turn may be an empty object; synthesizing a
            // 휴식 command here changes the graph before the lifecycle runs.
            lastTurn: asJson(general.lastTurn ?? {}),
            meta: asJson(general.meta),
            penalty: asJson(general.penalty ?? {}),
        })),
        (args) => db.general.createMany(args)
    );
    await createManyIfPresent(
        snapshot.generals.flatMap((general) =>
            buildPersistedRankRows(general).map((row) => ({
                generalId: row.generalId,
                nationId: row.nationId,
                type: row.type,
                value: row.value,
            }))
        ),
        (args) => db.rankData.createMany(args)
    );
    await createManyIfPresent(
        snapshot.diplomacy.map((entry) => ({
            srcNationId: entry.fromNationId,
            destNationId: entry.toNationId,
            stateCode: entry.state,
            term: entry.term,
            isDead: entry.dead !== 0,
            meta: asJson(entry.meta),
        })),
        (args) => db.diplomacy.createMany(args)
    );
    await createManyIfPresent(
        input.generalTurns.map((turn) => ({
            generalId: Number(turn.generalId),
            turnIdx: Number(turn.turnIndex),
            actionCode: String(turn.action),
            arg: turnArgs(turn.args),
        })),
        (args) => db.generalTurn.createMany(args)
    );
    await createManyIfPresent(
        (input.nationTurns ?? []).map((turn) => ({
            nationId: Number(turn.nationId),
            officerLevel: Number(turn.officerLevel),
            turnIdx: Number(turn.turnIndex),
            actionCode: String(turn.action),
            arg: turnArgs(turn.args),
        })),
        (args) => db.nationTurn.createMany(args)
    );
};
