import { GAME_TICKS_PER_TURN, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import type { TurnCommandEnv } from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler, MonthlyEventEnvironment } from './monthlyEventHandler.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import type { TurnGeneral } from './types.js';

const NPC_TYPE = 5;
const NPC_PREFIX = '㉥';
const MAX_LEADERS_BY_NATION_LEVEL: Readonly<Record<number, number>> = {
    1: 0,
    2: 1,
    3: 3,
    4: 4,
    5: 6,
    6: 7,
    7: 9,
};

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const value = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
};

const createTurnClock = (
    rng: RandUtil,
    environment: MonthlyEventEnvironment,
    world: InMemoryTurnWorld
): { turnTime: Date; turnTick: number } => {
    const tickSeconds = world.getState().tickSeconds;
    const turnMinutes = tickSeconds / 60;
    if (!(turnMinutes > 0) || !Number.isInteger(turnMinutes)) {
        throw new Error('ProvideNPCTroopLeader requires a positive integer turn term.');
    }
    const seconds = rng.nextRangeInt(0, turnMinutes * 60 - 1);
    const fraction = rng.nextRangeInt(0, 999_999);
    const ticksPerSecond = GAME_TICKS_PER_TURN / tickSeconds;
    const turnTick =
        world.dateToGameTick(environment.turnTime) +
        seconds * ticksPerSecond +
        Math.floor((fraction * ticksPerSecond) / 1_000_000);
    return { turnTime: world.gameTickToDate(turnTick), turnTick };
};

export const createProvideNpcTroopLeaderHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    reservedTurns: InMemoryReservedTurnStore;
    env: TurnCommandEnv;
}): MonthlyEventActionHandler => {
    return (_args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const currentLastId = world.getState().meta.lastNPCTroopLeaderID;
        let lastNpcTroopLeaderId =
            typeof currentLastId === 'number' && Number.isFinite(currentLastId) ? Math.trunc(currentLastId) : 0;

        for (const nation of world.listNations().sort((left, right) => left.id - right.id)) {
            const maximum = MAX_LEADERS_BY_NATION_LEVEL[nation.level] ?? 0;
            let current = world
                .listGenerals()
                .filter((general) => general.nationId === nation.id && general.npcState === NPC_TYPE).length;
            if (current >= maximum) {
                continue;
            }
            const rng = new RandUtil(
                new LiteHashDRBG(
                    simpleSerialize(
                        resolveHiddenSeed(world),
                        'troopLeader',
                        environment.year,
                        environment.month,
                        nation.id
                    )
                )
            );
            while (current < maximum) {
                lastNpcTroopLeaderId += 1;
                const allCities = world.listCities().sort((left, right) => left.id - right.id);
                const cityCandidates = allCities.filter((city) => city.nationId === nation.id);
                const cityPool = cityCandidates.length > 0 ? cityCandidates : allCities;
                if (cityPool.length === 0) {
                    throw new Error('ProvideNPCTroopLeader requires at least one city.');
                }
                const city = rng.choice(cityPool);
                const id = world.getNextGeneralId();
                const age = 20;
                const turnClock = createTurnClock(rng, environment, world);
                const general: TurnGeneral = {
                    id,
                    userId: null,
                    name: `${NPC_PREFIX}부대장${String(lastNpcTroopLeaderId).padStart(4, ' ')}`,
                    nationId: nation.id,
                    cityId: city.id,
                    troopId: id,
                    stats: { leadership: 10, strength: 10, intelligence: 10 },
                    experience: age * 100,
                    dedication: age * 100,
                    officerLevel: 1,
                    role: {
                        personality: 'che_은둔',
                        specialDomestic: options.env.defaultSpecialDomestic,
                        specialWar: options.env.defaultSpecialWar,
                        items: { horse: null, weapon: null, book: null, item: null },
                    },
                    injury: 0,
                    gold: 0,
                    rice: 0,
                    crew: 0,
                    crewTypeId: options.env.defaultCrewTypeId,
                    train: 0,
                    atmos: 0,
                    age,
                    npcState: NPC_TYPE,
                    bornYear: environment.year - 20,
                    deadYear: environment.year + 60,
                    affinity: 999,
                    picture: 'default.jpg',
                    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
                    lastTurn: { command: '휴식' },
                    ...turnClock,
                    recentWarTime: null,
                    meta: {
                        killturn: 70,
                        npcType: NPC_TYPE,
                        npc_org: NPC_TYPE,
                        belong: 0,
                        dedlevel: 1,
                        specage: 999,
                        specage2: 999,
                        dex1: 0,
                        dex2: 0,
                        dex3: 0,
                        dex4: 0,
                        dex5: 0,
                    },
                };
                if (!world.addGeneral(general)) {
                    throw new Error(`ProvideNPCTroopLeader generated duplicate general id ${id}.`);
                }
                if (
                    !world.createTroop({
                        id,
                        nationId: nation.id,
                        name: general.name,
                    })
                ) {
                    throw new Error(`ProvideNPCTroopLeader generated duplicate troop id ${id}.`);
                }
                options.reservedTurns.replaceGeneralTurns(id, {
                    action: 'che_집합',
                    args: {},
                });
                current += 1;
                world.updateWorldMeta({ lastNPCTroopLeaderID: lastNpcTroopLeaderId });
            }
        }
    };
};
