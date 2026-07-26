import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { type WorldStateRow, zWorldStateConfig, zWorldStateMeta } from '../../context.js';
import { procedure, router } from '../../trpc.js';
import { authedProcedure } from '../../trpc.js';
import { asRecord, isRecord } from '@sammo-ts/common';
import { loadWorldMap } from '../../maps/worldMap.js';
import { loadMapLayout } from '../../maps/mapLayout.js';
import { getMyGeneral, getOwnedGeneral } from '../shared/general.js';
import { getGeneralDirectory, getNationDirectory } from './directory.js';

const isWorldAdmin = (roles: readonly string[]): boolean =>
    roles.some((role) => role === 'superuser' || role === 'admin' || role === 'admin.superuser');

const numberRecord = (value: unknown): Record<number, number> => {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, item]) => [Number(key), typeof item === 'number' ? item : Number.NaN] as const)
            .filter(([key, item]) => Number.isFinite(key) && Number.isFinite(item))
    );
};

const officerCity = (meta: unknown): number => {
    const value = asRecord(meta);
    const raw = value.officerCity ?? value.officer_city;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
};

const defenceTrain = (meta: unknown): number => {
    const value = asRecord(meta);
    const raw = value.defenceTrain ?? value.defence_train;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
};

const toWorldStateSnapshot = (row: WorldStateRow) => ({
    scenarioCode: row.scenarioCode,
    currentYear: row.currentYear,
    currentMonth: row.currentMonth,
    tickSeconds: row.tickSeconds,
    config: zWorldStateConfig.parse(row.config),
    meta: zWorldStateMeta.parse(row.meta),
    updatedAt: row.updatedAt.toISOString(),
});

