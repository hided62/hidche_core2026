import { asRecord, JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { DIPLOMACY_STATE, LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld, TurnCalendarHandler } from './inMemoryWorld.js';

const MAX_AVAILABLE_WAR_SETTING_COUNT = 10;
const MONTHLY_AVAILABLE_WAR_SETTING_INCREMENT = 2;

const readNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const value = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
};

const calculateNationPower = (
    world: InMemoryTurnWorld,
    nationId: number
): {
    power: number;
    totalCrew: number;
} => {
    const nation = world.getNationById(nationId);
    if (!nation) {
        return { power: 0, totalCrew: 0 };
    }
    const generals = world.listGenerals().filter((general) => general.nationId === nationId);
    const suppliedCities = world.listCities().filter((city) => city.nationId === nationId && city.supplyState === 1);
    const generalResources = generals.reduce((sum, general) => sum + general.gold + general.rice, 0);
    const resourcePower = Math.round((nation.gold + nation.rice + generalResources) / 100);
    const techPower = readNumber(asRecord(nation.meta).tech);

    let cityPower = 0;
    if (nation.level !== 0 && suppliedCities.length > 0) {
        const population = suppliedCities.reduce((sum, city) => sum + city.population, 0);
        const current = suppliedCities.reduce(
            (sum, city) =>
                sum + city.population + city.agriculture + city.commerce + city.security + city.wall + city.defence,
            0
        );
        const maximum = suppliedCities.reduce(
            (sum, city) =>
                sum +
                city.populationMax +
                city.agricultureMax +
                city.commerceMax +
                city.securityMax +
                city.wallMax +
                city.defenceMax,
            0
        );
        cityPower = maximum > 0 ? Math.round((population * current) / maximum / 100) : 0;
    }

    let generalPower = 0;
    let dexterityPower = 0;
    let experiencePower = 0;
    let totalCrew = 0;
    for (const general of generals) {
        const meta = asRecord(general.meta);
        const killCrew = readNumber(meta.rank_killcrew_person);
        const deathCrew = readNumber(meta.rank_deathcrew_person);
        const ratio = (killCrew + 1000) / (deathCrew + 1000);
        const npcMultiplier = general.npcState < 2 ? 1.2 : 1;
        const leadership = general.stats.leadership;
        const leaderCore = leadership >= 40 ? leadership : 0;
        generalPower +=
            ratio * npcMultiplier * leaderCore * 2 +
            (Math.sqrt(general.stats.intelligence * general.stats.strength) * 2 + leadership / 2) / 2;
        dexterityPower +=
            readNumber(meta.dex1) +
            readNumber(meta.dex2) +
            readNumber(meta.dex3) +
            readNumber(meta.dex4) +
            readNumber(meta.dex5);
        experiencePower += general.experience + general.dedication;
        totalCrew += general.crew;
    }

    const power = Math.round(
        (resourcePower +
            techPower +
            cityPower +
            generalPower +
            Math.round(dexterityPower / 1000) +
            Math.round(experiencePower / 100)) /
            10
    );
    return { power, totalCrew };
};

const updateNationPower = (world: InMemoryTurnWorld, rng: RandUtil): void => {
    const citiesByNation = new Map<number, string[]>();
    for (const city of world.listCities().sort((left, right) => left.id - right.id)) {
        const names = citiesByNation.get(city.nationId) ?? [];
        names.push(city.name);
        citiesByNation.set(city.nationId, names);
    }

    for (const nation of world.listNations().sort((left, right) => left.id - right.id)) {
        const calculated = calculateNationPower(world, nation.id);
        const power = Math.round(calculated.power * rng.nextRange(0.95, 1.05));
        const meta = asRecord(nation.meta);
        const previousMax = asRecord(meta.max_power);
        const previousCities = Array.isArray(previousMax.maxCities)
            ? previousMax.maxCities.filter((name): name is string => typeof name === 'string')
            : [];
        const currentCities = citiesByNation.get(nation.id) ?? [];
        const maxPower = {
            ...previousMax,
            maxPower: Math.max(readNumber(previousMax.maxPower), power),
            maxCrew: Math.max(readNumber(previousMax.maxCrew), Math.trunc(calculated.totalCrew)),
            maxCities: currentCities.length > previousCities.length ? currentCities : previousCities,
        };
        world.updateNation(nation.id, {
            power,
            meta: {
                ...nation.meta,
                power,
                max_power: maxPower,
            },
        });
    }
};

export const createMonthlyNationStatsHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): TurnCalendarHandler => ({
    onMonthChanged: (context) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(resolveHiddenSeed(world), 'monthly', context.previousYear, context.previousMonth)
            )
        );
        updateNationPower(world, rng);
    },
});

export const createMonthlyDiplomacyHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): TurnCalendarHandler => ({
    onMonthChanged: () => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const cachedGeneralCounts = new Map(
            world.listNations().map((nation) => [nation.id, Math.max(1, Math.floor(readNumber(nation.meta.gennum, 1)))])
        );
        const before = world.listDiplomacy();
        const declarationStarts = before
            .filter(
                (entry) =>
                    entry.state === DIPLOMACY_STATE.DECLARATION &&
                    entry.term <= 1 &&
                    entry.fromNationId < entry.toNationId
            )
            .sort((left, right) => left.fromNationId - right.fromNationId || left.toNationId - right.toNationId);
        world.advanceDiplomacyMonth(cachedGeneralCounts);
        const afterByKey = new Map(
            world.listDiplomacy().map((entry) => [`${entry.fromNationId}:${entry.toNationId}`, entry] as const)
        );

        for (const entry of declarationStarts) {
            const nation1 = world.getNationById(entry.fromNationId);
            const nation2 = world.getNationById(entry.toNationId);
            if (!nation1 || !nation2) {
                throw new Error(
                    `Monthly diplomacy declaration references a missing nation (${entry.fromNationId}, ${entry.toNationId}).`
                );
            }
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: `<R><b>【개전】</b></><D><b>${nation1.name}</b></>${JosaUtil.pick(nation1.name, '와')} <D><b>${nation2.name}</b></>${JosaUtil.pick(nation2.name, '이')} <R>전쟁</>을 시작합니다.`,
                format: LogFormat.YEAR_MONTH,
            });
        }

        const stopWarSeen = new Set<string>();
        const endingCandidates = before
            .filter((entry) => entry.state === DIPLOMACY_STATE.WAR)
            .sort((left, right) => right.fromNationId - left.fromNationId || right.toNationId - left.toNationId);
        for (const entry of endingCandidates) {
            const low = Math.min(entry.fromNationId, entry.toNationId);
            const high = Math.max(entry.fromNationId, entry.toNationId);
            const pairKey = `${low}:${high}`;
            if (!stopWarSeen.has(pairKey)) {
                stopWarSeen.add(pairKey);
                continue;
            }
            const after = afterByKey.get(`${entry.fromNationId}:${entry.toNationId}`);
            const opposite = afterByKey.get(`${entry.toNationId}:${entry.fromNationId}`);
            if (
                after?.state !== DIPLOMACY_STATE.TRADE ||
                after.term !== 0 ||
                opposite?.state !== DIPLOMACY_STATE.TRADE ||
                opposite.term !== 0
            ) {
                continue;
            }
            const nation1 = world.getNationById(entry.fromNationId);
            const nation2 = world.getNationById(entry.toNationId);
            if (!nation1 || !nation2) {
                throw new Error(
                    `Monthly diplomacy truce references a missing nation (${entry.fromNationId}, ${entry.toNationId}).`
                );
            }
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: `<R><b>【종전】</b></><D><b>${nation1.name}</b></>${JosaUtil.pick(nation1.name, '와')} <D><b>${nation2.name}</b></>${JosaUtil.pick(nation2.name, '이')} <S>종전</>합니다.`,
                format: LogFormat.YEAR_MONTH,
            });
        }
    },
});

export const createMonthlyWarSettingHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): TurnCalendarHandler => ({
    onMonthChanged: () => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        for (const nation of world.listNations()) {
            const availableCount = Math.min(
                MAX_AVAILABLE_WAR_SETTING_COUNT,
                Math.max(0, Math.floor(readNumber(nation.meta.available_war_setting_cnt))) +
                    MONTHLY_AVAILABLE_WAR_SETTING_INCREMENT
            );
            world.updateNation(nation.id, {
                meta: {
                    ...nation.meta,
                    available_war_setting_cnt: availableCount,
                },
            });
        }
    },
});

export const createMonthlyNationCountHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): TurnCalendarHandler => ({
    onMonthChanged: () => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const counts = new Map<number, number>();
        for (const general of world.listGenerals()) {
            if (general.nationId <= 0 || general.npcState === 5) {
                continue;
            }
            counts.set(general.nationId, (counts.get(general.nationId) ?? 0) + 1);
        }
        for (const nation of world.listNations()) {
            const count = counts.get(nation.id);
            if (count === undefined) {
                continue;
            }
            world.updateNation(nation.id, {
                meta: {
                    ...nation.meta,
                    gennum: count,
                },
            });
        }
    },
});
