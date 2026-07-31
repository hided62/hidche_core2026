import { LiteHashDRBG, RandUtil, asRecord } from '@sammo-ts/common';
import { LogCategory, LogFormat, LogScope, type Nation, type TurnCommandEnv } from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler, MonthlyEventEnvironment } from './monthlyEventHandler.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import type { TurnEvent, TurnGeneral } from './types.js';

const INVADER_NPC_TYPE = 9;
const INVADER_PREFIX = 'ⓞ';
const TURN_TERM_CANDIDATES = [1, 2, 5, 10, 20, 30, 60, 120] as const;

const toInteger = (value: number): number => (Number.isFinite(value) ? Math.trunc(value) : 0);

const readNumber = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const value = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
};

const resolveServerId = (world: InMemoryTurnWorld): string | null => {
    const value = world.getState().meta.serverId;
    return typeof value === 'string' && value !== '' ? value : null;
};

const createTurnTime = (rng: RandUtil, environment: MonthlyEventEnvironment, tickSeconds: number): Date => {
    const turnMinutes = tickSeconds / 60;
    if (!(turnMinutes > 0) || !Number.isInteger(turnMinutes)) {
        throw new Error('RaiseInvader requires a positive integer turn term.');
    }
    const seconds = rng.nextRangeInt(0, turnMinutes * 60 - 1);
    const fraction = rng.nextRangeInt(0, 999_999);
    return new Date(environment.turnTime.getTime() + seconds * 1_000 + Math.floor(fraction / 1_000));
};

const createInvaderGeneral = (options: {
    world: InMemoryTurnWorld;
    reservedTurns: InMemoryReservedTurnStore;
    env: TurnCommandEnv;
    rng: RandUtil;
    environment: MonthlyEventEnvironment;
    rawName: string;
    nationId: number;
    cityId: number;
    stats: { leadership: number; strength: number; intelligence: number };
    experience: number;
    dex: readonly [number, number, number, number, number];
}): TurnGeneral => {
    const age = 20;
    const deadYear = options.environment.year + 20;
    const experience = options.experience || age * 100;
    const id = options.world.getNextGeneralId();
    const general: TurnGeneral = {
        id,
        userId: null,
        name: `${INVADER_PREFIX}${options.rawName}`,
        nationId: options.nationId,
        cityId: options.cityId,
        troopId: 0,
        stats: options.stats,
        experience,
        dedication: age * 100,
        officerLevel: 1,
        role: {
            personality: 'che_패권',
            specialDomestic: 'che_인덕',
            specialWar: 'che_척사',
            items: { horse: null, weapon: null, book: null, item: null },
        },
        injury: 0,
        gold: 99_999,
        rice: 99_999,
        crew: 0,
        crewTypeId: options.env.defaultCrewTypeId,
        train: 0,
        atmos: 0,
        age,
        npcState: INVADER_NPC_TYPE,
        bornYear: options.environment.year - 20,
        deadYear,
        affinity: 999,
        picture: 'default.jpg',
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        lastTurn: { command: '휴식' },
        turnTime: createTurnTime(options.rng, options.environment, options.world.getState().tickSeconds),
        recentWarTime: null,
        meta: {
            killturn:
                (deadYear - options.environment.year) * 12 +
                options.rng.nextRangeInt(0, 11) +
                options.environment.month -
                1,
            npcType: INVADER_NPC_TYPE,
            npc_org: INVADER_NPC_TYPE,
            belong: 0,
            dedlevel: 1,
            dex1: options.dex[0],
            dex2: options.dex[1],
            dex3: options.dex[2],
            dex4: options.dex[3],
            dex5: options.dex[4],
        },
    };
    if (!options.world.addGeneral(general)) {
        throw new Error(`RaiseInvader generated duplicate general id ${id}.`);
    }
    options.reservedTurns.ensureGeneralTurns(id);
    return general;
};

const addMonthlyEvent = (world: InMemoryTurnWorld, action: readonly unknown[]): TurnEvent => {
    const event: TurnEvent = {
        id: world.getNextEventId(),
        targetCode: 'month',
        priority: 1_000,
        condition: true,
        action: [action],
        meta: {},
    };
    if (!world.addEvent(event)) {
        throw new Error(`RaiseInvader generated duplicate event id ${event.id}.`);
    }
    return event;
};

