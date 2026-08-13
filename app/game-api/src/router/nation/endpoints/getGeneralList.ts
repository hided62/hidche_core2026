import { TRPCError } from '@trpc/server';
import { asNumber, asRecord } from '@sammo-ts/common';

import { accessAuthedProcedure } from '../../../trpc.js';
import { resolveDedicationLevelName, sanitizeInternalDisplayCode } from '../../../services/gameDisplayNames.js';
import { getMyGeneral } from '../../shared/general.js';
import {
    assertNationAccess,
    loadTraitNames,
    mapGeneralList,
    resolveChiefStatMin,
    resolveNationPermission,
} from '../shared.js';

const experienceLevel = (experience: number): number =>
    Math.max(
        0,
        Math.min(100, experience < 1000 ? Math.floor(experience / 100) : Math.floor(Math.sqrt(experience / 10)))
    );
const dedicationLevel = (dedication: number, maxLevel: number): number =>
    Math.max(0, Math.min(maxLevel, Math.ceil(Math.sqrt(dedication) / 10)));

export const getGeneralList = accessAuthedProcedure.query(async ({ ctx }) => {
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
    const accessRows = generalRows.length
        ? await ctx.db.generalAccessLog.findMany({
              where: { generalId: { in: generalRows.map((entry) => entry.id) } },
              select: { generalId: true, refreshScoreTotal: true },
          })
        : [];
    const accessByGeneral = new Map(accessRows.map((entry) => [entry.generalId, entry.refreshScoreTotal]));
    const nationTrait = (await loadTraitNames([nation.typeCode], 'nation')).get(nation.typeCode);
    const permission = resolveNationPermission(general, nation.meta, true);
    const config = asRecord(worldState?.config);
    const maxDedicationLevel = Math.max(0, Math.trunc(asNumber(asRecord(config.const).maxDedLevel, 30)));
    const visibleList = list.map((entry) => {
        const entryDedicationLevel = dedicationLevel(entry.dedication, maxDedicationLevel);
        const dedicationDisplay = {
            dedicationLevel: entryDedicationLevel,
            dedicationText: resolveDedicationLevelName(entryDedicationLevel, maxDedicationLevel),
            bill: entryDedicationLevel * 200 + 400,
        };
        const { permission: _targetPermission, ...safeEntry } = entry;
        if (permission >= 1) {
            return {
                ...safeEntry,
                refreshScoreTotal: accessByGeneral.get(entry.id) ?? 0,
                experienceLevel: experienceLevel(entry.experience),
                ...dedicationDisplay,
            };
        }
        const { crew: _crew, experience: _experience, dedication: _dedication, ...visible } = safeEntry;
        return {
            ...visible,
            refreshScoreTotal: accessByGeneral.get(entry.id) ?? 0,
            officerLevel: entry.officerLevel >= 5 ? entry.officerLevel : Math.min(1, entry.officerLevel),
            cityName: null,
            troopName: null,
            officerCity: 0,
            officerCityName: null,
            experienceLevel: experienceLevel(entry.experience),
            ...dedicationDisplay,
        };
    });

    return {
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            typeCode: nation.typeCode,
            type: {
                key: nation.typeCode,
                name: nationTrait?.name ?? sanitizeInternalDisplayCode(nation.typeCode),
                info: nationTrait?.info ?? '',
            },
            capitalCityId: nation.capitalCityId ?? 0,
        },
        chiefStatMin: resolveChiefStatMin(worldState),
        viewer: { generalId: general.id, permission },
        generals: visibleList,
    };
});
