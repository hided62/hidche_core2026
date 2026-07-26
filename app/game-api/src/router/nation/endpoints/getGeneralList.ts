import { TRPCError } from '@trpc/server';

import { asRecord } from '@sammo-ts/common';

import type { GameApiContext } from '../../../context.js';
import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import {
    assertNationAccess,
    loadTraitNames,
    resolveNationPermission,
    resolveOfficerCity,
} from '../shared.js';

const MAX_DEDICATION_LEVEL = 10;

const readNumber = (record: Record<string, unknown>, keys: string[], fallback = 0): number => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const experienceLevel = (experience: number): number =>
    Math.max(0, Math.min(100, experience < 1_000 ? Math.floor(experience / 100) : Math.floor(Math.sqrt(experience / 10))));

const dedicationLevel = (dedication: number): number =>
    Math.max(0, Math.min(MAX_DEDICATION_LEVEL, Math.ceil(Math.sqrt(Math.max(0, dedication)) / 10)));

const dedicationLevelText = (level: number): string =>
    level === 0 ? '무품관' : `${MAX_DEDICATION_LEVEL - level + 1}품관`;

const honorText = (experience: number): string => {
    const levels: Array<[number, string]> = [
        [640, '전무'],
        [2_560, '무명'],
        [5_760, '신동'],
        [10_240, '약간'],
        [16_000, '평범'],
        [23_040, '지역적'],
        [31_360, '전국적'],
        [40_960, '세계적'],
        [45_000, '유명'],
        [51_840, '명사'],
        [55_000, '호걸'],
        [64_000, '효웅'],
        [77_440, '영웅'],
    ];
    return levels.find(([limit]) => experience < limit)?.[1] ?? '구세주';
};

const leadershipBonus = (officerLevel: number, nationLevel: number): number => {
    if (officerLevel === 12) return nationLevel * 2;
    if (officerLevel >= 5) return nationLevel;
    return 0;
};

const woundedStat = (value: number, injury: number): number =>
    injury > 0 ? Math.floor((value * (100 - injury)) / 100) : value;

const defenceTrainText = (value: number): string => {
    if (value === 999) return '×';
    if (value >= 90) return '☆';
    if (value >= 80) return '◎';
    if (value >= 60) return '○';
    return '△';
};