export const worldRouter = router({
    getNationDirectory,
    getGeneralDirectory,
    getGlobalInfo: authedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        const [nations, cities, diplomacy, map] = await Promise.all([
            ctx.db.nation.findMany({ where: { level: { gt: 0 } } }),
            ctx.db.city.findMany({ orderBy: { id: 'asc' } }),
            ctx.db.diplomacy.findMany({ where: { isDead: false, isShowing: true } }),
            loadWorldMap(ctx, { generalId: me.id, neutralView: false, showMe: true }),
        ]);
        if (!map) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
        }
        const nationRows = nations
            .map((nation) => ({
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId ?? 0,
                level: nation.level,
                power: typeof asRecord(nation.meta).power === 'number' ? Number(asRecord(nation.meta).power) : 0,
                cities: cities.filter((city) => city.nationId === nation.id).map((city) => city.name),
            }))
            .sort((left, right) => right.power - left.power || left.id - right.id);
        const matrix: Record<number, Record<number, number>> = {};
        for (const nation of nationRows) {
            matrix[nation.id] = {};
            for (const other of nationRows) matrix[nation.id]![other.id] = 2;
        }
        for (const relation of diplomacy) {
            if (!matrix[relation.srcNationId]) continue;
            const related = relation.srcNationId === me.nationId || relation.destNationId === me.nationId;
            matrix[relation.srcNationId]![relation.destNationId] = related
                ? relation.stateCode
                : [3, 4, 5, 6, 7].includes(relation.stateCode)
                  ? 2
                  : relation.stateCode;
        }
        const conflict = cities.flatMap((city) => {
            const raw = numberRecord(city.conflict);
            const entries = Object.entries(raw);
            if (entries.length < 2) return [];
            const sum = entries.reduce((total, [, value]) => total + value, 0);
            if (sum <= 0) return [];
            return [
                {
                    cityId: city.id,
                    cityName: city.name,
                    nations: Object.fromEntries(
                        entries.map(([id, value]) => [id, Math.round((value * 1000) / sum) / 10])
                    ),
                },
            ];
        });
        return { myNationId: me.nationId, nations: nationRows, diplomacy: matrix, conflict, map };
    }),
    getCurrentCity: authedProcedure
        .input(z.object({ cityId: z.number().int().positive().optional() }).optional())
        .query(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            const admin = isWorldAdmin(ctx.auth?.user.roles ?? []);
            const [cities, nation, nationGenerals, nations, world, layout] = await Promise.all([
                ctx.db.city.findMany({ orderBy: { id: 'asc' } }),
                me.nationId > 0 ? ctx.db.nation.findUnique({ where: { id: me.nationId } }) : null,
                me.nationId > 0
                    ? ctx.db.general.findMany({ where: { nationId: me.nationId }, select: { cityId: true } })
                    : [],
                ctx.db.nation.findMany(),
                ctx.db.worldState.findFirst(),
                loadMapLayout(ctx.profile.scenario),
            ]);
            const cityById = new Map(cities.map((city) => [city.id, city]));
            const requested = input?.cityId && cityById.has(input.cityId) ? input.cityId : me.cityId;
            const selected = cityById.get(requested);
            if (!selected) throw new TRPCError({ code: 'NOT_FOUND', message: 'City not found' });
            const spy = numberRecord(asRecord(nation?.meta).spyList ?? asRecord(nation?.meta).spy);
            const selectable = new Set<number>([me.cityId]);
            if (me.officerLevel > 0 && me.nationId > 0) {
                cities.filter((city) => city.nationId === me.nationId).forEach((city) => selectable.add(city.id));
                nationGenerals.forEach((general) => selectable.add(general.cityId));
                Object.keys(spy).forEach((id) => selectable.add(Number(id)));
            }
            if (admin) cities.forEach((city) => selectable.add(city.id));
            const full = admin || selectable.has(selected.id);
            const ownCities = new Set(
                cities.filter((city) => city.nationId === me.nationId && me.nationId > 0).map((city) => city.id)
            );
            const layoutCity = layout.cityList.find((city) => city.id === selected.id);
            const detailed = full || Boolean(layoutCity?.path.some((id) => ownCities.has(id)));
            const generals = detailed
                ? await ctx.db.general.findMany({ where: { cityId: selected.id }, orderBy: { turnTime: 'asc' } })
                : [];
            const generalIds = generals
                .filter((general) => general.nationId === me.nationId && general.npcState <= 1)
                .map((general) => general.id);
            const turns = generalIds.length
                ? await ctx.db.generalTurn.findMany({
                      where: { generalId: { in: generalIds }, turnIdx: { lt: 5 } },
                      orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
                  })
                : [];
            const turnMap = new Map<number, string[]>();
            for (const turn of turns) {
                const list = turnMap.get(turn.generalId) ?? [];
                list[turn.turnIdx] = turn.actionCode;
                turnMap.set(turn.generalId, list);
            }
            const nationMap = new Map(nations.map((item) => [item.id, item]));
            const officers = await ctx.db.general.findMany({
                where: { officerLevel: { in: [2, 3, 4] } },
                select: { name: true, officerLevel: true, meta: true },
            });
            const selectedOfficers = Object.fromEntries(
                officers
                    .filter((item) => officerCity(item.meta) === selected.id)
                    .map((item) => [item.officerLevel, item.name])
            );
            const redact = <T>(value: T): T | null => (full ? value : null);
            const mappedGenerals = generals.map((general) => {
                const ours = admin || (me.nationId > 0 && general.nationId === me.nationId);
                return {
                    id: general.id,
                    name: general.name,
                    npcState: general.npcState,
                    picture: general.picture,
                    imageServer: general.imageServer,
                    nationId: general.nationId,
                    nationName: nationMap.get(general.nationId)?.name ?? '재야',
                    leadership: general.leadership,
                    strength: general.strength,
                    intelligence: general.intel,
                    injury: general.injury,
                    officerLevel: general.officerLevel,
                    defenceTrain: ours ? defenceTrain(general.meta) : null,
                    crewTypeId: ours ? general.crewTypeId : null,
                    crew: ours || full ? general.crew : null,
                    train: ours ? general.train : null,
                    atmos: ours ? general.atmos : null,
                    turns: ours && general.npcState <= 1 ? (turnMap.get(general.id) ?? []) : [],
                };
            });
            return {
                me: { id: me.id, nationId: me.nationId, officerLevel: me.officerLevel, admin },
                options: [...selectable]
                    .map((id) => cityById.get(id))
                    .filter((city): city is NonNullable<typeof city> => Boolean(city))
                    .map((city) => ({ id: city.id, name: city.name, nationId: city.nationId })),
                visibility: { full, detailed },
                city: {
                    id: selected.id,
                    name: selected.name,
                    nationId: selected.nationId,
                    level: selected.level,
                    region: selected.region,
                    population: redact(selected.population),
                    populationMax: selected.populationMax,
                    agriculture: redact(selected.agriculture),
                    agricultureMax: selected.agricultureMax,
                    commerce: redact(selected.commerce),
                    commerceMax: selected.commerceMax,
                    security: redact(selected.security),
                    securityMax: selected.securityMax,
                    trust: redact(selected.trust),
                    trade: selected.trade,
                    defence: full || selected.nationId === 0 ? selected.defence : null,
                    defenceMax: selected.defenceMax,
                    wall: full || selected.nationId === 0 ? selected.wall : null,
                    wallMax: selected.wallMax,
                    officers: {
                        4: selectedOfficers[4] ?? '-',
                        3: selectedOfficers[3] ?? '-',
                        2: selectedOfficers[2] ?? '-',
                    },
                },
                generals: mappedGenerals,
                lastExecute:
                    typeof asRecord(world?.meta).turntime === 'string' ? String(asRecord(world?.meta).turntime) : '',
            };
        }),
    getState: procedure.query(async ({ ctx }) => {
        const state = await ctx.db.worldState.findFirst();
        return state ? toWorldStateSnapshot(state) : null;
    }),
    getMapLayout: procedure.query(async ({ ctx }) => {
        return loadMapLayout(ctx.profile.scenario);
    }),
    getMap: procedure
        .input(
            z.object({
                generalId: z.number().int().positive().optional(),
                neutralView: z.boolean().optional(),
                showMe: z.boolean().optional(),
                useCache: z.boolean().optional(),
            })
        )
        .query(async ({ ctx, input }) => {
            if (input.generalId !== undefined) {
                await getOwnedGeneral(ctx, input.generalId);
            }
            const map = await loadWorldMap(ctx, input);
            if (!map) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: 'World state is not initialized.',
                });
            }
            return map;
        }),
});
