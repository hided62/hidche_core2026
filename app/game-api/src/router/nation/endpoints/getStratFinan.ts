import { TRPCError } from '@trpc/server';

import { asRecord } from '@sammo-ts/common';
import {
    getGoldIncome,
    getOutcome,
    getRiceIncome,
    getWallIncome,
    getWarGoldIncome,
    type NationIncomeContext,
} from '@sammo-ts/logic';

import { accessAuthedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import {
    assertNationAccess,
    buildNationIncomeContext,
    INC_AVAILABLE_WAR_SETTING_CNT,
    MAX_AVAILABLE_WAR_SETTING_CNT,
    resolveNationBill,
    resolveNationBlockScout,
    resolveNationBlockWar,
    resolveNationNotice,
    resolveNationPermission,
    resolveNationRate,
    resolveNationScoutMessage,
    resolveNationSecretLimit,
    resolveOfficerCity,
    resolveWarSettingRemain,
    toIncomeCity,
    type CityIncomeRow,
    type DiplomacyRow,
    type GeneralPowerRow,
    type NationCountRow,
    type NationIncomeRow,
    type NationStratRow,
} from '../shared.js';

export const getStratFinan = accessAuthedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const [nation, worldState, nationRows, diplomacyRows, generalCounts, cityCounts, cityRows, generalRows] =
        (await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: {
                    id: true,
                    name: true,
                    color: true,
                    level: true,
                    typeCode: true,
                    capitalCityId: true,
                    gold: true,
                    rice: true,
                    tech: true,
                    meta: true,
                },
            }),
            ctx.db.worldState.findFirst(),
            ctx.db.nation.findMany({
                select: {
                    id: true,
                    name: true,
                    color: true,
                    level: true,
                    typeCode: true,
                    capitalCityId: true,
                    gold: true,
                    rice: true,
                    tech: true,
                    meta: true,
                },
                orderBy: { id: 'asc' },
            }),
            ctx.db.diplomacy.findMany({
                where: { srcNationId: me.nationId },
                select: {
                    destNationId: true,
                    stateCode: true,
                    term: true,
                },
            }),
            ctx.db.$queryRaw<NationCountRow[]>`
                SELECT nation_id as "nationId", COUNT(*)::int as "count"
                FROM general
                GROUP BY nation_id
            `,
            ctx.db.$queryRaw<NationCountRow[]>`
                SELECT nation_id as "nationId", COUNT(*)::int as "count"
                FROM city
                GROUP BY nation_id
            `,
            ctx.db.city.findMany({
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
            }),
            ctx.db.general.findMany({
                select: {
                    id: true,
                    nationId: true,
                    cityId: true,
                    npcState: true,
                    officerLevel: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    experience: true,
                    dedication: true,
                    gold: true,
                    rice: true,
                    meta: true,
                },
            }),
        ])) as [
            (NationIncomeRow & { tech: number | null }) | null,
            { currentYear: number; currentMonth: number; tickSeconds: number } | null,
            NationStratRow[],
            DiplomacyRow[],
            NationCountRow[],
            NationCountRow[],
            CityIncomeRow[],
            GeneralPowerRow[],
        ];

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

    const nationMeta = asRecord(nation.meta);
    const editable = me.officerLevel >= 5 || permissionLevel === 4;

    const generalCountMap = new Map<number, number>();
    for (const row of generalCounts) {
        generalCountMap.set(row.nationId, row.count);
    }

    const cityCountMap = new Map<number, number>();
    for (const row of cityCounts) {
        cityCountMap.set(row.nationId, row.count);
    }

    const diplomacyMap = new Map<number, { state: number; term: number | null }>();
    for (const row of diplomacyRows) {
        diplomacyMap.set(row.destNationId, { state: row.stateCode, term: row.term });
    }

    const cityStatsByNation = new Map<number, { popSum: number; valueSum: number; maxSum: number }>();
    for (const city of cityRows) {
        const entry = cityStatsByNation.get(city.nationId) ?? { popSum: 0, valueSum: 0, maxSum: 0 };
        const valueSum = city.population + city.agriculture + city.commerce + city.security + city.wall + city.defence;
        const maxSum =
            city.populationMax +
            city.agricultureMax +
            city.commerceMax +
            city.securityMax +
            city.wallMax +
            city.defenceMax;
        entry.popSum += city.population;
        entry.valueSum += valueSum;
        entry.maxSum += maxSum;
        cityStatsByNation.set(city.nationId, entry);
    }

    const generalStatsByNation = new Map<number, { goldRice: number; statPower: number; expDed: number }>();
    for (const general of generalRows) {
        const entry = generalStatsByNation.get(general.nationId) ?? { goldRice: 0, statPower: 0, expDed: 0 };
        entry.goldRice += general.gold + general.rice;
        const leadership = general.leadership;
        const strength = general.strength;
        const intel = general.intel;
        const npcMultiplier = general.npcState < 2 ? 1.2 : 1;
        const leaderCore = leadership >= 40 ? leadership : 0;
        entry.statPower += npcMultiplier * leaderCore * 2 + (Math.sqrt(intel * strength) * 2 + leadership / 2) / 2;
        entry.expDed += general.experience + general.dedication;
        generalStatsByNation.set(general.nationId, entry);
    }

    const powerByNation = new Map<number, number>();
    for (const nationItem of nationRows) {
        const generalStats = generalStatsByNation.get(nationItem.id) ?? { goldRice: 0, statPower: 0, expDed: 0 };
        const cityStats = cityStatsByNation.get(nationItem.id) ?? { popSum: 0, valueSum: 0, maxSum: 0 };
        const resource = Math.round(((nationItem.gold ?? 0) + (nationItem.rice ?? 0) + generalStats.goldRice) / 100);
        const tech = nationItem.tech ?? 0;
        const cityPower =
            nationItem.level > 0 && cityStats.maxSum > 0
                ? Math.round((cityStats.popSum * cityStats.valueSum) / cityStats.maxSum / 100)
                : 0;
        const expDed = Math.round(generalStats.expDed / 100);
        powerByNation.set(
            nationItem.id,
            Math.round((resource + tech + cityPower + generalStats.statPower + expDed) / 10)
        );
    }

    const nationsList = nationRows
        .filter((nationItem) => nationItem.id > 0)
        .map((nationItem) => {
            const diplomacy =
                nationItem.id === nation.id
                    ? { state: 7, term: null }
                    : (diplomacyMap.get(nationItem.id) ?? { state: 2, term: 0 });
            return {
                id: nationItem.id,
                name: nationItem.name,
                color: nationItem.color,
                level: nationItem.level,
                power: powerByNation.get(nationItem.id) ?? 0,
                generalCount: generalCountMap.get(nationItem.id) ?? 0,
                cityCount: cityCountMap.get(nationItem.id) ?? 0,
                diplomacy,
            };
        });

    const nationCities = cityRows.filter((city) => city.nationId === nation.id);
    const nationGenerals = generalRows.filter((general) => general.nationId === nation.id);

    const officerCntByCity = new Map<number, number>();
    for (const general of nationGenerals) {
        if (general.officerLevel < 2 || general.officerLevel > 4) {
            continue;
        }
        const officerCity = resolveOfficerCity(asRecord(general.meta));
        if (!officerCity || general.cityId !== officerCity) {
            continue;
        }
        officerCntByCity.set(officerCity, (officerCntByCity.get(officerCity) ?? 0) + 1);
    }

    const incomeContext = await buildNationIncomeContext(nation);
    const baseIncomeContext: NationIncomeContext = { ...incomeContext, rate: 100 };
    const incomeCities = nationCities.map(toIncomeCity);
    const goldCityIncome = getGoldIncome(
        baseIncomeContext,
        incomeCities,
        officerCntByCity,
        nation.capitalCityId ?? 0,
        nation.level
    );
    const riceCityIncome = getRiceIncome(
        baseIncomeContext,
        incomeCities,
        officerCntByCity,
        nation.capitalCityId ?? 0,
        nation.level
    );
    const riceWallIncome = getWallIncome(
        baseIncomeContext,
        incomeCities,
        officerCntByCity,
        nation.capitalCityId ?? 0,
        nation.level
    );
    const warGoldIncome = getWarGoldIncome(baseIncomeContext, incomeCities);

    const outcome = getOutcome(
        100,
        nationGenerals.filter((general) => general.npcState !== 5)
    );

    return {
        editable,
        nationMsg: resolveNationNotice(nationMeta),
        scoutMsg: resolveNationScoutMessage(nationMeta),
        nationId: nation.id,
        officerLevel: me.officerLevel,
        year: worldState.currentYear,
        month: worldState.currentMonth,
        nationsList,
        gold: nation.gold ?? 0,
        rice: nation.rice ?? 0,
        income: {
            gold: {
                city: goldCityIncome,
                war: warGoldIncome,
            },
            rice: {
                city: riceCityIncome,
                wall: riceWallIncome,
            },
        },
        outcome,
        policy: {
            rate: resolveNationRate(nation),
            bill: resolveNationBill(nationMeta),
            secretLimit: resolveNationSecretLimit(nationMeta),
            blockScout: resolveNationBlockScout(nationMeta),
            blockWar: resolveNationBlockWar(nationMeta),
        },
        warSettingCnt: {
            remain: resolveWarSettingRemain(nationMeta),
            inc: INC_AVAILABLE_WAR_SETTING_CNT,
            max: MAX_AVAILABLE_WAR_SETTING_CNT,
        },
    };
});
