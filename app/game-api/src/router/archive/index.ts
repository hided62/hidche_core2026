import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
    asRecord,
    normalizeArchivedGeneral,
    type ArchivedGeneralSnapshotV1,
    type ArchivedJsonValue,
} from '@sammo-ts/common';

import {
    loadCrewTypeDisplayNames,
    loadItemDisplayNames,
    resolveDedicationLevelName,
    resolveOfficerLevelName,
    sanitizeInternalDisplayCode,
} from '../../services/gameDisplayNames.js';
import {
    findLegacyEmperors,
    findLegacyGeneral,
    findLegacyGeneralBattleResult,
    findLegacyGeneralsByOwner,
    findLegacyGames,
    findLegacyNations,
    LEGACY_ARCHIVE_PROFILES,
    type LegacyArchiveProfile,
} from '../../services/legacyArchiveStore.js';
import { readOnlyAuthedProcedure, router } from '../../trpc.js';
import { loadTraitNames } from '../nation/shared.js';

const numberOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const textOrNull = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
};

const numericText = (value: string | null): number | null => {
    if (value === null || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const canonicalSnapshot = (value: unknown, fallbackName: string): ArchivedGeneralSnapshotV1 =>
    normalizeArchivedGeneral(value as ArchivedJsonValue, fallbackName).snapshot;

const zPastPlayDetailInput = z.object({
    source: z.enum(['current', 'legacy']).default('current'),
    sourceProfile: z.enum(LEGACY_ARCHIVE_PROFILES).optional(),
    serverId: z.string().trim().min(1).max(64),
    generalNo: z.number().int().positive(),
});

type ArchiveSource = 'current' | 'legacy';

interface GeneralArchiveEntry {
    source: ArchiveSource;
    sourceProfile: string;
    serverId: string;
    generalNo: number;
    name: string;
    lastYearMonth: number;
    turnTime: Date;
    snapshot: ArchivedGeneralSnapshotV1;
}

interface ArchiveNationEntry {
    source: ArchiveSource;
    sourceProfile: string;
    serverId: string;
    nation: number;
    archivedAt: Date;
    data: Record<string, unknown>;
}

const key = (source: ArchiveSource, sourceProfile: string, serverId: string): string =>
    `${source}:${sourceProfile}:${serverId}`;

const nationKey = (source: ArchiveSource, sourceProfile: string, serverId: string, nation: number): string =>
    `${key(source, sourceProfile, serverId)}:${nation}`;

const resolveNation = (
    nations: Map<string, ArchiveNationEntry>,
    entry: GeneralArchiveEntry
): { nationId: number; name: string; color: string; level: number | null } => {
    const nationId = entry.snapshot.identity.nationId ?? 0;
    const archived = nations.get(nationKey(entry.source, entry.sourceProfile, entry.serverId, nationId));
    return {
        nationId,
        name: textOrNull(archived?.data.name) ?? (nationId === 0 ? '재야' : '미상'),
        color: textOrNull(archived?.data.color) ?? '#000000',
        level: numberOrNull(archived?.data.level),
    };
};

const resolveDisplayResources = async (entries: GeneralArchiveEntry[]) => {
    const [personalityNames, domesticNames, warNames, itemNames] = await Promise.all([
        loadTraitNames(
            entries.map((entry) => entry.snapshot.traits.personality),
            'personality'
        ),
        loadTraitNames(
            entries.map((entry) => entry.snapshot.traits.specialDomestic),
            'domestic'
        ),
        loadTraitNames(
            entries.map((entry) => entry.snapshot.traits.specialWar),
            'war'
        ),
        loadItemDisplayNames(
            entries.flatMap((entry) => [
                entry.snapshot.items.horse,
                entry.snapshot.items.weapon,
                entry.snapshot.items.book,
                entry.snapshot.items.item,
            ])
        ),
    ]);
    const traitName = (code: string | null, names: Awaited<ReturnType<typeof loadTraitNames>>): string =>
        code ? (names.get(code)?.name ?? sanitizeInternalDisplayCode(code)) : '-';
    const itemName = (code: string | null): string =>
        code ? (itemNames.get(code) ?? sanitizeInternalDisplayCode(code)) : '-';
    return { personalityNames, domesticNames, warNames, traitName, itemName };
};

const buildGeneralDetail = async (entry: GeneralArchiveEntry, nation: ReturnType<typeof resolveNation>) => {
    const snapshot = entry.snapshot;
    const display = await resolveDisplayResources([entry]);
    const crewTypeId = numericText(snapshot.resources.crewType);
    const crewTypeNames = await loadCrewTypeDisplayNames(null, entry.sourceProfile);
    const dedicationLevel = snapshot.progression.dedicationLevel ?? 0;
    const maxDedicationLevel = 30;
    return {
        id: entry.generalNo,
        name: snapshot.identity.name || entry.name,
        picture: snapshot.identity.picture,
        imageServer: snapshot.identity.imageServer,
        npcState: snapshot.identity.npcState ?? 0,
        officerLevel: snapshot.identity.officerLevel ?? 0,
        officerLevelText: resolveOfficerLevelName(snapshot.identity.officerLevel ?? 0, nation.level ?? undefined),
        stats: {
            leadership: snapshot.stats.leadership ?? 0,
            strength: snapshot.stats.strength ?? 0,
            intelligence: snapshot.stats.intelligence ?? 0,
        },
        gold: snapshot.resources.gold ?? 0,
        rice: snapshot.resources.rice ?? 0,
        crew: snapshot.resources.crew ?? 0,
        train: snapshot.resources.train ?? 0,
        atmos: snapshot.resources.morale ?? 0,
        injury: snapshot.resources.injury ?? 0,
        experience: snapshot.progression.experience ?? 0,
        dedication: snapshot.progression.dedication ?? 0,
        ...(snapshot.progression.age === null ? {} : { age: snapshot.progression.age }),
        turnTime: entry.turnTime.toISOString(),
        ...(crewTypeId === null ? {} : { crewTypeId }),
        crewTypeName: crewTypeId === null ? '-' : (crewTypeNames.get(crewTypeId) ?? '-'),
        traits: {
            personal: display.traitName(snapshot.traits.personality, display.personalityNames),
            specialDomestic: display.traitName(snapshot.traits.specialDomestic, display.domesticNames),
            specialWar: display.traitName(snapshot.traits.specialWar, display.warNames),
        },
        itemNames: {
            horse: display.itemName(snapshot.items.horse),
            weapon: display.itemName(snapshot.items.weapon),
            book: display.itemName(snapshot.items.book),
            item: display.itemName(snapshot.items.item),
        },
        progression: {
            experienceLevel: snapshot.progression.experienceLevel ?? 0,
            dedicationLevel,
            dedicationText: resolveDedicationLevelName(dedicationLevel, maxDedicationLevel),
            statExperience: {
                leadership: snapshot.stats.leadershipExperience ?? 0,
                strength: snapshot.stats.strengthExperience ?? 0,
                intelligence: snapshot.stats.intelligenceExperience ?? 0,
            },
            statUpgradeLimit: 30,
            dex: [
                snapshot.mastery.infantry,
                snapshot.mastery.archery,
                snapshot.mastery.cavalry,
                snapshot.mastery.special,
                snapshot.mastery.siege,
            ].map((value) => value ?? 0),
        },
    };
};

export const archiveRouter = router({
    myPastPlays: readOnlyAuthedProcedure.query(async ({ ctx }) => {
        const owner = ctx.auth?.user.id;
        if (!owner) throw new Error('Authenticated archive query is missing its user identity');

        const [legacyRows, currentRows] = await Promise.all([
            findLegacyGeneralsByOwner(ctx.db, owner),
            ctx.db.oldGeneral.findMany({
                where: { owner },
                orderBy: [{ lastYearMonth: 'desc' }, { serverId: 'desc' }, { generalNo: 'asc' }],
            }),
        ]);
        const legacyIdentity = new Set(
            legacyRows.map((row) => `${row.sourceProfile}:${row.serverId}:${row.generalNo}`)
        );
        const entries: GeneralArchiveEntry[] = [
            ...legacyRows.map((row) => ({
                source: 'legacy' as const,
                sourceProfile: row.sourceProfile,
                serverId: row.serverId,
                generalNo: row.generalNo,
                name: row.name,
                lastYearMonth: row.lastYearMonth,
                turnTime: row.turnTime,
                snapshot: canonicalSnapshot(row.data, row.name),
            })),
            ...currentRows
                .filter((row) => !legacyIdentity.has(`${ctx.profile.id}:${row.serverId}:${row.generalNo}`))
                .map((row) => ({
                    source: 'current' as const,
                    sourceProfile: ctx.profile.id,
                    serverId: row.serverId,
                    generalNo: row.generalNo,
                    name: row.name,
                    lastYearMonth: row.lastYearMonth,
                    turnTime: row.turnTime,
                    snapshot: canonicalSnapshot(row.data, row.name),
                })),
        ];
        if (entries.length === 0) return { seasons: [] };

        const legacyKeys = Array.from(
            new Map(
                entries
                    .filter((entry) => entry.source === 'legacy')
                    .map((entry) => [key(entry.source, entry.sourceProfile, entry.serverId), entry])
            ).values()
        ).map((entry) => ({ sourceProfile: entry.sourceProfile as LegacyArchiveProfile, serverId: entry.serverId }));
        const currentServerIds = Array.from(
            new Set(entries.filter((entry) => entry.source === 'current').map((entry) => entry.serverId))
        );
        const [legacyGames, legacyNationRows, legacyEmperors, currentGames, currentNationRows, currentEmperors] =
            await Promise.all([
                findLegacyGames(ctx.db, legacyKeys),
                findLegacyNations(ctx.db, legacyKeys),
                findLegacyEmperors(ctx.db, legacyKeys),
                currentServerIds.length
                    ? ctx.db.gameHistory.findMany({ where: { serverId: { in: currentServerIds } } })
                    : [],
                currentServerIds.length
                    ? ctx.db.oldNation.findMany({
                          where: { serverId: { in: currentServerIds } },
                          orderBy: [{ date: 'desc' }, { id: 'desc' }],
                      })
                    : [],
                currentServerIds.length
                    ? ctx.db.emperor.findMany({
                          where: { serverId: { in: currentServerIds } },
                          orderBy: { id: 'desc' },
                          select: { id: true, serverId: true },
                      })
                    : [],
            ]);

        const games = new Map<string, { openedAt: Date; season: number; scenario: number; scenarioName: string }>();
        for (const row of legacyGames) {
            games.set(key('legacy', row.sourceProfile, row.serverId), row);
        }
        for (const row of currentGames) {
            games.set(key('current', ctx.profile.id, row.serverId), {
                openedAt: row.date,
                season: row.season,
                scenario: row.scenario,
                scenarioName: row.scenarioName,
            });
        }
        const nations = new Map<string, ArchiveNationEntry>();
        for (const row of legacyNationRows) {
            const entry: ArchiveNationEntry = {
                source: 'legacy',
                sourceProfile: row.sourceProfile,
                serverId: row.serverId,
                nation: row.nation,
                archivedAt: row.archivedAt,
                data: asRecord(row.data),
            };
            const entryKey = nationKey(entry.source, entry.sourceProfile, entry.serverId, entry.nation);
            if (!nations.has(entryKey)) nations.set(entryKey, entry);
        }
        for (const row of currentNationRows) {
            const entry: ArchiveNationEntry = {
                source: 'current',
                sourceProfile: ctx.profile.id,
                serverId: row.serverId,
                nation: row.nation,
                archivedAt: row.date,
                data: asRecord(row.data),
            };
            const entryKey = nationKey(entry.source, entry.sourceProfile, entry.serverId, entry.nation);
            if (!nations.has(entryKey)) nations.set(entryKey, entry);
        }
        const dynastyIds = new Map<string, number>();
        for (const row of legacyEmperors) {
            if (row.serverId) {
                const entryKey = key('legacy', row.sourceProfile, row.serverId);
                if (!dynastyIds.has(entryKey)) dynastyIds.set(entryKey, Number(row.id));
            }
        }
        for (const row of currentEmperors) {
            if (row.serverId) {
                const entryKey = key('current', ctx.profile.id, row.serverId);
                if (!dynastyIds.has(entryKey)) dynastyIds.set(entryKey, row.id);
            }
        }

        const display = await resolveDisplayResources(entries);
        const seasons = new Map<
            string,
            {
                source: ArchiveSource;
                sourceProfile: string;
                serverId: string;
                openedAt: string | null;
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
        for (const entry of entries) {
            const entryKey = key(entry.source, entry.sourceProfile, entry.serverId);
            const game = games.get(entryKey);
            let season = seasons.get(entryKey);
            if (!season) {
                const openedAt = game?.openedAt.toISOString() ?? null;
                season = {
                    source: entry.source,
                    sourceProfile: entry.sourceProfile,
                    serverId: entry.serverId,
                    openedAt,
                    date: openedAt,
                    season: game?.season ?? null,
                    scenario: game?.scenario ?? null,
                    scenarioName: game?.scenarioName ?? null,
                    dynastyId: dynastyIds.get(entryKey) ?? null,
                    generals: [],
                };
                seasons.set(entryKey, season);
            }
            const snapshot = entry.snapshot;
            const nation = resolveNation(nations, entry);
            const officerLevel = snapshot.identity.officerLevel;
            season.generals.push({
                generalNo: entry.generalNo,
                name: snapshot.identity.name || entry.name,
                lastYearMonth: entry.lastYearMonth,
                nationId: nation.nationId,
                nationName: nation.name,
                nationColor: nation.color,
                leadership: snapshot.stats.leadership,
                strength: snapshot.stats.strength,
                intel: snapshot.stats.intelligence,
                experience: snapshot.progression.experience,
                dedication: snapshot.progression.dedication,
                officerLevel,
                officerLevelText:
                    officerLevel === null ? null : resolveOfficerLevelName(officerLevel, nation.level ?? undefined),
                personal: display.traitName(snapshot.traits.personality, display.personalityNames),
                special: display.traitName(snapshot.traits.specialDomestic, display.domesticNames),
                special2: display.traitName(snapshot.traits.specialWar, display.warNames),
                historyCount: snapshot.history.length,
            });
        }

        return {
            seasons: [...seasons.values()].sort((left, right) => {
                const leftTime = left.openedAt ? new Date(left.openedAt).getTime() : 0;
                const rightTime = right.openedAt ? new Date(right.openedAt).getTime() : 0;
                return rightTime - leftTime || right.serverId.localeCompare(left.serverId);
            }),
        };
    }),

    myPastPlayDetail: readOnlyAuthedProcedure.input(zPastPlayDetailInput).query(async ({ ctx, input }) => {
        const owner = ctx.auth?.user.id;
        if (!owner) throw new Error('Authenticated archive query is missing its user identity');
        const sourceProfile = input.sourceProfile ?? ctx.profile.id;
        if (input.source === 'current' && sourceProfile !== ctx.profile.id) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '지난 장수 기록을 찾을 수 없습니다.' });
        }

        let entry: GeneralArchiveEntry | null = null;
        let nationRows: ArchiveNationEntry[] = [];
        let dynastyId: number | null = null;
        let battleResultContent: string | null = null;
        let battleResultAvailable = false;
        if (input.source === 'legacy') {
            if (!LEGACY_ARCHIVE_PROFILES.includes(sourceProfile as LegacyArchiveProfile)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '지원하지 않는 이전 서버 프로필입니다.' });
            }
            const profile = sourceProfile as LegacyArchiveProfile;
            const row = await findLegacyGeneral(ctx.db, {
                owner,
                sourceProfile: profile,
                serverId: input.serverId,
                generalNo: input.generalNo,
            });
            if (row) {
                entry = {
                    source: 'legacy',
                    sourceProfile: row.sourceProfile,
                    serverId: row.serverId,
                    generalNo: row.generalNo,
                    name: row.name,
                    lastYearMonth: row.lastYearMonth,
                    turnTime: row.turnTime,
                    snapshot: canonicalSnapshot(row.data, row.name),
                };
                const keyInput = [{ sourceProfile: profile, serverId: input.serverId }];
                const [nations, emperors, battleResult] = await Promise.all([
                    findLegacyNations(ctx.db, keyInput),
                    findLegacyEmperors(ctx.db, keyInput),
                    findLegacyGeneralBattleResult(ctx.db, {
                        sourceProfile: profile,
                        serverId: input.serverId,
                        generalNo: input.generalNo,
                    }),
                ]);
                nationRows = nations.map((nation) => ({
                    source: 'legacy',
                    sourceProfile: nation.sourceProfile,
                    serverId: nation.serverId,
                    nation: nation.nation,
                    archivedAt: nation.archivedAt,
                    data: asRecord(nation.data),
                }));
                dynastyId = Number(emperors[0]?.id ?? 0) || null;
                battleResultContent = battleResult?.content ?? null;
                battleResultAvailable = battleResult !== null;
            }
        } else {
            const row = await ctx.db.oldGeneral.findFirst({
                where: { owner, serverId: input.serverId, generalNo: input.generalNo },
            });
            if (row) {
                entry = {
                    source: 'current',
                    sourceProfile: ctx.profile.id,
                    serverId: row.serverId,
                    generalNo: row.generalNo,
                    name: row.name,
                    lastYearMonth: row.lastYearMonth,
                    turnTime: row.turnTime,
                    snapshot: canonicalSnapshot(row.data, row.name),
                };
                const [nations, emperor] = await Promise.all([
                    ctx.db.oldNation.findMany({
                        where: { serverId: input.serverId },
                        orderBy: [{ date: 'desc' }, { id: 'desc' }],
                    }),
                    ctx.db.emperor.findFirst({ where: { serverId: input.serverId }, orderBy: { id: 'desc' } }),
                ]);
                nationRows = nations.map((nation) => ({
                    source: 'current',
                    sourceProfile: ctx.profile.id,
                    serverId: nation.serverId,
                    nation: nation.nation,
                    archivedAt: nation.date,
                    data: asRecord(nation.data),
                }));
                dynastyId = emperor?.id ?? null;
            }
        }
        if (!entry) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '지난 장수 기록을 찾을 수 없습니다.' });
        }

        const nationMap = new Map<string, ArchiveNationEntry>();
        for (const nation of nationRows) {
            const entryKey = nationKey(nation.source, nation.sourceProfile, nation.serverId, nation.nation);
            if (!nationMap.has(entryKey)) nationMap.set(entryKey, nation);
        }
        const nation = resolveNation(nationMap, entry);
        const snapshot = entry.snapshot;
        const general = await buildGeneralDetail(entry, nation);
        const battleResultEntries = (battleResultContent ?? '')
            .split(/\r?\n/u)
            .map((text, index) => ({ id: index + 1, text }))
            .filter((item) => item.text.length > 0)
            .reverse();
        const logs = {
            generalHistory: {
                available: snapshot.availability.history,
                entries: snapshot.history.map((text, index) => ({ id: index + 1, text })),
            },
            battleDetail: { available: snapshot.availability.battleDetailLogs, entries: [] },
            battleResult: { available: battleResultAvailable, entries: battleResultEntries },
            generalAction: { available: false, entries: [] },
        };
        return {
            source: entry.source,
            sourceProfile: entry.sourceProfile,
            serverId: entry.serverId,
            generalNo: entry.generalNo,
            sourceFormat: input.source === 'legacy' ? 'normalized-v1' : 'current-archive',
            dynastyPath:
                dynastyId === null ? null : `/dynasty/${dynastyId}${entry.source === 'legacy' ? '?source=legacy' : ''}`,
            nation: { id: nation.nationId, name: nation.name, color: nation.color },
            general,
            masteryAvailable: snapshot.availability.mastery,
            battle: {
                available: snapshot.availability.battleAggregates,
                warnum: snapshot.battle.battles,
                wins: snapshot.battle.wins,
                losses: snapshot.battle.losses,
                strategies: snapshot.battle.fireSuccesses,
                killCrew: snapshot.battle.killedCrew,
                deathCrew: snapshot.battle.lostCrew,
                winRate: snapshot.battle.winRate,
                killRate: snapshot.battle.killRate,
                recentWar: snapshot.battle.recentWar,
            },
            logs,
        };
    }),
});
