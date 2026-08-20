import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';

import { procedure, router } from '../../trpc.js';
import type { LegacyEmperorRow } from '../../services/legacyArchiveStore.js';
import {
    findLegacyEmperor,
    findLegacyEmperorsByProfile,
    findLegacyGeneralsForServer,
    findLegacyNations,
    isLegacyArchiveProfile,
} from '../../services/legacyArchiveStore.js';

const zDynastyDetailInput = z.object({
    emperorId: z.number().int().positive(),
    source: z.enum(['current', 'legacy']).default('current'),
});

const zDynastyListInput = z
    .object({
        source: z.enum(['current', 'legacy']).default('current'),
    })
    .optional();

const parseNumberArray = (value: unknown): number[] =>
    Array.isArray(value)
        ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
        : [];

const parseTextArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const parseDisplayArray = (value: unknown): Array<string | number> =>
    Array.isArray(value)
        ? value.filter(
              (item): item is string | number =>
                  typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item))
          )
        : [];

const parseArchiveRecord = (value: unknown): Record<string, unknown> => {
    if (typeof value === 'string') {
        try {
            return asRecord(JSON.parse(value));
        } catch {
            return {};
        }
    }
    return asRecord(value);
};

const firstFiniteNumber = (...values: unknown[]): number | null => {
    for (const value of values) {
        const parsed = typeof value === 'string' ? Number(value) : value;
        if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    }
    return null;
};

