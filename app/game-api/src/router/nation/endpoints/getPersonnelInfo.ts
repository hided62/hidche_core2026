import { TRPCError } from '@trpc/server';

import { asRecord } from '@sammo-ts/common';

import { accessAuthedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, checkSecretMaxPermission, mapGeneralList, resolveChiefStatMin } from '../shared.js';

export const getPersonnelInfo = accessAuthedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const [nation, cityRows, troopRows, generalRows, worldState, rankRows] = await Promise.all([
        ctx.db.nation.findUnique({
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
        }),
        ctx.db.city.findMany({
            where: { nationId: me.nationId },
            select: { id: true, name: true, level: true, region: true, meta: true },
            orderBy: { id: 'asc' },
        }),
        ctx.db.troop.findMany({ select: { troopLeaderId: true, name: true } }),
        ctx.db.general.findMany({
            where: { nationId: me.nationId },
            select: {
                id: true,
                name: true,
                npcState: true,
                nationId: true,
                cityId: true,
                troopId: true,
                picture: true,
                imageServer: true,
                officerLevel: true,
                leadership: true,
                strength: true,
                intel: true,
                experience: true,
                dedication: true,
                injury: true,
                gold: true,
                rice: true,
                crew: true,
                personalCode: true,
                specialCode: true,
                special2Code: true,
                meta: true,
                penalty: true,
            },
            orderBy: { id: 'asc' },
        }),
        ctx.db.worldState.findFirst(),
        ctx.db.rankData.findMany({
            where: {
                nationId: me.nationId,
                type: { in: ['killnum', 'firenum'] },
                value: { gt: 0 },
            },
            select: { generalId: true, type: true, value: true },
            orderBy: [{ value: 'desc' }, { generalId: 'asc' }],
        }),
    ]);

    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }

    const cityNameMap = new Map(cityRows.map((city) => [city.id, city.name]));
    const troopNameMap = new Map(troopRows.map((troop) => [troop.troopLeaderId, troop.name]));
    const mappedGenerals = await mapGeneralList(generalRows, cityNameMap, troopNameMap);
    const canManage = me.officerLevel >= 5;
    const responseGenerals = canManage
        ? mappedGenerals
        : mappedGenerals.map((general) => ({
              ...general,
              stats: { leadership: 0, strength: 0, intelligence: 0 },
              experience: 0,
              dedication: 0,
              injury: 0,
              gold: 0,
              rice: 0,
              crew: 0,
              troopId: 0,
              troopName: null,
              personality: null,
              specialDomestic: null,
              specialWar: null,
          }));
    const responseGeneralMap = new Map(responseGenerals.map((general) => [general.id, general]));
    const visibleGenerals = responseGenerals.filter((general) => canManage || general.officerLevel >= 2);

    const chiefAssignments = responseGenerals
        .filter((general) => general.officerLevel >= 5)
        .reduce<Record<number, (typeof responseGenerals)[number]>>((acc, general) => {
            acc[general.officerLevel] = general;
            return acc;
        }, {});

    const cityAssignments = cityRows.map((city) => {
        const officers = mappedGenerals
            .filter(
                (general) => general.officerLevel >= 2 && general.officerLevel <= 4 && general.officerCity === city.id
            )
            .map((general) => responseGeneralMap.get(general.id)!);

        const officerMap: Record<number, (typeof responseGenerals)[number] | null> = {
            4: null,
            3: null,
            2: null,
        };

        for (const officer of officers) {
            officerMap[officer.officerLevel] = officer;
        }

        return {
            id: city.id,
            name: city.name,
            level: city.level,
            region: city.region,
            officerSet: Number(asRecord(city.meta).officer_set ?? 0),
            officers: officerMap,
        };
    });

    const penaltyMap = new Map<number, Record<string, unknown>>(
        generalRows.map((row) => [row.id, asRecord(row.penalty)])
    );

    const permissionCandidates = mappedGenerals
        .filter((general) => general.officerLevel !== 12)
        .map((general) => {
            const penalty = penaltyMap.get(general.id) ?? {};
            const maxPermission = checkSecretMaxPermission(penalty);
            return {
                id: general.id,
                name: general.name,
                npcState: general.npcState,
                permission: general.permission,
                maxPermission,
            };
        });

    const canChangePermissions = me.officerLevel === 12;
    const ambassadors = canChangePermissions
        ? permissionCandidates.filter(
              (candidate) => candidate.permission === 'ambassador' || candidate.maxPermission === 4
          )
        : [];
    const auditors = canChangePermissions
        ? permissionCandidates.filter((candidate) => candidate.permission === 'auditor' || candidate.maxPermission >= 3)
        : [];
    const generalNameMap = new Map(mappedGenerals.map((general) => [general.id, general.name]));
    const awards = {
        tigers: rankRows
            .filter((row) => row.type === 'killnum')
            .slice(0, 5)
            .map((row) => ({ id: row.generalId, name: generalNameMap.get(row.generalId) ?? '-', value: row.value })),
        eagles: rankRows
            .filter((row) => row.type === 'firenum')
            .slice(0, 7)
            .map((row) => ({ id: row.generalId, name: generalNameMap.get(row.generalId) ?? '-', value: row.value })),
    };
    const nationMeta = asRecord(nation.meta);
    const mePenalty = penaltyMap.get(me.id) ?? {};
    const chiefSet = Number(nationMeta.chief_set ?? 0);

    return {
        me: {
            id: me.id,
            officerLevel: me.officerLevel,
            canManage,
            canChangePermissions,
            canKick: canManage && mePenalty.noBanGeneral !== true && (chiefSet & (1 << me.officerLevel)) === 0,
        },
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            typeCode: nation.typeCode,
            capitalCityId: nation.capitalCityId ?? 0,
            chiefSet,
        },
        chiefStatMin: resolveChiefStatMin(worldState),
        generals: visibleGenerals,
        chiefAssignments,
        cityAssignments,
        awards,
        permissionCandidates: {
            ambassadors,
            auditors,
        },
    };
});