const loadNationGeneralData = async (ctx: GameApiContext) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const nation = await ctx.db.nation.findUnique({
        where: { id: me.nationId },
        select: {
            id: true,
            name: true,
            color: true,
            level: true,
            typeCode: true,
            capitalCityId: true,
            meta: true,
        },
    });
    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }
    const viewerPermission = resolveNationPermission(me, nation.meta, true);

    const [cityRows, troopRows, generalRows] = await Promise.all([
        ctx.db.city.findMany({ select: { id: true, name: true } }),
        ctx.db.troop.findMany({
            where: { nationId: me.nationId },
            select: { troopLeaderId: true, name: true },
        }),
        ctx.db.general.findMany({
            where: { nationId: me.nationId },
            orderBy: [{ turnTime: 'asc' }, { id: 'asc' }],
        }),
    ]);
    const generalIds = generalRows.map((general) => general.id);
    const [accessRows, turnRows] = await Promise.all([
        ctx.db.generalAccessLog.findMany({
            where: { generalId: { in: generalIds } },
            select: { generalId: true, refreshScore: true, refreshScoreTotal: true },
        }),
        viewerPermission >= 1
            ? ctx.db.generalTurn.findMany({
                  where: { generalId: { in: generalIds }, turnIdx: { lt: 5 } },
                  select: { generalId: true, turnIdx: true, actionCode: true },
                  orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
              })
            : Promise.resolve([]),
    ]);

    const cityNames = new Map(cityRows.map((city) => [city.id, city.name]));
    const troopNames = new Map(troopRows.map((troop) => [troop.troopLeaderId, troop.name]));
    const accessByGeneral = new Map(accessRows.map((row) => [row.generalId, row]));
    const turnsByGeneral = new Map<number, string[]>();
    for (const turn of turnRows) {
        const turns = turnsByGeneral.get(turn.generalId) ?? [];
        turns[turn.turnIdx] = turn.actionCode;
        turnsByGeneral.set(turn.generalId, turns);
    }

    const [personalityMap, domesticMap, warMap] = await Promise.all([
        loadTraitNames(generalRows.map((general) => general.personalCode), 'personality'),
        loadTraitNames(generalRows.map((general) => general.specialCode), 'domestic'),
        loadTraitNames(generalRows.map((general) => general.special2Code), 'war'),
    ]);

    const generals = generalRows.map((general) => {
        const meta = asRecord(general.meta);
        const officerCity = resolveOfficerCity(meta);
        const access = accessByGeneral.get(general.id);
        const dedLevel = dedicationLevel(general.dedication);
        const actualOfficerLevel = general.officerLevel;
        const visibleOfficerLevel =
            viewerPermission >= 1 || actualOfficerLevel >= 5 ? actualOfficerLevel : Math.min(1, actualOfficerLevel);
        const bonus = leadershipBonus(actualOfficerLevel, nation.level);
        const detail =
            viewerPermission >= 1
                ? {
                      officerLevel: actualOfficerLevel,
                      officerCity,
                      officerCityName: officerCity > 0 ? (cityNames.get(officerCity) ?? null) : null,
                      cityId: general.cityId,
                      cityName: cityNames.get(general.cityId) ?? null,
                      troopId: general.troopId,
                      troopName: troopNames.get(general.troopId) ?? null,
                      defenceTrain: readNumber(meta, ['defenceTrain', 'defence_train'], 80),
                      crewTypeId: general.crewTypeId,
                      crew: general.crew,
                      train: general.train,
                      atmos: general.atmos,
                      experience: general.experience,
                      dedication: general.dedication,
                      turnTime: general.turnTime.toISOString(),
                      recentWarTime: general.recentWarTime?.toISOString() ?? null,
                      killTurn: readNumber(meta, ['killturn', 'killTurn']),
                      refreshScore: access?.refreshScore ?? 0,
                      reservedCommands: general.npcState < 2 ? (turnsByGeneral.get(general.id) ?? []) : [],
                  }
                : null;

        return {
            id: general.id,
            name: general.name,
            npcState: general.npcState,
            picture: general.picture,
            imageServer: general.imageServer,
            injury: general.injury,
            stats: {
                leadership: woundedStat(general.leadership, general.injury),
                strength: woundedStat(general.strength, general.injury),
                intelligence: woundedStat(general.intel, general.injury),
            },
            leadershipBonus: bonus,
            officerLevel: visibleOfficerLevel,
            experienceLevel: experienceLevel(general.experience),
            honorText: honorText(general.experience),
            dedicationLevel: dedLevel,
            dedicationLevelText: dedicationLevelText(dedLevel),
            bill: dedLevel * 200 + 400,
            gold: general.gold,
            rice: general.rice,
            age: general.age,
            belong: readNumber(meta, ['belong']),
            refreshScoreTotal: access?.refreshScoreTotal ?? 0,
            personality: general.personalCode === 'None' ? null : (personalityMap.get(general.personalCode) ?? null),
            specialDomestic:
                general.specialCode === 'None' ? null : (domesticMap.get(general.specialCode) ?? null),
            specialWar: general.special2Code === 'None' ? null : (warMap.get(general.special2Code) ?? null),
            detail,
        };
    });

    return {
        me,
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            typeCode: nation.typeCode,
            capitalCityId: nation.capitalCityId ?? 0,
        },
        viewerPermission,
        generals,
    };
};

export const getGeneralList = authedProcedure.query(async ({ ctx }) => {
    const data = await loadNationGeneralData(ctx);
    return {
        nation: data.nation,
        viewer: { generalId: data.me.id, permission: data.viewerPermission },
        generals: data.generals,
    };
});

export const getSecretGeneralList = authedProcedure.query(async ({ ctx }) => {
    const data = await loadNationGeneralData(ctx);
    if (data.viewerPermission < 1) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: '권한이 부족합니다. 수뇌부가 아니거나 사관년도가 부족합니다.',
        });
    }

    const visibleGenerals = data.generals.filter((general) => general.npcState !== 5);
    const summaryBase = visibleGenerals.reduce(
        (summary, general) => {
            const detail = general.detail;
            if (!detail) return summary;
            summary.gold += general.gold;
            summary.rice += general.rice;
            summary.crew += detail.crew;
            if (detail.crew > 0) {
                for (const threshold of [90, 80, 60] as const) {
                    if (detail.train >= threshold && detail.atmos >= threshold) {
                        summary.readiness[threshold].crew += detail.crew;
                        summary.readiness[threshold].generals += 1;
                    }
                }
            }
            return summary;
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
    const generalCount = visibleGenerals.length;

    return {
        nation: data.nation,
        viewer: { generalId: data.me.id, permission: data.viewerPermission },
        summary: {
            ...summaryBase,
            generalCount,
            averageGold: generalCount ? summaryBase.gold / generalCount : 0,
            averageRice: generalCount ? summaryBase.rice / generalCount : 0,
        },
        generals: data.generals.map((general) => ({
            ...general,
            defenceTrainText: defenceTrainText(general.detail?.defenceTrain ?? 0),
        })),
    };
});