export const createRaiseInvaderHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    reservedTurns: InMemoryReservedTurnStore;
    env: TurnCommandEnv;
    loadArchivedNationMaxId?: (serverId: string) => Promise<number>;
    maxGeneralsPerMinute?: number;
}): MonthlyEventActionHandler => {
    return async (args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const invaderCities = world.listCities().filter((city) => city.level === 4);
        if (invaderCities.length === 0) {
            return;
        }

        const npcEachArgument = readNumber(args[0], -3);
        const specAverageArgument = readNumber(args[1], -1.2);
        const techArgument = readNumber(args[2], -1.2);
        const dexArgument = readNumber(args[3], -1);
        const ordinaryGenerals = world.listGenerals().filter((general) => general.npcState < 4);
        let npcEachCount = npcEachArgument;
        if (npcEachCount < 0) {
            npcEachCount = (ordinaryGenerals.length / invaderCities.length) * -npcEachCount;
        }
        npcEachCount = Math.max(10, toInteger(npcEachCount));

        world.updateWorldMeta({ isunited: 1, isUnited: 1 });
        const totalGeneralCount = npcEachCount * invaderCities.length + world.listGenerals().length;
        const maxGeneralsPerMinute =
            options.maxGeneralsPerMinute ?? readNumber(world.getState().meta.maxGeneralsPerMinute, 1_000);
        const currentTurnMinutes = world.getState().tickSeconds / 60;
        if (totalGeneralCount > maxGeneralsPerMinute * currentTurnMinutes) {
            const nextTerm = TURN_TERM_CANDIDATES.find(
                (candidate) => totalGeneralCount <= maxGeneralsPerMinute * candidate
            );
            if (nextTerm !== undefined) {
                world.changeTurnTerm(nextTerm);
                world.pushLog({
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    text: `<R>★</>턴시간이 <C>${nextTerm}분</>으로 변경됩니다.`,
                });
            }
        }

        let specAverage = specAverageArgument;
        if (specAverage < 0) {
            const sum = ordinaryGenerals.reduce(
                (total, general) =>
                    total + general.stats.leadership + general.stats.strength + general.stats.intelligence,
                0
            );
            specAverage = (ordinaryGenerals.length === 0 ? 0 : sum / ordinaryGenerals.length) * -specAverage;
        }
        specAverage = toInteger(specAverage / 3);

        const activeNations = world.listNations().filter((nation) => nation.level > 0);
        let tech = techArgument;
        if (tech < 0) {
            const averageTech =
                activeNations.length === 0
                    ? 0
                    : activeNations.reduce((sum, nation) => sum + readNumber(nation.meta.tech), 0) /
                      activeNations.length;
            tech = averageTech * -tech;
        }
        // Nation::__construct(int $tech)의 weak scalar coercion을 보존한다.
        tech = toInteger(tech);

        let dex = dexArgument;
        if (dex < 0) {
            const averageDex =
                ordinaryGenerals.length === 0
                    ? 0
                    : ordinaryGenerals.reduce((sum, general) => {
                          const meta = asRecord(general.meta);
                          return (
                              sum +
                              (readNumber(meta.dex1) +
                                  readNumber(meta.dex2) +
                                  readNumber(meta.dex3) +
                                  readNumber(meta.dex4) +
                                  readNumber(meta.dex5)) /
                                  5
                          );
                      }, 0) / ordinaryGenerals.length;
            dex = averageDex * -dex;
        }
        dex = toInteger(dex);

        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(resolveHiddenSeed(world), 'RaiseInvader', environment.year, environment.month)
            )
        );
        const dexShuffleRng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(
                    resolveHiddenSeed(world),
                    'RaiseInvader',
                    environment.year,
                    environment.month,
                    'martialDex'
                )
            )
        );

        for (const nation of world.listNations()) {
            world.updateNation(nation.id, {
                meta: { ...nation.meta, war: 0, scout: 0 },
            });
        }

        const invaderCityIds = new Set(invaderCities.map((city) => city.id));
        const disabledCityIds = new Set<number>();
        for (const nation of world.listNations()) {
            const oldCapitalId = nation.capitalCityId;
            if (oldCapitalId === null || !invaderCityIds.has(oldCapitalId)) {
                continue;
            }
            const candidates = world
                .listCities()
                .filter(
                    (city) => city.nationId === nation.id && city.id !== oldCapitalId && !invaderCityIds.has(city.id)
                );
            if (candidates.length === 0) {
                disabledCityIds.add(oldCapitalId);
                continue;
            }
            const nextCapital = rng.choice(candidates);
            world.updateNation(nation.id, { capitalCityId: nextCapital.id });
            for (const general of world
                .listGenerals()
                .filter((general) => general.nationId === nation.id && general.cityId === oldCapitalId)) {
                world.updateGeneral(general.id, { cityId: nextCapital.id });
            }
        }

        for (const general of world.listGenerals()) {
            const meta = asRecord(general.meta);
            const officerCityId = readNumber(meta.officer_city ?? meta.officerCity);
            if (!invaderCityIds.has(officerCityId)) {
                continue;
            }
            world.updateGeneral(general.id, {
                officerLevel: 1,
                meta: { ...general.meta, officer_city: 0, officerCity: 0 },
            });
        }
        for (const city of invaderCities) {
            world.updateCity(city.id, { nationId: 0, frontState: 0, supplyState: 1 });
        }

        const existingNationIds = world.listNations().map((nation) => nation.id);
        const currentLastNationId = readNumber(world.getState().meta.lastNationId);
        const liveNationMaxId = existingNationIds.reduce((maxId, id) => Math.max(maxId, id), 0);
        let lastNationId = Math.max(currentLastNationId, liveNationMaxId);
        const serverId = resolveServerId(world);
        if (serverId && options.loadArchivedNationMaxId) {
            lastNationId = Math.max(lastNationId, await options.loadArchivedNationMaxId(serverId));
        }
        if (lastNationId !== currentLastNationId) {
            world.updateWorldMeta({ lastNationId });
        }

        const experiencePool = world.listGenerals().filter((general) => general.npcState < 6);
        const averageExperience =
            experiencePool.length === 0
                ? 0
                : experiencePool.reduce((sum, general) => sum + general.experience, 0) / experiencePool.length;
        for (const general of world.listGenerals()) {
            world.updateGeneral(general.id, { gold: 999_999, rice: 999_999 });
        }

        const invaderNationIds: number[] = [];
        for (const city of invaderCities) {
            if (disabledCityIds.has(city.id)) {
                continue;
            }
            const nationId = world.getNextNationId();
            invaderNationIds.push(nationId);
            const nation: Nation = {
                id: nationId,
                name: `${INVADER_PREFIX}${city.name}족`,
                color: '#800080',
                capitalCityId: city.id,
                chiefGeneralId: null,
                gold: 9_999_999,
                rice: 9_999_999,
                power: 0,
                level: 2,
                typeCode: 'che_병가',
                meta: {
                    tech,
                    infoText: '중원의 부패를 물리쳐라! 이민족 침범!',
                    bill: 100,
                    rate: 15,
                    scout: 0,
                    war: 0,
                    strategicCommandLimit: 24,
                    surrenderLimit: 72,
                    can_국기변경: 1,
                },
            };
            if (!world.addNation(nation)) {
                throw new Error(`RaiseInvader generated duplicate nation id ${nationId}.`);
            }
            world.updateCity(city.id, { nationId });

            const ruler = createInvaderGeneral({
                world,
                reservedTurns: options.reservedTurns,
                env: options.env,
                rng,
                environment,
                rawName: `${city.name}대왕`,
                nationId,
                cityId: city.id,
                stats: {
                    leadership: toInteger(specAverage * 1.8),
                    strength: toInteger(specAverage * 1.8),
                    intelligence: toInteger(specAverage * 1.2),
                },
                experience: toInteger(averageExperience * 1.2),
                dex: [0, 0, 0, 0, 0],
            });
            world.updateGeneral(ruler.id, { officerLevel: 12 });

            // ref Util::range(1, $npcEachCount)는 끝 값을 포함하지 않는다.
            for (let index = 1; index < npcEachCount; index += 1) {
                const leadership = rng.nextRangeInt(toInteger(specAverage * 1.2), toInteger(specAverage * 1.4));
                const mainStat = rng.nextRangeInt(toInteger(specAverage * 1.2), toInteger(specAverage * 1.4));
                const subStat = specAverage * 3 - leadership - mainStat;
                const isWarrior = rng.nextBit();
                const martialDex = isWarrior ? dexShuffleRng.shuffle([dex * 2, dex, dex]) : [dex, dex, dex];
                createInvaderGeneral({
                    world,
                    reservedTurns: options.reservedTurns,
                    env: options.env,
                    rng,
                    environment,
                    rawName: `${city.name}장수${index}`,
                    nationId,
                    cityId: city.id,
                    stats: isWarrior
                        ? { leadership, strength: mainStat, intelligence: subStat }
                        : { leadership, strength: subStat, intelligence: mainStat },
                    experience: toInteger(averageExperience),
                    dex: isWarrior
                        ? [martialDex[0]!, martialDex[1]!, martialDex[2]!, dex, 0]
                        : [dex, dex, dex, dex * 2, 0],
                });
            }
            world.updateNation(nationId, {
                chiefGeneralId: ruler.id,
                meta: { ...nation.meta, gennum: npcEachCount },
            });
            for (const officerLevel of [12, 11, 10, 9]) {
                options.reservedTurns.ensureNationTurns(nationId, officerLevel);
            }
            addMonthlyEvent(world, ['AutoDeleteInvader', nationId]);
        }
        addMonthlyEvent(world, ['InvaderEnding']);

        for (const existingNationId of existingNationIds) {
            for (const invaderNationId of invaderNationIds) {
                world.applyDiplomacyPatch({
                    srcNationId: existingNationId,
                    destNationId: invaderNationId,
                    patch: { state: 1, term: 24 },
                });
                world.applyDiplomacyPatch({
                    srcNationId: invaderNationId,
                    destNationId: existingNationId,
                    patch: { state: 1, term: 24 },
                });
            }
        }
        for (const fromNationId of invaderNationIds) {
            for (const toNationId of invaderNationIds) {
                if (fromNationId === toNationId) {
                    continue;
                }
                world.applyDiplomacyPatch({
                    srcNationId: fromNationId,
                    destNationId: toNationId,
                    patch: { state: 7, term: 480 },
                });
            }
        }

        const cityPopulationMax = specAverage * npcEachCount * 100 * 4;
        for (const city of world.listCities()) {
            const isInvaderCity = invaderNationIds.includes(city.nationId);
            world.updateCity(city.id, {
                populationMax: isInvaderCity ? cityPopulationMax : city.populationMax,
                defenceMax: isInvaderCity ? 100_000 : city.defenceMax,
                wallMax: isInvaderCity ? 10_000 : city.wallMax,
                population: isInvaderCity ? cityPopulationMax : city.populationMax,
                agriculture: city.agricultureMax,
                commerce: city.commerceMax,
                security: city.securityMax,
            });
        }

        for (const text of [
            '<L><b>【이벤트】</b></>각지의 이민족들이 <M>궐기</>합니다!',
            '<L><b>【이벤트】</b></>중원의 전 국가에 <M>선전포고</> 합니다!',
            '<L><b>【이벤트】</b></>이민족의 기세는 그 누구도 막을 수 없을듯 합니다!',
        ]) {
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text,
                format: LogFormat.YEAR_MONTH,
                year: environment.year,
                month: environment.month,
            });
        }
        world.updateWorldMeta({ block_change_scout: false });
    };
};

export const createAutoDeleteInvaderHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    reservedTurns: InMemoryReservedTurnStore;
}): MonthlyEventActionHandler => {
    return (args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const nationId = readNumber(args[0], -1);
        const nation = world.getNationById(nationId);
        if (!nation) {
            world.removeEvent(environment.currentEventID);
            return;
        }
        const onWar = world
            .listDiplomacy()
            .some((entry) => entry.fromNationId === nationId && (entry.state === 0 || entry.state === 1));
        if (onWar) {
            return;
        }
        const ruler = world
            .listGenerals()
            .find((general) => general.nationId === nationId && general.officerLevel === 12);
        if (ruler) {
            options.reservedTurns.replaceGeneralTurns(ruler.id, {
                action: 'che_방랑',
                args: {},
            });
        }
        world.removeEvent(environment.currentEventID);
    };
};

export const createInvaderEndingHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (_args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const meta = world.getState().meta;
        const isUnited = readNumber(meta.isunited ?? meta.isUnited);
        if (isUnited === 0 || isUnited === 2) {
            return;
        }
        const nations = world.listNations();
        if (nations.length >= 2) {
            return;
        }
        const neutralCityCount = world.listCities().filter((city) => city.nationId === 0).length;
        let userWin = false;
        if (neutralCityCount === 0) {
            userWin = nations.length === 1 && !nations[0]!.name.startsWith(INVADER_PREFIX);
        } else if (neutralCityCount !== world.listCities().length) {
            return;
        }
        const texts = userWin
            ? [
                  '<L><b>【이벤트】</b></>이민족을 모두 소탕했습니다!',
                  '<L><b>【이벤트】</b></>중원은 당분간 태평성대를 누릴 것입니다.',
              ]
            : [
                  '<L><b>【이벤트】</b></>중원은 이민족에 의해 혼란에 빠졌습니다.',
                  '<L><b>【이벤트】</b></>백성은 언젠가 영웅이 나타나길 기다립니다.',
              ];
        for (const text of texts) {
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text,
                format: LogFormat.YEAR_MONTH,
                year: environment.year,
                month: environment.month,
            });
        }
        world.updateWorldMeta({
            isunited: 3,
            isUnited: 3,
            refreshLimit: readNumber(meta.refreshLimit) * 100,
        });
        world.removeEvent(environment.currentEventID);
    };
};
