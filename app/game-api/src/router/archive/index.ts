import { asRecord } from '@sammo-ts/common';

import { readOnlyAuthedProcedure, router } from '../../trpc.js';

const numberOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

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
        const [games, nations] = await Promise.all([
            ctx.db.gameHistory.findMany({
                where: { serverId: { in: serverIds } },
            }),
            ctx.db.oldNation.findMany({
                where: { serverId: { in: serverIds } },
                orderBy: [{ date: 'desc' }, { id: 'desc' }],
            }),
        ]);

        const gameByServer = new Map(games.map((game) => [game.serverId, game]));
        const nationByServerAndId = new Map<string, (typeof nations)[number]>();
        for (const nation of nations) {
            const key = `${nation.serverId}:${nation.nation}`;
            if (!nationByServerAndId.has(key)) {
                nationByServerAndId.set(key, nation);
            }
        }

        const seasons = new Map<
            string,
            {
                serverId: string;
                date: string | null;
                season: number | null;
                scenario: number | null;
                scenarioName: string | null;
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
                    personal: string | null;
                    special: string | null;
                    special2: string | null;
                }>;
            }
        >();

        for (const general of generals) {
            const game = gameByServer.get(general.serverId);
            let season = seasons.get(general.serverId);
            if (!season) {
                season = {
                    serverId: general.serverId,
                    date: game?.date.toISOString() ?? null,
                    season: game?.season ?? null,
                    scenario: game?.scenario ?? null,
                    scenarioName: game?.scenarioName ?? null,
                    generals: [],
                };
                seasons.set(general.serverId, season);
            }

            const data = asRecord(general.data);
            const nationId = numberOrNull(data.nation) ?? 0;
            const nation = nationByServerAndId.get(`${general.serverId}:${nationId}`);
            const nationData = asRecord(nation?.data);
            season.generals.push({
                generalNo: general.generalNo,
                name: general.name,
                lastYearMonth: general.lastYearMonth,
                nationId,
                nationName: textOrNull(nationData.name) ?? (nationId === 0 ? '재야' : '미상'),
                nationColor: textOrNull(nationData.color) ?? '#000000',
                leadership: numberOrNull(data.leadership),
                strength: numberOrNull(data.strength),
                intel: numberOrNull(data.intel),
                experience: numberOrNull(data.experience),
                dedication: numberOrNull(data.dedication),
                officerLevel: numberOrNull(data.officer_level),
                personal: textOrNull(data.personal),
                special: textOrNull(data.special),
                special2: textOrNull(data.special2),
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
});
