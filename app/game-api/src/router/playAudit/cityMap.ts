import { TRPCError } from '@trpc/server';
import { asRecord } from '@sammo-ts/common';
import { z } from 'zod';
import { loadMapLayout, loadMapLayoutByName } from '../../maps/mapLayout.js';
import { auditProcedure, readAudit, readAuditWorld, findAuditMonth, zAuditMonth } from './shared.js';
import { citySelect, projectCurrentCity, zAuditCityData } from './projection.js';

/** 도시 표본 전체를 한 지도 단위로 읽는다. 장수/로그/trace는 읽지 않는다. */
export const cityMap = auditProcedure.input(z.object({ at: zAuditMonth.optional() }).strict()).query(({ ctx, input }) =>
    readAudit(ctx, async (tx) => {
        const world = await readAuditWorld(tx);
        const sample = input.at ? await findAuditMonth(tx, world, input.at) : null;
        if (input.at && !sample)
            return {
                ...world,
                collected: false,
                sample,
                map: null,
                layout: null,
                unmappedCityIds: [],
                nextCursor: null,
            };
        const state = await tx.worldState.findFirst({ orderBy: { id: 'asc' }, select: { config: true } });
        const environment = asRecord(asRecord(state?.config).environment);
        const layout =
            typeof environment.mapName === 'string' && environment.mapName.trim()
                ? await loadMapLayoutByName(environment.mapName)
                : await loadMapLayout(ctx.profile.scenario);
        const cities = sample
            ? (
                  await tx.playAuditCity.findMany({
                      where: { sampleId: sample.id },
                      select: { data: true },
                      take: 1025,
                  })
              ).map((row) => zAuditCityData.parse(row.data))
            : (await tx.city.findMany({ select: citySelect, take: 1025 })).map(projectCurrentCity);
        if (cities.length > 1024)
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: '지도 조회 범위를 초과했습니다. 도시 목록으로 조회해 주세요.',
            });
        const nationIds = [...new Set(cities.map((city) => city.nationId))];
        const identity = z.object({ id: z.number(), name: z.string(), color: z.string() });
        const nations = sample
            ? (
                  await tx.playAuditNation.findMany({
                      where: { sampleId: sample.id, nationId: { in: nationIds } },
                      select: { data: true },
                  })
              ).map((row) => ({ ...identity.parse(row.data), capitalCityId: 0 }))
            : await tx.nation.findMany({
                  where: { id: { in: nationIds } },
                  select: { id: true, name: true, color: true, capitalCityId: true },
              });
        const byCity = new Map(cities.map((city) => [city.id, city]));
        const byNation = new Map(nations.map((nation) => [nation.id, nation]));
        const layoutIds = new Set(layout.cityList.map((city) => city.id));
        // 없는 표본을 무주 도시로 그리지 않는다. 당시 이름과 소유만 사용한다.
        const visibleLayout = {
            ...layout,
            cityList: layout.cityList
                .filter((city) => byCity.has(city.id))
                .map((city) => ({ ...city, name: byCity.get(city.id)!.name })),
        };
        return {
            ...world,
            collected: true,
            sample,
            layout: visibleLayout,
            nextCursor: null,
            unmappedCityIds: cities.filter((city) => !layoutIds.has(city.id)).map((city) => city.id),
            map: {
                year: input.at?.year ?? world.year,
                month: input.at?.month ?? world.month,
                startYear: world.startYear,
                cityList: visibleLayout.cityList.map((layoutCity): [number, number, number, number, number, number] => {
                    const city = byCity.get(layoutCity.id)!;
                    return [city.id, city.level, city.state, city.nationId, layoutCity.region, city.supplyState];
                }),
                nationList: nationIds.map((id): [number, string, string, number] => {
                    const nation = byNation.get(id);
                    return [
                        id,
                        nation?.name ?? (id === 0 ? '무주' : `국가 #${id} (미수집)`),
                        nation?.color ?? '#888888',
                        nation?.capitalCityId ?? 0,
                    ];
                }),
            },
        };
    })
);
