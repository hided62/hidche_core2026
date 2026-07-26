import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';

import { procedure, router } from '../../trpc.js';

const zDynastyDetailInput = z.object({
    emperorId: z.number().int().positive(),
});

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
    getList: procedure.query(async ({ ctx }) => {
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
            current: worldState
                ? {
                      year: worldState.currentYear,
                      month: worldState.currentMonth,
                  }
                : null,
            entries: rows.map((row) => ({
                id: row.id,
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
            orderBy: { date: 'desc' },
        });

        const nationEntries = oldNationRows
            .map((row) => {
                const data = asRecord(row.data);
                const nationId = row.nation ?? (typeof data.nation === 'number' ? data.nation : 0);
                const typeCode = typeof data.type === 'string' ? data.type : '';
                return {
                    nation: nationId,
                    isWinner: winnerNationId !== null && nationId === winnerNationId,
                    name: typeof data.name === 'string' ? data.name : nationId === 0 ? '재야' : '미상',
                    color: typeof data.color === 'string' ? data.color : '#000000',
                    type: typeCode,
                    typeName: formatNationType(typeCode),
                    level: typeof data.level === 'number' ? data.level : null,
                    tech: typeof data.tech === 'number' ? data.tech : null,
                    maxPower:
                        typeof data.maxPower === 'number'
                            ? data.maxPower
                            : typeof data.power === 'number'
                              ? data.power
                              : null,
                    maxCrew: typeof data.maxCrew === 'number' ? data.maxCrew : null,
                    maxCities: parseDisplayArray(data.maxCities),
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