const firstText = (...values: unknown[]): string => {
    for (const value of values) {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
};

const legacyEmperorListEntry = (row: LegacyEmperorRow) => {
    const data = asRecord(row.data);
    return {
        id: Number(row.id),
        source: 'legacy' as const,
        sourceProfile: row.sourceProfile,
        serverId: row.serverId ?? '',
        phase: firstText(data.phase),
        name: firstText(data.name),
        year: firstFiniteNumber(data.year) ?? 0,
        month: firstFiniteNumber(data.month) ?? 0,
        color: firstText(data.color) || '#000000',
        type: firstText(data.type),
        power: firstFiniteNumber(data.power) ?? 0,
        gennum: firstFiniteNumber(data.gennum) ?? 0,
        citynum: firstFiniteNumber(data.citynum) ?? 0,
        l12name: firstText(data.l12name),
        l11name: firstText(data.l11name),
        l10name: firstText(data.l10name),
        l9name: firstText(data.l9name),
        l8name: firstText(data.l8name),
        l7name: firstText(data.l7name),
        l6name: firstText(data.l6name),
        l5name: firstText(data.l5name),
    };
};

const firstDisplayArray = (...values: unknown[]): Array<string | number> => {
    for (const value of values) {
        const parsed = parseDisplayArray(value);
        if (parsed.length > 0 || Array.isArray(value)) return parsed;
    }
    return [];
};

const normalizeOldNationData = (value: unknown) => {
    const data = asRecord(value);
    const aux = parseArchiveRecord(data.aux);
    const meta = asRecord(data.meta);
    const legacyMaxPower = asRecord(meta.max_power);
    const typeCode = typeof data.type === 'string' ? data.type : typeof data.typeCode === 'string' ? data.typeCode : '';

    return {
        data,
        typeCode,
        tech: firstFiniteNumber(data.tech, meta.tech),
        maxPower: firstFiniteNumber(data.maxPower, aux.maxPower, legacyMaxPower.maxPower, data.power),
        maxCrew: firstFiniteNumber(data.maxCrew, aux.maxCrew, legacyMaxPower.maxCrew),
        maxCities: firstDisplayArray(data.maxCities, aux.maxCities, legacyMaxPower.maxCities),
    };
};

const formatNationType = (typeCode: string): string => {
    const separator = typeCode.indexOf('_');
    return separator < 0 ? typeCode : typeCode.slice(separator + 1);
};

const formatNationLevel = (level: number | null): string => {
    if (level === null) {
        return '';
    }
    return ['방랑군', '호족', '군벌', '주자사', '주목', '공', '왕', '황제'][level] ?? String(level);
};

export const dynastyRouter = router({
    getList: procedure.input(zDynastyListInput).query(async ({ ctx, input }) => {
        if ((input?.source ?? 'current') === 'legacy') {
            const rows = isLegacyArchiveProfile(ctx.profile.id)
                ? await findLegacyEmperorsByProfile(ctx.db, ctx.profile.id)
                : [];
            return {
                source: 'legacy' as const,
                current: null,
                entries: rows.map(legacyEmperorListEntry),
            };
        }
        const [worldState, rows] = await Promise.all([
            ctx.db.worldState.findFirst({
                select: {
                    currentYear: true,
                    currentMonth: true,
                },
            }),
            ctx.db.emperor.findMany({
                orderBy: { id: 'desc' },
            }),
        ]);

        return {
            source: 'current' as const,
            current: worldState
                ? {
                      year: worldState.currentYear,
                      month: worldState.currentMonth,
                  }
                : null,
            entries: rows.map((row) => ({
                id: row.id,
                source: 'current' as const,
                sourceProfile: ctx.profile.id,
                serverId: row.serverId ?? '',
                phase: row.phase ?? '',
                name: row.name ?? '',
                year: row.year ?? 0,
                month: row.month ?? 0,
                color: row.color ?? '#000000',
                type: row.type ?? '',
                power: row.power ?? 0,
                gennum: row.gennum ?? 0,
                citynum: row.citynum ?? 0,
                l12name: row.l12name ?? '',
                l11name: row.l11name ?? '',
                l10name: row.l10name ?? '',
                l9name: row.l9name ?? '',
                l8name: row.l8name ?? '',
                l7name: row.l7name ?? '',
                l6name: row.l6name ?? '',
                l5name: row.l5name ?? '',
            })),
        };
    }),
    getDetail: procedure.input(zDynastyDetailInput).query(async ({ ctx, input }) => {
        if (input.source === 'legacy') {
            const archived = isLegacyArchiveProfile(ctx.profile.id)
                ? await findLegacyEmperor(ctx.db, {
                      id: input.emperorId,
                      sourceProfile: ctx.profile.id,
                  })
                : null;
            if (!archived) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '이전 서버 왕조 정보를 찾을 수 없습니다.' });
            }
            const emperor = asRecord(archived.data);
            const aux = asRecord(emperor.aux);
            const winnerNationId = firstFiniteNumber(aux.winnerNationId, aux.winner_nation_id);
            const serverId = archived.serverId ?? '';
            const oldNationRows = serverId
                ? await findLegacyNations(ctx.db, [{ sourceProfile: archived.sourceProfile, serverId }])
                : [];
            const nationEntries = oldNationRows
                .map((row) => {
                    const normalized = normalizeOldNationData(row.data);
                    const { data } = normalized;
                    const nationId = row.nation ?? firstFiniteNumber(data.nation) ?? 0;
                    return {
                        archiveId: row.legacyId,
                        nation: nationId,
                        isWinner: winnerNationId !== null && nationId === winnerNationId,
                        name: typeof data.name === 'string' ? data.name : nationId === 0 ? '재야' : '미상',
                        color: typeof data.color === 'string' ? data.color : '#000000',
                        type: normalized.typeCode,
                        typeName: formatNationType(normalized.typeCode),
                        level: firstFiniteNumber(data.level),
                        tech: normalized.tech,
                        maxPower: normalized.maxPower,
                        maxCrew: normalized.maxCrew,
                        maxCities: normalized.maxCities,
                        generals: parseNumberArray(data.generals),
                        history: parseTextArray(data.history),
                        date: row.archivedAt.toISOString(),
                    };
                })
                .filter((entry) => entry.nation !== 0);
            const generalIds = Array.from(new Set(nationEntries.flatMap((entry) => entry.generals)));
            const generalRows = serverId
                ? await findLegacyGeneralsForServer(ctx.db, {
                      sourceProfile: archived.sourceProfile,
                      serverId,
                      generalNos: generalIds,
                  })
                : [];
            const generalMap = new Map(
                generalRows.map((row) => [row.generalNo, { name: row.name, lastYearMonth: row.lastYearMonth }])
            );
            return {
                source: 'legacy' as const,
                sourceProfile: archived.sourceProfile,
                emperor: {
                    id: Number(archived.id),
                    serverId,
                    winnerNationId,
                    phase: firstText(emperor.phase),
                    nationCount: firstText(emperor.nation_count, emperor.nationCount),
                    nationName: firstText(emperor.nation_name, emperor.nationName),
                    nationHist: firstText(emperor.nation_hist, emperor.nationHist),
                    genCount: firstText(emperor.gen_count, emperor.genCount),
                    personalHist: firstText(emperor.personal_hist, emperor.personalHist),
                    specialHist: firstText(emperor.special_hist, emperor.specialHist),
                    name: firstText(emperor.name),
                    type: firstText(emperor.type),
                    color: firstText(emperor.color) || '#000000',
                    year: firstFiniteNumber(emperor.year) ?? 0,
                    month: firstFiniteNumber(emperor.month) ?? 0,
                    power: firstFiniteNumber(emperor.power) ?? 0,
                    gennum: firstFiniteNumber(emperor.gennum) ?? 0,
                    citynum: firstFiniteNumber(emperor.citynum) ?? 0,
                    pop: firstText(emperor.pop) || '0',
                    poprate: firstText(emperor.poprate),
                    gold: firstFiniteNumber(emperor.gold) ?? 0,
                    rice: firstFiniteNumber(emperor.rice) ?? 0,
                    l12name: firstText(emperor.l12name),
                    l11name: firstText(emperor.l11name),
                    l10name: firstText(emperor.l10name),
                    l9name: firstText(emperor.l9name),
                    l8name: firstText(emperor.l8name),
                    l7name: firstText(emperor.l7name),
                    l6name: firstText(emperor.l6name),
                    l5name: firstText(emperor.l5name),
                    tiger: firstText(emperor.tiger),
                    eagle: firstText(emperor.eagle),
                    gen: firstText(emperor.gen),
                    history: parseTextArray(emperor.history),
                },
                nations: nationEntries.map((entry) => ({
                    ...entry,
                    levelName: formatNationLevel(entry.level),
                    generalsFull: entry.generals.map((id) => ({
                        generalNo: id,
                        name: generalMap.get(id)?.name ?? `#${id}`,
                        lastYearMonth: generalMap.get(id)?.lastYearMonth ?? null,
                    })),
                })),
            };
        }
        const emperor = await ctx.db.emperor.findUnique({
            where: { id: input.emperorId },
        });
        if (!emperor) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '왕조 정보를 찾을 수 없습니다.' });
        }

        const aux = asRecord(emperor.aux);
        const winnerNationId = typeof aux.winnerNationId === 'number' ? aux.winnerNationId : null;
        const serverId = emperor.serverId ?? '';
        const oldNationRows = await ctx.db.oldNation.findMany({
            where: { serverId },
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
        });

        const nationEntries = oldNationRows
            .map((row) => {
                const normalized = normalizeOldNationData(row.data);
                const { data } = normalized;
                const nationId = row.nation ?? (typeof data.nation === 'number' ? data.nation : 0);
                return {
                    archiveId: row.id,
                    nation: nationId,
                    isWinner: winnerNationId !== null && nationId === winnerNationId,
                    name: typeof data.name === 'string' ? data.name : nationId === 0 ? '재야' : '미상',
                    color: typeof data.color === 'string' ? data.color : '#000000',
                    type: normalized.typeCode,
                    typeName: formatNationType(normalized.typeCode),
                    level: typeof data.level === 'number' ? data.level : null,
                    tech: normalized.tech,
                    maxPower: normalized.maxPower,
                    maxCrew: normalized.maxCrew,
                    maxCities: normalized.maxCities,
                    generals: parseNumberArray(data.generals),
                    history: parseTextArray(data.history),
                    date: row.date.toISOString(),
                };
            })
            .filter((entry) => entry.nation !== 0);

        const generalIds = Array.from(new Set(nationEntries.flatMap((entry) => entry.generals)));
        const generalRows = generalIds.length
            ? await ctx.db.oldGeneral.findMany({
                  where: {
                      serverId,
                      generalNo: { in: generalIds },
                  },
                  select: { generalNo: true, name: true, lastYearMonth: true },
              })
            : [];
        const generalMap = new Map<number, { name: string; lastYearMonth: number }>();
        for (const row of generalRows) {
            generalMap.set(row.generalNo, { name: row.name, lastYearMonth: row.lastYearMonth });
        }

        const nations = nationEntries.map((entry) => ({
            ...entry,
            levelName: formatNationLevel(entry.level),
            generalsFull: entry.generals.map((id) => ({
                generalNo: id,
                name: generalMap.get(id)?.name ?? `#${id}`,
                lastYearMonth: generalMap.get(id)?.lastYearMonth ?? null,
            })),
        }));

        return {
            source: 'current' as const,
            sourceProfile: ctx.profile.id,
            emperor: {
                id: emperor.id,
                serverId,
                winnerNationId,
                phase: emperor.phase ?? '',
                nationCount: emperor.nationCount ?? '',
                nationName: emperor.nationName ?? '',
                nationHist: emperor.nationHist ?? '',
                genCount: emperor.genCount ?? '',
                personalHist: emperor.personalHist ?? '',
                specialHist: emperor.specialHist ?? '',
                name: emperor.name ?? '',
                type: emperor.type ?? '',
                color: emperor.color ?? '#000000',
                year: emperor.year ?? 0,
                month: emperor.month ?? 0,
                power: emperor.power ?? 0,
                gennum: emperor.gennum ?? 0,
                citynum: emperor.citynum ?? 0,
                pop: emperor.pop ?? '0',
                poprate: emperor.poprate ?? '',
                gold: emperor.gold ?? 0,
                rice: emperor.rice ?? 0,
                l12name: emperor.l12name ?? '',
                l11name: emperor.l11name ?? '',
                l10name: emperor.l10name ?? '',
                l9name: emperor.l9name ?? '',
                l8name: emperor.l8name ?? '',
                l7name: emperor.l7name ?? '',
                l6name: emperor.l6name ?? '',
                l5name: emperor.l5name ?? '',
                tiger: emperor.tiger ?? '',
                eagle: emperor.eagle ?? '',
                gen: emperor.gen ?? '',
                history: parseTextArray(emperor.history),
            },
            nations,
        };
    }),
});
