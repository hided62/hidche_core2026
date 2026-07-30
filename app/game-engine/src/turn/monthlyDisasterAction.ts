import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import {
    GeneralActionPipeline,
    LogCategory,
    LogFormat,
    LogScope,
    createGeneralTriggerContext,
    type GeneralActionModule,
} from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';

type DisasterText = {
    title: string;
    stateCode: number;
    body: string;
};

const DISASTER_TEXT_BY_MONTH: Readonly<Record<number, DisasterText[]>> = {
    1: [
        { title: '<M><b>【재난】</b></>', stateCode: 4, body: '역병이 발생하여 도시가 황폐해지고 있습니다.' },
        { title: '<M><b>【재난】</b></>', stateCode: 5, body: '지진으로 피해가 속출하고 있습니다.' },
        {
            title: '<M><b>【재난】</b></>',
            stateCode: 3,
            body: '추위가 풀리지 않아 얼어죽는 백성들이 늘어나고 있습니다.',
        },
        { title: '<M><b>【재난】</b></>', stateCode: 9, body: '황건적이 출현해 도시를 습격하고 있습니다.' },
    ],
    4: [
        { title: '<M><b>【재난】</b></>', stateCode: 7, body: '홍수로 인해 피해가 급증하고 있습니다.' },
        { title: '<M><b>【재난】</b></>', stateCode: 5, body: '지진으로 피해가 속출하고 있습니다.' },
        { title: '<M><b>【재난】</b></>', stateCode: 6, body: '태풍으로 인해 피해가 속출하고 있습니다.' },
    ],
    7: [
        { title: '<M><b>【재난】</b></>', stateCode: 8, body: '메뚜기 떼가 발생하여 도시가 황폐해지고 있습니다.' },
        { title: '<M><b>【재난】</b></>', stateCode: 5, body: '지진으로 피해가 속출하고 있습니다.' },
        { title: '<M><b>【재난】</b></>', stateCode: 8, body: '흉년이 들어 굶어죽는 백성들이 늘어나고 있습니다.' },
    ],
    10: [
        { title: '<M><b>【재난】</b></>', stateCode: 3, body: '혹한으로 도시가 황폐해지고 있습니다.' },
        { title: '<M><b>【재난】</b></>', stateCode: 5, body: '지진으로 피해가 속출하고 있습니다.' },
        { title: '<M><b>【재난】</b></>', stateCode: 3, body: '눈이 많이 쌓여 도시가 황폐해지고 있습니다.' },
        { title: '<M><b>【재난】</b></>', stateCode: 9, body: '황건적이 출현해 도시를 습격하고 있습니다.' },
    ],
};

const BOOMING_TEXT_BY_MONTH: Readonly<Partial<Record<number, DisasterText[]>>> = {
    4: [{ title: '<C><b>【호황】</b></>', stateCode: 2, body: '호황으로 도시가 번창하고 있습니다.' }],
    7: [{ title: '<C><b>【풍작】</b></>', stateCode: 1, body: '풍작으로 도시가 번창하고 있습니다.' }],
};

const BOOMING_RATE_BY_MONTH: Readonly<Record<number, number>> = {
    1: 0,
    4: 0.25,
    7: 0.25,
    10: 0,
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const rawSeed = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof rawSeed === 'string' || typeof rawSeed === 'number' ? rawSeed : String(rawSeed);
};

const roundLegacyIntegerColumn = (value: number): number => Math.round(value);

