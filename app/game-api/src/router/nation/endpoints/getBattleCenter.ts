import { TRPCError } from '@trpc/server';

import { asRecord } from '@sammo-ts/common';
import { LogCategory } from '@sammo-ts/logic';

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
    const battleCounts =
        generalIds.length > 0
            ? await ctx.db.logEntry.groupBy({
                  by: ['generalId'],
                  where: {
                      generalId: { in: generalIds },
                      category: LogCategory.BATTLE_BRIEF,
                  },
                  _count: { _all: true },
              })
            : [];
    const battleCountMap = new Map<number, number>();
    for (const row of battleCounts) {
        if (row.generalId !== null) {
            battleCountMap.set(row.generalId, row._count._all);
        }
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
        const metaNumber = (key: string): number => {
            const value = meta[key];
            return typeof value === 'number' && Number.isFinite(value) ? value : 0;
        };
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
            warnum: battleCountMap.get(general.id) ?? 0,
            stats: {
                leadership: general.leadership,
                strength: general.strength,
                intelligence: general.intel,
            },
            experience: general.experience,
            dedication: general.dedication,
            injury: general.injury,
            gold: general.gold,
            rice: general.rice,
            crew: general.crew,
            train: general.train,
            atmos: general.atmos,
            age: general.age,
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
            battleStats: {
                kills: metaNumber('rank_killnum') || metaNumber('killnum'),
                deaths: metaNumber('deathnum'),
                fire: metaNumber('firenum'),
                killCrew: metaNumber('killcrew'),
                deathCrew: metaNumber('deathcrew'),
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
