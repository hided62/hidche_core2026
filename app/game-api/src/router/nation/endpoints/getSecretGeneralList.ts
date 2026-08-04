import { TRPCError } from '@trpc/server';

import { asRecord } from '@sammo-ts/common';

import { loadUnitSetDefinitionByName } from '../../../battleSim/unitSetLoader.js';
import { accessAuthedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, resolveNationPermission } from '../shared.js';

const readNumber = (record: Record<string, unknown>, keys: string[], fallback = 0): number => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return fallback;
};
const woundedStat = (value: number, injury: number): number =>
    injury > 0 ? Math.floor((value * (100 - injury)) / 100) : value;
const experienceLevel = (experience: number): number =>
    Math.max(
        0,
        Math.min(100, experience < 1000 ? Math.floor(experience / 100) : Math.floor(Math.sqrt(experience / 10)))
    );
const leadershipBonus = (officerLevel: number, nationLevel: number): number =>
    officerLevel === 12 ? nationLevel * 2 : officerLevel >= 5 ? nationLevel : 0;
const defenceTrainText = (value: number): string =>
    value === 999 ? '×' : value >= 90 ? '☆' : value >= 80 ? '◎' : value >= 60 ? '○' : '△';

export const getSecretGeneralList = accessAuthedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);
    const nation = await ctx.db.nation.findUnique({
        where: { id: me.nationId },
        select: { id: true, name: true, color: true, level: true, meta: true },
    });
    if (!nation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    const permission = resolveNationPermission(me, nation.meta, true);
    if (permission < 1) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: '권한이 부족합니다. 수뇌부가 아니거나 사관년도가 부족합니다.',
        });
    }

    const [cities, troops, generalRows, worldState] = await Promise.all([
        ctx.db.city.findMany({ select: { id: true, name: true } }),
        ctx.db.troop.findMany({
            where: { nationId: me.nationId },
            select: { troopLeaderId: true, name: true },
        }),
        ctx.db.general.findMany({
            where: { nationId: me.nationId },
            orderBy: [{ turnTime: 'asc' }, { id: 'asc' }],
        }),
        ctx.db.worldState.findFirst({ select: { config: true } }),
    ]);
    const worldConfig = asRecord(worldState?.config);
    const environment = asRecord(worldConfig.environment ?? worldConfig.map);
    const unitSetName =
        typeof environment.unitSet === 'string' && environment.unitSet.trim() ? environment.unitSet : ctx.profile.id;
    const unitSet = await loadUnitSetDefinitionByName(unitSetName);
    const crewTypeNames = new Map((unitSet.crewTypes ?? []).map((crewType) => [crewType.id, crewType.name]));
    const generalIds = generalRows.map((general) => general.id);
    const turns = generalIds.length
        ? await ctx.db.generalTurn.findMany({
              where: { generalId: { in: generalIds }, turnIdx: { lt: 5 } },
              select: { generalId: true, turnIdx: true, actionCode: true },
              orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
          })
        : [];
    const cityNames = new Map(cities.map((city) => [city.id, city.name]));
    const troopNames = new Map(troops.map((troop) => [troop.troopLeaderId, troop.name]));
    const turnMap = new Map<number, string[]>();
    for (const turn of turns) {
        const list = turnMap.get(turn.generalId) ?? [];
        list[turn.turnIdx] = turn.actionCode;
        turnMap.set(turn.generalId, list);
    }
    const generals = generalRows.map((general) => {
        const meta = asRecord(general.meta);
        const defenceTrain = readNumber(meta, ['defenceTrain', 'defence_train'], 80);
        return {
            id: general.id,
            name: general.name,
            npcState: general.npcState,
            injury: general.injury,
            stats: {
                leadership: woundedStat(general.leadership, general.injury),
                strength: woundedStat(general.strength, general.injury),
                intelligence: woundedStat(general.intel, general.injury),
            },
            leadershipBonus: leadershipBonus(general.officerLevel, nation.level),
            experienceLevel: experienceLevel(general.experience),
            troopId: general.troopId,
            troopName: troopNames.get(general.troopId) ?? null,
            gold: general.gold,
            rice: general.rice,
            cityId: general.cityId,
            cityName: cityNames.get(general.cityId) ?? null,
            defenceTrain,
            defenceTrainText: defenceTrainText(defenceTrain),
            crewTypeId: general.crewTypeId,
            crewTypeName: crewTypeNames.get(general.crewTypeId) ?? '-',
            crew: general.crew,
            train: general.train,
            atmos: general.atmos,
            killTurn: readNumber(meta, ['killturn', 'killTurn']),
            turnTime: general.turnTime.toISOString(),
            reservedCommands: general.npcState < 2 ? (turnMap.get(general.id) ?? []) : [],
        };
    });
    const counted = generals.filter((general) => general.npcState !== 5);
    const summary = counted.reduce(
        (result, general) => {
            result.gold += general.gold;
            result.rice += general.rice;
            result.crew += general.crew;
            if (general.crew > 0) {
                for (const threshold of [90, 80, 60] as const) {
                    if (general.train >= threshold && general.atmos >= threshold) {
                        result.readiness[threshold].crew += general.crew;
                        result.readiness[threshold].generals += 1;
                    }
                }
            }
            return result;
        },
        {
            gold: 0,
            rice: 0,
            crew: 0,
            readiness: {
                90: { crew: 0, generals: 0 },
                80: { crew: 0, generals: 0 },
                60: { crew: 0, generals: 0 },
            },
        }
    );
    return {
        nation: { id: nation.id, name: nation.name, color: nation.color, level: nation.level },
        viewer: { generalId: me.id, permission },
        summary: {
            ...summary,
            generalCount: counted.length,
            averageGold: counted.length ? summary.gold / counted.length : 0,
            averageRice: counted.length ? summary.rice / counted.length : 0,
        },
        generals,
    };
});
