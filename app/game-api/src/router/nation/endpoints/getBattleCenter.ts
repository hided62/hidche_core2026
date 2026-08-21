import { TRPCError } from '@trpc/server';

import { asRecord, type RankDataType } from '@sammo-ts/common';
import { getBillByLevel, LogCategory } from '@sammo-ts/logic';

import { accessAuthedProcedure } from '../../../trpc.js';
import {
    loadCrewTypeDisplayNames,
    loadItemDisplayNames,
    resolveDedicationLevelName,
    resolveOfficerLevelName,
    sanitizeInternalDisplayCode,
} from '../../../services/gameDisplayNames.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, formatDateTime, loadTraitNames, resolveNationPermission } from '../shared.js';

const BATTLE_CENTER_RECORD_TYPES = [
    'firenum',
    'warnum',
    'killnum',
    'deathnum',
    'killcrew',
    'deathcrew',
] as const satisfies readonly RankDataType[];

export const getBattleCenter = accessAuthedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const [nation, worldState, generalRows] = await Promise.all([
        ctx.db.nation.findUnique({
            where: { id: me.nationId },
            select: {
                id: true,
                name: true,
                color: true,
                level: true,
                meta: true,
            },
        }),
        ctx.db.worldState.findFirst(),
        ctx.db.general.findMany({
            where: { nationId: me.nationId },
            select: {
                id: true,
                name: true,
                picture: true,
                imageServer: true,
                npcState: true,
                officerLevel: true,
                cityId: true,
                turnTime: true,
                recentWarTime: true,
                leadership: true,
                strength: true,
                intel: true,
                experience: true,
                dedication: true,
                injury: true,
                gold: true,
                rice: true,
                crew: true,
                train: true,
                atmos: true,
                age: true,
                crewTypeId: true,
                weaponCode: true,
                bookCode: true,
                horseCode: true,
                itemCode: true,
                personalCode: true,
                specialCode: true,
                special2Code: true,
                meta: true,
            },
            orderBy: { id: 'asc' },
        }),
    ]);

    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }
    if (!worldState) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
    }

    const permissionLevel = resolveNationPermission(me, nation.meta, true);
    if (permissionLevel < 1) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
    }

    const generalIds = generalRows.map((general) => general.id);
    const [battleCounts, rankRows] =
        generalIds.length > 0
            ? await Promise.all([
                  ctx.db.logEntry.groupBy({
                      by: ['generalId'],
                      where: {
                          generalId: { in: generalIds },
                          category: LogCategory.BATTLE_BRIEF,
                      },
                      _count: { _all: true },
                  }),
                  ctx.db.rankData.findMany({
                      where: {
                          generalId: { in: generalIds },
                          type: { in: [...BATTLE_CENTER_RECORD_TYPES] },
                      },
                      select: { generalId: true, type: true, value: true },
                  }),
              ])
            : [[], []];
    const battleCountMap = new Map<number, number>();
    for (const row of battleCounts) {
        if (row.generalId !== null) {
            battleCountMap.set(row.generalId, row._count._all);
        }
    }
    const rankValueMap = new Map<number, Map<RankDataType, number>>();
    for (const row of rankRows) {
        const values = rankValueMap.get(row.generalId) ?? new Map<RankDataType, number>();
        values.set(row.type as (typeof BATTLE_CENTER_RECORD_TYPES)[number], row.value);
        rankValueMap.set(row.generalId, values);
    }

    const worldConfig = asRecord(worldState.config);
    const constValues = asRecord(worldConfig.const ?? worldConfig.consts);
    const statUpgradeLimit =
        typeof constValues.upgradeLimit === 'number' && Number.isFinite(constValues.upgradeLimit)
            ? constValues.upgradeLimit
            : 30;
    const maxDedicationLevel =
        typeof constValues.maxDedLevel === 'number' && Number.isFinite(constValues.maxDedLevel)
            ? Math.max(0, Math.trunc(constValues.maxDedLevel))
            : 30;
    const [personalityNames, domesticNames, warNames, crewTypeNames, itemNames] = await Promise.all([
        loadTraitNames(
            generalRows.map((general) => general.personalCode),
            'personality'
        ),
        loadTraitNames(
            generalRows.map((general) => general.specialCode),
            'domestic'
        ),
        loadTraitNames(
            generalRows.map((general) => general.special2Code),
            'war'
        ),
        loadCrewTypeDisplayNames(worldState, ctx.profile.id),
        loadItemDisplayNames(
            generalRows.flatMap((general) => [
                general.weaponCode,
                general.bookCode,
                general.horseCode,
                general.itemCode,
            ])
        ),
    ]);
    const traitName = (code: string, names: Awaited<ReturnType<typeof loadTraitNames>>): string =>
        names.get(code)?.name ?? sanitizeInternalDisplayCode(code);
    const itemName = (code: string): string => itemNames.get(code) ?? sanitizeInternalDisplayCode(code);

    const generals = generalRows.map((general) => {
        const meta =
            general.meta && typeof general.meta === 'object' && !Array.isArray(general.meta)
                ? (general.meta as Record<string, unknown>)
                : {};
        const metaNumber = (keys: string | string[], fallback = 0): number => {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
                const value = meta[key];
                if (typeof value === 'number' && Number.isFinite(value)) {
                    return value;
                }
            }
            return fallback;
        };
        const rankValue = (type: (typeof BATTLE_CENTER_RECORD_TYPES)[number], fallback = 0): number =>
            rankValueMap.get(general.id)?.get(type) ?? fallback;
        const warnum = rankValue('warnum', metaNumber(['rank_warnum', 'warnum'], battleCountMap.get(general.id) ?? 0));
        const storedDedicationLevel = metaNumber('dedlevel');
        const dedicationLevel =
            storedDedicationLevel > 0
                ? storedDedicationLevel
                : Math.max(0, Math.min(Math.ceil(Math.sqrt(general.dedication) / 10), maxDedicationLevel));
        return {
            id: general.id,
            name: general.name,
            picture: general.picture,
            imageServer: general.imageServer,
            npcState: general.npcState,
            officerLevel: general.officerLevel,
            officerLevelText: resolveOfficerLevelName(general.officerLevel, nation.level),
            cityId: general.cityId,
            turnTime: formatDateTime(general.turnTime),
            recentWar: formatDateTime(general.recentWarTime),
            warnum,
            stats: {
                leadership: general.leadership,
                strength: general.strength,
                intelligence: general.intel,
            },
            experience: general.experience,
            dedication: general.dedication,
            bill: getBillByLevel(dedicationLevel),
            injury: general.injury,
            gold: general.gold,
            rice: general.rice,
            crew: general.crew,
            train: general.train,
            atmos: general.atmos,
            age: general.age,
            defenceTrain: metaNumber('defence_train', 80),
            killTurn: metaNumber(['killturn', 'killTurn']),
            crewTypeId: general.crewTypeId,
            crewTypeName: crewTypeNames.get(general.crewTypeId) ?? '-',
            equipment: {
                weapon: general.weaponCode,
                book: general.bookCode,
                horse: general.horseCode,
                item: general.itemCode,
            },
            equipmentNames: {
                weapon: itemName(general.weaponCode),
                book: itemName(general.bookCode),
                horse: itemName(general.horseCode),
                item: itemName(general.itemCode),
            },
            traits: {
                personal: traitName(general.personalCode, personalityNames),
                specialDomestic: traitName(general.specialCode, domesticNames),
                specialWar: traitName(general.special2Code, warNames),
            },
            progression: {
                experienceLevel: metaNumber('explevel'),
                dedicationLevel,
                dedicationText: resolveDedicationLevelName(dedicationLevel, maxDedicationLevel),
                statExperience: {
                    leadership: metaNumber('leadership_exp'),
                    strength: metaNumber('strength_exp'),
                    intelligence: metaNumber('intel_exp'),
                },
                statUpgradeLimit,
                dex: [1, 2, 3, 4, 5].map((index) => metaNumber(`dex${index}`)),
            },
            serviceYears: metaNumber('belong'),
            battleStats: {
                kills: rankValue('killnum', metaNumber(['rank_killnum', 'killnum'])),
                deaths: rankValue('deathnum', metaNumber(['rank_deathnum', 'deathnum'])),
                fire: rankValue('firenum', metaNumber(['rank_firenum', 'firenum'])),
                killCrew: rankValue('killcrew', metaNumber(['rank_killcrew', 'killcrew'])),
                deathCrew: rankValue('deathcrew', metaNumber(['rank_deathcrew', 'deathcrew'])),
                dex: [1, 2, 3, 4, 5].map((index) => metaNumber(`dex${index}`)),
            },
        };
    });

    return {
        me: {
            id: me.id,
            officerLevel: me.officerLevel,
            permissionLevel,
        },
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
        },
        currentYear: worldState.currentYear,
        currentMonth: worldState.currentMonth,
        turnTermMinutes: Math.max(1, Math.round(worldState.tickSeconds / 60)),
        generals,
    };
});
