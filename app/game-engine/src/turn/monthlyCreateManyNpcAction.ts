import { JosaUtil, LiteHashDRBG, RandUtil, asRecord } from '@sammo-ts/common';
import { LogCategory, LogFormat, LogScope, type TurnCommandEnv } from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler, MonthlyEventEnvironment } from './monthlyEventHandler.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import type { TurnGeneral } from './types.js';

const NPC_TYPE = 3;
const NPC_NAME_PREFIX = 'ⓜ';
const LEGACY_GENERAL_NAME_PREFIXES = ['', 'ⓝ', 'ⓝ', 'ⓜ', 'ⓖ', '㉥', 'ⓤ', 'ⓞ'];
const STAT_TYPE_WEIGHTS = { 무: 0.333, 지: 0.333, 무지: 0.334 } as const;

const readLegacyNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
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

const countLegacyNameDuplicates = (generals: readonly TurnGeneral[], baseName: string): number => {
    let count = 0;
    for (const prefix of LEGACY_GENERAL_NAME_PREFIXES) {
        const target = `${prefix}${baseName}`;
        count += generals.filter((general) => general.name.startsWith(target)).length;
    }
    return count;
};

const pickNames = (
    rng: RandUtil,
    count: number,
    existingGenerals: readonly TurnGeneral[],
    env: TurnCommandEnv
): string[] => {
    const firstNames = env.randomGeneralFirstNames ?? ['가'];
    const middleNames = env.randomGeneralMiddleNames ?? [''];
    const lastNames = env.randomGeneralLastNames ?? ['가'];
    const names: string[] = [];

    for (let index = 0; index < count; index += 1) {
        let loopCount = 0;
        while (true) {
            let name = `${rng.choice(firstNames)}${rng.choice(middleNames)}${rng.choice(lastNames)}`;
            const duplicateCount = countLegacyNameDuplicates(existingGenerals, name);
            if (duplicateCount === 0) {
                names.push(name);
                break;
            }
            if (loopCount >= 99 || duplicateCount < 2) {
                name += duplicateCount + 1;
                names.push(name);
                break;
            }
            loopCount += 1;
        }
    }
    return names;
};

const buildStats = (rng: RandUtil, env: TurnCommandEnv): TurnGeneral['stats'] => {
    const totalStat = env.npcStatTotal ?? 150;
    const minStat = env.npcStatMin ?? 10;
    const maxStat = env.npcStatMax ?? 50;
    const pickType = rng.choiceUsingWeight(STAT_TYPE_WEIGHTS);
    let mainStat = maxStat - rng.nextRangeInt(0, minStat);
    let otherStat = minStat + rng.nextRangeInt(0, Math.trunc(minStat / 2));
    let subStat = totalStat - mainStat - otherStat;

    if (subStat < minStat) {
        subStat = otherStat;
        otherStat = minStat;
        mainStat = totalStat - subStat - otherStat;
        // GeneralBuilder::fillRandomStat()의 기존 truthy 검사까지 보존한다.
        if (mainStat !== 0) {
            throw new Error('기본 스탯 설정값이 잘못되어 있음');
        }
    }

    if (pickType === '무') {
        return { leadership: subStat, strength: mainStat, intelligence: otherStat };
    }
    if (pickType === '지') {
        return { leadership: subStat, strength: otherStat, intelligence: mainStat };
    }
    return { leadership: otherStat, strength: subStat, intelligence: mainStat };
};

const buildSpecialityAge = (retirementYear: number, age: number, relativeYear: number, divisor: number): number =>
    Math.max(Math.round((retirementYear - age) / divisor - relativeYear / 2), 3) + age;

