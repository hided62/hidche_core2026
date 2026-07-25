import { TRPCError } from '@trpc/server';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, loadTraitNames, mapGeneralList, resolveChiefStatMin } from '../shared.js';

export const getGeneralList = authedProcedure.query(async ({ ctx }) => {
    const general = await getMyGeneral(ctx);
    assertNationAccess(general);

    const [nation, cityRows, troopRows, generalRows, worldState] = await Promise.all([
        ctx.db.nation.findUnique({
            where: { id: general.nationId },
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
        ctx.db.city.findMany({ select: { id: true, name: true } }),
        ctx.db.troop.findMany({ select: { troopLeaderId: true, name: true } }),
        ctx.db.general.findMany({
            where: { nationId: general.nationId },
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
    ]);

    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }

    const cityNameMap = new Map(cityRows.map((city) => [city.id, city.name]));
    const troopNameMap = new Map(troopRows.map((troop) => [troop.troopLeaderId, troop.name]));
    const list = await mapGeneralList(generalRows, cityNameMap, troopNameMap);
    const nationTrait = (await loadTraitNames([nation.typeCode], 'nation')).get(nation.typeCode);

    return {
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            typeCode: nation.typeCode,
            type: {
                key: nation.typeCode,
                name: nationTrait?.name ?? nation.typeCode,
                info: nationTrait?.info ?? '',
            },
            capitalCityId: nation.capitalCityId ?? 0,
        },
        chiefStatMin: resolveChiefStatMin(worldState),
        generals: list,
    };
});
