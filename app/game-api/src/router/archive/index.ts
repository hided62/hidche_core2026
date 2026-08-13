import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';

import { resolveOfficerLevelName, sanitizeInternalDisplayCode } from '../../services/gameDisplayNames.js';
import { readOnlyAuthedProcedure, router } from '../../trpc.js';
import { loadTraitNames } from '../nation/shared.js';

const numberOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const firstNumber = (record: Record<string, unknown>, ...keys: string[]): number | null => {
    for (const key of keys) {
        const value = numberOrNull(record[key]);
        if (value !== null) {
            return value;
        }
    }
    return null;
};

const displayTextOrNull = (value: unknown): string | null => {
    if (typeof value === 'string') {
        return value;
    }
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
};

const parseHistory = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value !== 'string') {
        return [];
    }
    return value
        .split(/<br\s*\/?>/i)
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const zPastPlayDetailInput = z.object({
    serverId: z.string().trim().min(1).max(64),
    generalNo: z.number().int().positive(),
});

export const archiveRouter = router({
    myPastPlays: readOnlyAuthedProcedure.query(async ({ ctx }) => {
        const owner = ctx.auth?.user.id;
        if (!owner) {
            throw new Error('Authenticated archive query is missing its user identity');
        }
        const generals = await ctx.db.oldGeneral.findMany({
            where: { owner },
            orderBy: [{ lastYearMonth: 'desc' }, { serverId: 'desc' }, { generalNo: 'asc' }],
        });
        if (!generals.length) {
            return { seasons: [] };
        }

        const serverIds = [...new Set(generals.map((general) => general.serverId))];
        const [games, nations, emperors] = await Promise.all([
            ctx.db.gameHistory.findMany({
                where: { serverId: { in: serverIds } },
            }),
            ctx.db.oldNation.findMany({
                where: { serverId: { in: serverIds } },
                orderBy: [{ date: 'desc' }, { id: 'desc' }],
            }),
            ctx.db.emperor.findMany({
                where: { serverId: { in: serverIds } },
                orderBy: { id: 'desc' },
                select: { id: true, serverId: true },
            }),
        ]);

        const gameByServer = new Map(games.map((game) => [game.serverId, game]));
        const emperorByServer = new Map<string, number>();
        for (const emperor of emperors) {
            if (emperor.serverId && !emperorByServer.has(emperor.serverId)) {
                emperorByServer.set(emperor.serverId, emperor.id);
            }
        }
        const nationByServerAndId = new Map<string, (typeof nations)[number]>();
        for (const nation of nations) {
            const key = `${nation.serverId}:${nation.nation}`;
            if (!nationByServerAndId.has(key)) {
                nationByServerAndId.set(key, nation);
            }
        }
        const archivedRoles = generals.map((general) => {
            const data = asRecord(general.data);
            const role = asRecord(data.role);
            return {
                personal: displayTextOrNull(data.personalCode ?? data.personal ?? role.personality),
                special: displayTextOrNull(data.specialCode ?? data.special ?? role.specialDomestic),
                special2: displayTextOrNull(data.special2Code ?? data.special2 ?? role.specialWar),
            };
        });
        const [personalityNames, domesticNames, warNames] = await Promise.all([
            loadTraitNames(
                archivedRoles.map((role) => role.personal),
                'personality'
            ),
            loadTraitNames(
                archivedRoles.map((role) => role.special),
                'domestic'
            ),
            loadTraitNames(
                archivedRoles.map((role) => role.special2),
                'war'
            ),
        ]);
        const displayRole = (value: string | null, names: Awaited<ReturnType<typeof loadTraitNames>>): string | null =>
            value ? (names.get(value)?.name ?? sanitizeInternalDisplayCode(value)) : null;

        const seasons = new Map<
            string,
            {
                serverId: string;
                date: string | null;
                season: number | null;
                scenario: number | null;
                scenarioName: string | null;
                dynastyId: number | null;
                generals: Array<{
                    generalNo: number;
                    name: string;
                    lastYearMonth: number;
                    nationId: number;
                    nationName: string;
                    nationColor: string;
                    leadership: number | null;
                    strength: number | null;
                    intel: number | null;
                    experience: number | null;
                    dedication: number | null;
                    officerLevel: number | null;
                    officerLevelText: string | null;
                    personal: string | null;
                    special: string | null;
                    special2: string | null;
                    historyCount: number;
                }>;
            }
        >();

        for (const [generalIndex, general] of generals.entries()) {
            const game = gameByServer.get(general.serverId);
            let season = seasons.get(general.serverId);
            if (!season) {
                season = {
                    serverId: general.serverId,
                    date: game?.date.toISOString() ?? null,
                    season: game?.season ?? null,
                    scenario: game?.scenario ?? null,
                    scenarioName: game?.scenarioName ?? null,
                    dynastyId: emperorByServer.get(general.serverId) ?? null,
                    generals: [],
                };
                seasons.set(general.serverId, season);
            }

            const data = asRecord(general.data);
            const stats = asRecord(data.stats);
            const nationId = firstNumber(data, 'nationId', 'nation') ?? 0;
            const nation = nationByServerAndId.get(`${general.serverId}:${nationId}`);
            const nationData = asRecord(nation?.data);
            const officerLevel = firstNumber(data, 'officerLevel', 'officer_level');
            const nationLevel = firstNumber(nationData, 'level', 'nationLevel');
            const archivedRole = archivedRoles[generalIndex]!;
            season.generals.push({
                generalNo: general.generalNo,
                name: general.name,
                lastYearMonth: general.lastYearMonth,
                nationId,
                nationName: displayTextOrNull(nationData.name) ?? (nationId === 0 ? '재야' : '미상'),
                nationColor: displayTextOrNull(nationData.color) ?? '#000000',
                leadership: firstNumber(data, 'leadership', 'leader') ?? numberOrNull(stats.leadership),
                strength: firstNumber(data, 'strength', 'power') ?? numberOrNull(stats.strength),
                intel: firstNumber(data, 'intel', 'intelligence') ?? numberOrNull(stats.intelligence),
                experience: numberOrNull(data.experience),
                dedication: numberOrNull(data.dedication),
                officerLevel,
                officerLevelText:
                    officerLevel === null
                        ? null
                        : resolveOfficerLevelName(officerLevel, nationLevel === null ? undefined : nationLevel),
                personal: displayRole(archivedRole.personal, personalityNames),
                special: displayRole(archivedRole.special, domesticNames),
                special2: displayRole(archivedRole.special2, warNames),
                historyCount: parseHistory(data.history).length,
            });
        }

        return {
            seasons: [...seasons.values()].sort((left, right) => {
                const leftTime = left.date ? new Date(left.date).getTime() : 0;
                const rightTime = right.date ? new Date(right.date).getTime() : 0;
                return rightTime - leftTime || right.serverId.localeCompare(left.serverId);
            }),
        };
    }),
    myPastPlayDetail: readOnlyAuthedProcedure.input(zPastPlayDetailInput).query(async ({ ctx, input }) => {
        const owner = ctx.auth?.user.id;
        if (!owner) {
            throw new Error('Authenticated archive query is missing its user identity');
        }
        const general = await ctx.db.oldGeneral.findFirst({
            where: {
                owner,
                serverId: input.serverId,
                generalNo: input.generalNo,
            },
        });
        if (!general) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '지난 장수 기록을 찾을 수 없습니다.' });
        }
        const data = asRecord(general.data);
        return {
            serverId: general.serverId,
            generalNo: general.generalNo,
            name: general.name,
            lastYearMonth: general.lastYearMonth,
            history: parseHistory(data.history),
        };
    }),
});
