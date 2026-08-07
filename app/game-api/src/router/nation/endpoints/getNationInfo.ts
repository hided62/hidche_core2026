import { TRPCError } from '@trpc/server';

import { asRecord } from '@sammo-ts/common';
import {
    getGoldIncome,
    getOutcome,
    getRiceIncome,
    getWallIncome,
    getWarGoldIncome,
    LogCategory,
    LogScope,
} from '@sammo-ts/logic';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import {
    assertNationAccess,
    buildNationIncomeContext,
    resolveNationBill,
    resolveNationRate,
    resolveOfficerCity,
    toIncomeCity,
} from '../shared.js';

export const getNationInfo = authedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const [nation, cities, generals, history] = await Promise.all([
        ctx.db.nation.findUnique({ where: { id: me.nationId } }),
        ctx.db.city.findMany({ where: { nationId: me.nationId }, orderBy: { id: 'asc' } }),
        ctx.db.general.findMany({ where: { nationId: me.nationId } }),
        ctx.db.logEntry.findMany({
            where: {
                scope: LogScope.NATION,
                category: LogCategory.HISTORY,
                nationId: me.nationId,
            },
            select: { id: true, year: true, month: true, text: true },
            orderBy: { id: 'desc' },
        }),
    ]);
    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }

    const officerCntByCity = new Map<number, number>();
    for (const general of generals) {
        const officerCity = resolveOfficerCity(asRecord(general.meta));
        if (
            general.officerLevel >= 2 &&
            general.officerLevel <= 4 &&
            officerCity > 0 &&
            general.cityId === officerCity
        ) {
            officerCntByCity.set(officerCity, (officerCntByCity.get(officerCity) ?? 0) + 1);
        }
    }

    const incomeContext = await buildNationIncomeContext(nation);
    const incomeCities = cities.map(toIncomeCity);
    const rate = resolveNationRate(nation);
    const bill = resolveNationBill(asRecord(nation.meta));
    const goldCity = getGoldIncome(
        incomeContext,
        incomeCities,
        officerCntByCity,
        nation.capitalCityId ?? 0,
        nation.level
    );
    const goldWar = getWarGoldIncome(incomeContext, incomeCities);
    const riceCity = getRiceIncome(
        incomeContext,
        incomeCities,
        officerCntByCity,
        nation.capitalCityId ?? 0,
        nation.level
    );
    const riceWall = getWallIncome(
        incomeContext,
        incomeCities,
        officerCntByCity,
        nation.capitalCityId ?? 0,
        nation.level
    );
    const outcome = getOutcome(
        bill,
        generals.filter((general) => general.npcState !== 5)
    );
    const population = cities.reduce((sum, city) => sum + city.population, 0);
    const populationMax = cities.reduce((sum, city) => sum + city.populationMax, 0);
    const crewGenerals = generals.filter((general) => general.npcState !== 5);
    const crew = crewGenerals.reduce((sum, general) => sum + general.crew, 0);
    const crewMax = crewGenerals.reduce((sum, general) => sum + general.leadership * 100, 0);
    const meta = asRecord(nation.meta);

    return {
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            power: typeof meta.power === 'number' ? meta.power : 0,
            gold: nation.gold,
            rice: nation.rice,
            tech: Math.floor(nation.tech),
            rate,
            bill,
            capitalCityId: nation.capitalCityId ?? 0,
            generalCount: generals.length,
        },
        population: { current: population, max: populationMax },
        crew: { current: crew, max: crewMax },
        income: {
            goldCity,
            goldWar,
            goldTotal: goldCity + goldWar,
            riceCity,
            riceWall,
            riceTotal: riceCity + riceWall,
            outcome,
        },
        budget: {
            gold: nation.gold + goldCity + goldWar - outcome,
            rice: nation.rice + riceCity + riceWall - outcome,
        },
        cities: cities.map((city) => ({
            id: city.id,
            name: city.name,
            capital: city.id === nation.capitalCityId,
        })),
        history,
    };
});