const buildNpc = (options: {
    world: InMemoryTurnWorld;
    reservedTurns: InMemoryReservedTurnStore;
    rng: RandUtil;
    environment: MonthlyEventEnvironment;
    env: TurnCommandEnv;
    baseName: string;
}): TurnGeneral => {
    const { world, reservedTurns, rng, environment, env } = options;
    const age = rng.nextRangeInt(20, 25);
    const bornYear = environment.year - age;
    const deadYear = environment.year + rng.nextRangeInt(10, 50);
    const stats = buildStats(rng, env);
    const affinity = rng.nextRangeInt(1, 150);
    const relativeYear = Math.max(environment.year - environment.startyear, 0);
    const configValues = asRecord(world.getScenarioConfig().const);
    const retirementYear = readLegacyNumber(configValues.retirementYear, 80);
    const specAge = buildSpecialityAge(retirementYear, age, relativeYear, 12);
    const specAge2 = buildSpecialityAge(retirementYear, age, relativeYear, 6);
    const personality = rng.choice(env.availablePersonalities ?? ['che_안전']);
    const cities = world.listCities();
    if (cities.length === 0) {
        throw new Error('CreateManyNPC requires at least one city.');
    }
    const city = rng.choice(cities);
    const turnMinutes = world.getState().tickSeconds / 60;
    if (!(turnMinutes > 0)) {
        throw new Error('CreateManyNPC requires a positive turn term.');
    }
    const turnSecond = rng.nextRangeInt(0, 60 * turnMinutes - 1);
    const turnFraction = rng.nextRangeInt(0, 999_999);
    // core DB는 millisecond precision이므로 레거시 microsecond 값을 내림해
    // 저장한다. 먼 과거 연도에서 IEEE-754 덧셈이 반올림하지 않도록 먼저
    // 정수화한다.
    const turnTime = new Date(environment.turnTime.getTime() + turnSecond * 1_000 + Math.floor(turnFraction / 1_000));
    const killturn = (deadYear - environment.year) * 12 + rng.nextRangeInt(0, 11) + environment.month - 1;
    const id = world.getNextGeneralId();
    const general: TurnGeneral = {
        id,
        userId: null,
        name: `${NPC_NAME_PREFIX}${options.baseName}`,
        nationId: 0,
        cityId: city.id,
        troopId: 0,
        stats,
        experience: age * 100,
        dedication: age * 100,
        officerLevel: 0,
        role: {
            personality,
            specialDomestic: env.defaultSpecialDomestic,
            specialWar: env.defaultSpecialWar,
            items: { horse: null, weapon: null, book: null, item: null },
        },
        injury: 0,
        gold: 1_000,
        rice: 1_000,
        crew: 0,
        crewTypeId: env.defaultCrewTypeId,
        train: 0,
        atmos: 0,
        age,
        npcState: NPC_TYPE,
        bornYear,
        deadYear,
        affinity,
        picture: 'default.jpg',
        triggerState: {
            flags: {},
            counters: {},
            modifiers: {},
            meta: {},
        },
        lastTurn: { command: '휴식' },
        turnTime,
        recentWarTime: null,
        meta: {
            killturn,
            npcType: NPC_TYPE,
            npc_org: NPC_TYPE,
            belong: 0,
            dedlevel: 1,
            specage: specAge,
            specage2: specAge2,
            dex1: 0,
            dex2: 0,
            dex3: 0,
            dex4: 0,
            dex5: 0,
        },
    };
    if (!world.addGeneral(general)) {
        throw new Error(`CreateManyNPC generated a duplicate general id: ${id}`);
    }
    reservedTurns.ensureGeneralTurns(id);
    return general;
};

export const createCreateManyNpcHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    reservedTurns: InMemoryReservedTurnStore;
    env: TurnCommandEnv;
}): MonthlyEventActionHandler => {
    return (args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const npcCount = readLegacyNumber(args[0], 10);
        const fillCount = readLegacyNumber(args[1], 0);
        if (npcCount <= 0 && fillCount <= 0) {
            return;
        }

        let moreGeneralCount = 0;
        if (fillCount !== 0) {
            const chiefs = world
                .listGenerals()
                .filter((general) => general.npcState < 3 && general.officerLevel === 12);
            const chiefNationIds = new Set(chiefs.map((general) => general.nationId));
            const registeredGeneralCount = world
                .listGenerals()
                .filter((general) => chiefNationIds.has(general.nationId) && general.npcState < 4).length;
            moreGeneralCount = chiefs.length * fillCount - registeredGeneralCount;
        }

        const requestedCount = npcCount + moreGeneralCount;
        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(resolveHiddenSeed(world), 'CreateManyNPC', environment.year, environment.month)
            )
        );
        const baseNames = pickNames(rng, requestedCount, world.listGenerals(), options.env);
        const created = baseNames.map((baseName) =>
            buildNpc({
                world,
                reservedTurns: options.reservedTurns,
                rng,
                environment,
                env: options.env,
                baseName,
            })
        );

        const count = created.length;
        const actionText =
            count === 1
                ? `<Y>${created[0]!.name}</>${JosaUtil.pick(created[0]!.name, '라')}는 장수가 <S>등장</>하였습니다.`
                : `장수 <C>${count}</>명이 <S>등장</>하였습니다.`;
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.ACTION,
            text: actionText,
            format: LogFormat.MONTH,
            year: environment.year,
            month: environment.month,
        });
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            text: `장수 <C>${count}</>명이 <S>등장</>했습니다.`,
            format: LogFormat.NOTICE_YEAR_MONTH,
            year: environment.year,
            month: environment.month,
        });
    };
};
