import { TRPCError } from '@trpc/server';

import { asRecord } from '@sammo-ts/common';
import { calcCityGoldIncome, calcCityRiceIncome, calcCityWallIncome } from '@sammo-ts/logic';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import {
    assertNationAccess,
    buildNationIncomeContext,
    resolveChiefStatMin,
    resolveNationRate,
    resolveOfficerCity,
    toIncomeCity,
} from '../shared.js';

export const getCityOverview = authedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const [nation, cityRows, generalRows, worldState] = await Promise.all([
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
            select: {
                id: true,
                name: true,
                level: true,
                nationId: true,
                region: true,
                population: true,
                populationMax: true,
                agriculture: true,
                agricultureMax: true,
                commerce: true,
                commerceMax: true,
                security: true,
                securityMax: true,
                trust: true,
                trade: true,
                defence: true,
                defenceMax: true,
                wall: true,
                wallMax: true,
                supplyState: true,
                frontState: true,
                meta: true,
            },
            orderBy: { id: 'asc' },
        }),
        ctx.db.general.findMany({
            where: { nationId: me.nationId },
            select: {
                id: true,
                name: true,
                npcState: true,
                officerLevel: true,
                cityId: true,
                leadership: true,
                strength: true,
                intel: true,
                meta: true,
            },
            orderBy: { id: 'asc' },
        }),
        ctx.db.worldState.findFirst(),
    ]);

    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }

    const cityNameMap = new Map(cityRows.map((city) => [city.id, city.name]));

    const officerByCity = new Map<number, Record<number, (typeof generalRows)[number]>>();
    const officerCntByCity = new Map<number, number>();

    for (const general of generalRows) {
        if (general.officerLevel < 2 || general.officerLevel > 4) {
            continue;
        }
        const meta = asRecord(general.meta);
        const officerCity = resolveOfficerCity(meta);
        if (!officerCity) {
            continue;
        }
        const entry = officerByCity.get(officerCity) ?? {};
        entry[general.officerLevel] = general;
        officerByCity.set(officerCity, entry);

        if (general.cityId === officerCity) {
            officerCntByCity.set(officerCity, (officerCntByCity.get(officerCity) ?? 0) + 1);
        }
    }

    const incomeContext = await buildNationIncomeContext(nation);

    const cities = cityRows.map((city) => {
        const officers = officerByCity.get(city.id) ?? {};
        const officerCnt = officerCntByCity.get(city.id) ?? 0;
        const isCapital = nation.capitalCityId === city.id;
        const incomeCity = toIncomeCity(city);
        const incomes = {
            gold: calcCityGoldIncome(incomeContext, incomeCity, officerCnt, isCapital, nation.level),
            rice: calcCityRiceIncome(incomeContext, incomeCity, officerCnt, isCapital, nation.level),
            wall: calcCityWallIncome(incomeContext, incomeCity, officerCnt, isCapital, nation.level),
        };

        return {
            id: city.id,
            name: city.name,
            level: city.level,
            region: city.region,
            population: city.population,
            populationMax: city.populationMax,
            agriculture: city.agriculture,
            agricultureMax: city.agricultureMax,
            commerce: city.commerce,
            commerceMax: city.commerceMax,
            security: city.security,
            securityMax: city.securityMax,
            trust: city.trust,
            trade: city.trade,
            defence: city.defence,
            defenceMax: city.defenceMax,
            wall: city.wall,
            wallMax: city.wallMax,
            supplyState: city.supplyState,
            frontState: city.frontState,
            incomes,
            officers: {
                4: officers[4]
                    ? {
                          id: officers[4].id,
                          name: officers[4].name,
                          npcState: officers[4].npcState,
                          officerLevel: officers[4].officerLevel,
                          cityId: officers[4].cityId,
                          cityName: cityNameMap.get(officers[4].cityId) ?? null,
                      }
                    : null,
                3: officers[3]
                    ? {
                          id: officers[3].id,
                          name: officers[3].name,
                          npcState: officers[3].npcState,
                          officerLevel: officers[3].officerLevel,
                          cityId: officers[3].cityId,
                          cityName: cityNameMap.get(officers[3].cityId) ?? null,
                      }
                    : null,
                2: officers[2]
                    ? {
                          id: officers[2].id,
                          name: officers[2].name,
                          npcState: officers[2].npcState,
                          officerLevel: officers[2].officerLevel,
                          cityId: officers[2].cityId,
                          cityName: cityNameMap.get(officers[2].cityId) ?? null,
                      }
                    : null,
            },
        };
    });

    const generals = generalRows.map((general) => {
        const meta = asRecord(general.meta);
        return {
            id: general.id,
            name: general.name,
            npcState: general.npcState,
            officerLevel: general.officerLevel,
            cityId: general.cityId,
            officerCity: resolveOfficerCity(meta),
            stats: {
                leadership: general.leadership,
                strength: general.strength,
                intelligence: general.intel,
            },
        };
    });

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
            rate: resolveNationRate(nation),
        },
        chiefStatMin: resolveChiefStatMin(worldState),
        cities,
        generals,
    };
});
