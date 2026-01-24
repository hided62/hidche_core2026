import { TRPCError } from '@trpc/server';

import { asRecord } from '@sammo-ts/common';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, checkSecretMaxPermission, mapGeneralList, resolveChiefStatMin } from '../shared.js';

export const getPersonnelInfo = authedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const [nation, cityRows, troopRows, generalRows, worldState] = await Promise.all([
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
            select: { id: true, name: true, level: true, region: true },
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
    ]);

    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }

    const cityNameMap = new Map(cityRows.map((city) => [city.id, city.name]));
    const troopNameMap = new Map(troopRows.map((troop) => [troop.troopLeaderId, troop.name]));
    const mappedGenerals = await mapGeneralList(generalRows, cityNameMap, troopNameMap);

    const chiefAssignments = mappedGenerals
        .filter((general) => general.officerLevel >= 5)
        .reduce<Record<number, (typeof mappedGenerals)[number]>>((acc, general) => {
            acc[general.officerLevel] = general;
            return acc;
        }, {});

    const cityAssignments = cityRows.map((city) => {
        const officers = mappedGenerals.filter(
            (general) => general.officerLevel >= 2 && general.officerLevel <= 4 && general.officerCity === city.id
        );

        const officerMap: Record<number, (typeof mappedGenerals)[number] | null> = {
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

    const ambassadors = permissionCandidates.filter(
        (candidate) => candidate.permission === 'ambassador' || candidate.maxPermission === 4
    );
    const auditors = permissionCandidates.filter(
        (candidate) => candidate.permission === 'auditor' || candidate.maxPermission >= 3
    );

    return {
        me: {
            id: me.id,
            officerLevel: me.officerLevel,
        },
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            typeCode: nation.typeCode,
            capitalCityId: nation.capitalCityId ?? 0,
        },
        chiefStatMin: resolveChiefStatMin(worldState),
        generals: mappedGenerals,
        chiefAssignments,
        cityAssignments,
        permissionCandidates: {
            ambassadors,
            auditors,
        },
    };
});