export const createRaiseDisasterHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    generalActionModules?: ReadonlyArray<GeneralActionModule>;
}): MonthlyEventActionHandler => {
    const generalPipeline = new GeneralActionPipeline(options.generalActionModules ?? []);

    return (_args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }

        // 레거시 InnoDB의 PK scan 순서를 명시적으로 고정해 RNG 소비 순서를
        // PostgreSQL의 비결정적 findMany 반환 순서에 맡기지 않는다.
        const cities = world.listCities().sort((left, right) => left.id - right.id);
        // 레거시는 3년 유예 판정보다 먼저 이전 재난 표시를 초기화한다.
        for (const city of cities) {
            if (city.state <= 10) {
                world.updateCity(city.id, { state: 0 });
            }
        }
        if (environment.startyear + 3 > environment.year) {
            return;
        }

        const boomingRate = BOOMING_RATE_BY_MONTH[environment.month];
        if (boomingRate === undefined) {
            throw new Error(`Unsupported month for RaiseDisaster: ${environment.month}`);
        }
        const rng = new RandUtil(
            new LiteHashDRBG(simpleSerialize(resolveHiddenSeed(world), 'disater', environment.year, environment.month))
        );
        const isGood = rng.nextBool(boomingRate);
        const targetCities = cities.filter((city) => {
            if (city.securityMax <= 0) {
                throw new Error(`RaiseDisaster requires positive securityMax (cityId=${city.id})`);
            }
            const securityRatio = city.security / city.securityMax;
            const probability = isGood ? 0.02 + securityRatio * 0.05 : 0.06 - securityRatio * 0.05;
            return rng.nextBool(probability);
        });
        if (targetCities.length === 0) {
            return;
        }

        const textCandidates = isGood
            ? BOOMING_TEXT_BY_MONTH[environment.month]
            : DISASTER_TEXT_BY_MONTH[environment.month];
        if (!textCandidates || textCandidates.length === 0) {
            throw new Error(`RaiseDisaster has no text candidates for month ${environment.month}`);
        }
        const picked = rng.choice(textCandidates);
        const cityNames = targetCities.map((city) => city.name).join(' ');
        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            text: `${picked.title}<G><b>${cityNames}</b></>에 ${picked.body}`,
            format: LogFormat.YEAR_MONTH,
        });

        const allGenerals = world.listGenerals().sort((left, right) => left.id - right.id);
        for (const city of targetCities) {
            const securityRatio = clamp(city.security / city.securityMax / 0.8, 0, 1);
            const affectRatio = isGood ? 1.01 + securityRatio * 0.04 : 0.8 + securityRatio * 0.15;
            const trust = typeof city.meta.trust === 'number' ? city.meta.trust : 0;
            world.updateCity(city.id, {
                state: picked.stateCode,
                population: roundLegacyIntegerColumn(
                    isGood ? Math.min(city.population * affectRatio, city.populationMax) : city.population * affectRatio
                ),
                agriculture: roundLegacyIntegerColumn(
                    isGood
                        ? Math.min(city.agriculture * affectRatio, city.agricultureMax)
                        : city.agriculture * affectRatio
                ),
                commerce: roundLegacyIntegerColumn(
                    isGood ? Math.min(city.commerce * affectRatio, city.commerceMax) : city.commerce * affectRatio
                ),
                security: roundLegacyIntegerColumn(
                    isGood ? Math.min(city.security * affectRatio, city.securityMax) : city.security * affectRatio
                ),
                defence: roundLegacyIntegerColumn(
                    isGood ? Math.min(city.defence * affectRatio, city.defenceMax) : city.defence * affectRatio
                ),
                wall: roundLegacyIntegerColumn(
                    isGood ? Math.min(city.wall * affectRatio, city.wallMax) : city.wall * affectRatio
                ),
                meta: {
                    ...city.meta,
                    trust: isGood ? Math.min(trust * affectRatio, 100) : trust * affectRatio,
                },
            });

            if (isGood) {
                continue;
            }
            for (const general of allGenerals.filter((candidate) => candidate.cityId === city.id)) {
                const context = createGeneralTriggerContext({
                    general,
                    nation: world.getNationById(general.nationId),
                    worldView: {
                        listGenerals: () => allGenerals,
                        listGeneralsByCity: (cityId) => allGenerals.filter((candidate) => candidate.cityId === cityId),
                    },
                    rng,
                });
                const injuryProbability = generalPipeline.onCalcStat(context, 'injuryProb', 0.3);
                if (!rng.nextBool(injuryProbability)) {
                    continue;
                }
                world.pushLog({
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: general.id,
                    text: '<M>재난</>으로 인해 <R>부상</>을 당했습니다.',
                    format: LogFormat.MONTH,
                });
                world.updateGeneral(general.id, {
                    injury: clamp(general.injury + rng.nextRangeInt(1, 16), 0, 80),
                    crew: roundLegacyIntegerColumn(general.crew * 0.98),
                    atmos: roundLegacyIntegerColumn(general.atmos * 0.98),
                    train: roundLegacyIntegerColumn(general.train * 0.98),
                });
            }
        }
    };
};
