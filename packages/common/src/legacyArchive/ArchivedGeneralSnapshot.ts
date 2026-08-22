export type ArchivedJsonValue =
    null | boolean | number | string | ArchivedJsonValue[] | { [key: string]: ArchivedJsonValue };

export const ARCHIVED_GENERAL_SCHEMA_VERSION = 1 as const;

export const LEGACY_ARCHIVE_PROFILES = ['che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe'] as const;
export type LegacyArchiveProfile = (typeof LEGACY_ARCHIVE_PROFILES)[number];

export const isLegacyArchiveProfile = (value: string): value is LegacyArchiveProfile =>
    (LEGACY_ARCHIVE_PROFILES as readonly string[]).includes(value);

export type ArchivedGeneralSourceFormat = 'legacy-flat-v0' | 'ref-flat-v1' | 'core-snapshot-v1' | 'unknown';

export interface ArchivedGeneralSnapshotV1 {
    schemaVersion: typeof ARCHIVED_GENERAL_SCHEMA_VERSION;
    identity: {
        name: string;
        picture: string | null;
        imageServer: number | null;
        npcState: number | null;
        nationId: number | null;
        cityId: number | null;
        officerLevel: number | null;
        officerCity: number | null;
    };
    stats: {
        leadership: number | null;
        strength: number | null;
        intelligence: number | null;
        leadershipExperience: number | null;
        strengthExperience: number | null;
        intelligenceExperience: number | null;
    };
    progression: {
        experience: number | null;
        experienceLevel: number | null;
        dedication: number | null;
        dedicationLevel: number | null;
        age: number | null;
        startAge: number | null;
        bornYear: number | null;
        deadYear: number | null;
    };
    traits: {
        personality: string | null;
        specialDomestic: string | null;
        specialWar: string | null;
    };
    resources: {
        gold: number | null;
        rice: number | null;
        crew: number | null;
        crewType: string | null;
        train: number | null;
        morale: number | null;
        injury: number | null;
    };
    items: {
        horse: string | null;
        weapon: string | null;
        book: string | null;
        item: string | null;
    };
    mastery: {
        infantry: number | null;
        archery: number | null;
        cavalry: number | null;
        special: number | null;
        siege: number | null;
    };
    battle: {
        battles: number | null;
        wins: number | null;
        losses: number | null;
        fireSuccesses: number | null;
        kills: number | null;
        deaths: number | null;
        killedCrew: number | null;
        lostCrew: number | null;
        winRate: number | null;
        killRate: number | null;
        recentWar: string | null;
        tactics: {
            total: { wins: number | null; draws: number | null; losses: number | null };
            leadership: { wins: number | null; draws: number | null; losses: number | null };
            intelligence: { wins: number | null; draws: number | null; losses: number | null };
        };
    };
    history: string[];
    records: {
        /** Newest first, matching the live battle-result panel. */
        battleResult: string[];
    };
    availability: {
        mastery: boolean;
        battleAggregates: boolean;
        tactics: boolean;
        history: boolean;
        battleDetailLogs: false;
        battleResultLogs: boolean;
    };
}

type JsonRecord = Record<string, ArchivedJsonValue | undefined>;

const asRecord = (value: ArchivedJsonValue | undefined): JsonRecord =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};

const finiteNumber = (value: ArchivedJsonValue | undefined): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const firstNumber = (...values: Array<ArchivedJsonValue | undefined>): number | null => {
    for (const value of values) {
        const parsed = finiteNumber(value);
        if (parsed !== null) return parsed;
    }
    return null;
};

const text = (value: ArchivedJsonValue | undefined): string | null => {
    if (typeof value === 'string') return value.trim() === '' ? null : value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
};

const firstText = (...values: Array<ArchivedJsonValue | undefined>): string | null => {
    for (const value of values) {
        const parsed = text(value);
        if (parsed !== null) return parsed;
    }
    return null;
};

const historyLines = (value: ArchivedJsonValue | undefined): string[] => {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value !== 'string') return [];
    return value
        .split(/<br\s*\/?>/iu)
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const recordLines = (value: ArchivedJsonValue | undefined): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
};

const rate = (numerator: number | null, denominator: number | null): number | null =>
    numerator === null || denominator === null || denominator <= 0
        ? null
        : Math.round((numerator / denominator) * 10_000) / 100;

export const detectArchivedGeneralSourceFormat = (raw: ArchivedJsonValue): ArchivedGeneralSourceFormat => {
    const data = asRecord(raw);
    if (Object.keys(asRecord(data.stats)).length > 0 || data.schemaVersion === 1) return 'core-snapshot-v1';
    if ('leadership' in data || 'strength' in data || 'dex1' in data) return 'ref-flat-v1';
    if ('leader' in data || 'power' in data || 'dex0' in data) return 'legacy-flat-v0';
    return 'unknown';
};

export const normalizeArchivedGeneral = (
    raw: ArchivedJsonValue,
    fallbackName: string
): { sourceFormat: ArchivedGeneralSourceFormat; snapshot: ArchivedGeneralSnapshotV1 } => {
    const data = asRecord(raw);
    const identity = asRecord(data.identity);
    const stats = asRecord(data.stats);
    const role = asRecord(data.role);
    const items = asRecord(data.items);
    const progression = asRecord(data.progression);
    const traits = asRecord(data.traits);
    const resources = asRecord(data.resources);
    const meta = asRecord(data.meta);
    const nestedMastery = asRecord(data.mastery);
    const nestedBattle = asRecord(data.battle);
    const nestedRecords = asRecord(data.records);
    const storedAvailability = asRecord(data.availability);
    const nestedTactics = asRecord(nestedBattle.tactics);
    const totalTactics = asRecord(nestedTactics.total);
    const leadershipTactics = asRecord(nestedTactics.leadership);
    const intelligenceTactics = asRecord(nestedTactics.intelligence);
    const oldMastery = 'dex0' in data;
    const masteryValues = oldMastery
        ? [data.dex0, data.dex10, data.dex20, data.dex30, data.dex40]
        : [
              data.dex1 ?? nestedMastery.infantry ?? meta.dex1,
              data.dex2 ?? nestedMastery.archery ?? meta.dex2,
              data.dex3 ?? nestedMastery.cavalry ?? meta.dex3,
              data.dex4 ?? nestedMastery.special ?? meta.dex4,
              data.dex5 ?? nestedMastery.siege ?? meta.dex5,
          ];
    const mastery = masteryValues.map(finiteNumber);
    const rankValue = (key: string, ...values: Array<ArchivedJsonValue | undefined>): number | null =>
        firstNumber(...values, data[`rank_${key}`], meta[`rank_${key}`], meta[key]);
    const battles = rankValue('warnum', data.warnum, nestedBattle.battles);
    const wins = rankValue('killnum', data.killnum, nestedBattle.wins);
    const losses = rankValue('deathnum', data.deathnum, nestedBattle.losses);
    const killedCrew = rankValue('killcrew', data.killcrew, nestedBattle.killedCrew);
    const lostCrew = rankValue('deathcrew', data.deathcrew, nestedBattle.lostCrew);
    const history = historyLines(data.history);
    const battleResultRecords = recordLines(nestedRecords.battleResult ?? data.battleResultRecords);
    const tacticValues = [
        rankValue('ttw', data.ttw, totalTactics.wins),
        rankValue('ttd', data.ttd, totalTactics.draws),
        rankValue('ttl', data.ttl, totalTactics.losses),
        rankValue('tlw', data.tlw, leadershipTactics.wins),
        rankValue('tld', data.tld, leadershipTactics.draws),
        rankValue('tll', data.tll, leadershipTactics.losses),
        rankValue('tiw', data.tiw, intelligenceTactics.wins),
        rankValue('tid', data.tid, intelligenceTactics.draws),
        rankValue('til', data.til, intelligenceTactics.losses),
    ];
    const tacticsAvailable = tacticValues.some((value) => finiteNumber(value) !== null);

    return {
        sourceFormat: detectArchivedGeneralSourceFormat(raw),
        snapshot: {
            schemaVersion: ARCHIVED_GENERAL_SCHEMA_VERSION,
            identity: {
                name: firstText(data.name, identity.name) ?? fallbackName,
                picture: firstText(data.picture, identity.picture),
                imageServer: firstNumber(data.imageServer, data.imgsvr, identity.imageServer),
                npcState: firstNumber(data.npcState, data.npc, identity.npcState),
                nationId: firstNumber(data.nationId, data.nation, identity.nationId),
                cityId: firstNumber(data.cityId, data.city, identity.cityId),
                officerLevel: firstNumber(data.officerLevel, data.officer_level, data.level, identity.officerLevel),
                officerCity: firstNumber(data.officerCity, data.officer_city, identity.officerCity),
            },
            stats: {
                leadership: firstNumber(data.leadership, data.leader, stats.leadership),
                strength: firstNumber(data.strength, data.power, stats.strength),
                intelligence: firstNumber(data.intelligence, data.intel, stats.intelligence),
                leadershipExperience: firstNumber(
                    data.leadershipExperience,
                    data.leadership_exp,
                    stats.leadershipExperience,
                    meta.leadership_exp
                ),
                strengthExperience: firstNumber(
                    data.strengthExperience,
                    data.strength_exp,
                    stats.strengthExperience,
                    meta.strength_exp
                ),
                intelligenceExperience: firstNumber(
                    data.intelligenceExperience,
                    data.intel_exp,
                    stats.intelligenceExperience,
                    meta.intel_exp
                ),
            },
            progression: {
                experience: firstNumber(data.experience, progression.experience),
                experienceLevel: firstNumber(data.experienceLevel, data.explevel, progression.experienceLevel),
                dedication: firstNumber(data.dedication, progression.dedication),
                dedicationLevel: firstNumber(data.dedicationLevel, data.dedlevel, progression.dedicationLevel),
                age: firstNumber(data.age, progression.age),
                startAge: firstNumber(data.startAge, data.startage, progression.startAge),
                bornYear: firstNumber(data.bornYear, data.bornyear, progression.bornYear),
                deadYear: firstNumber(data.deadYear, data.deadyear, progression.deadYear),
            },
            traits: {
                personality: firstText(data.personalCode, data.personal, role.personality, traits.personality),
                specialDomestic: firstText(
                    data.specialCode,
                    data.special,
                    role.specialDomestic,
                    traits.specialDomestic
                ),
                specialWar: firstText(data.special2Code, data.special2, role.specialWar, traits.specialWar),
            },
            resources: {
                gold: firstNumber(data.gold, resources.gold),
                rice: firstNumber(data.rice, resources.rice),
                crew: firstNumber(data.crew, resources.crew),
                crewType: firstText(data.crewType, data.crewtype, resources.crewType),
                train: firstNumber(data.train, resources.train),
                morale: firstNumber(data.morale, data.atmos, resources.morale),
                injury: firstNumber(data.injury, resources.injury),
            },
            items: {
                horse: firstText(items.horse, data.horse),
                weapon: firstText(items.weapon, data.weapon, data.weap),
                book: firstText(items.book, data.book),
                item: firstText(items.item, data.item),
            },
            mastery: {
                infantry: mastery[0] ?? null,
                archery: mastery[1] ?? null,
                cavalry: mastery[2] ?? null,
                special: mastery[3] ?? null,
                siege: mastery[4] ?? null,
            },
            battle: {
                battles,
                wins,
                losses,
                fireSuccesses: rankValue('firenum', data.firenum, nestedBattle.fireSuccesses),
                kills: firstNumber(nestedBattle.kills, wins),
                deaths: firstNumber(nestedBattle.deaths, losses),
                killedCrew,
                lostCrew,
                winRate: firstNumber(nestedBattle.winRate) ?? rate(wins, battles),
                killRate: firstNumber(nestedBattle.killRate) ?? rate(killedCrew, lostCrew),
                recentWar: firstText(data.recentWar, data.recent_war, data.recentWarTime, nestedBattle.recentWar),
                tactics: {
                    total: {
                        wins: rankValue('ttw', data.ttw, totalTactics.wins),
                        draws: rankValue('ttd', data.ttd, totalTactics.draws),
                        losses: rankValue('ttl', data.ttl, totalTactics.losses),
                    },
                    leadership: {
                        wins: rankValue('tlw', data.tlw, leadershipTactics.wins),
                        draws: rankValue('tld', data.tld, leadershipTactics.draws),
                        losses: rankValue('tll', data.tll, leadershipTactics.losses),
                    },
                    intelligence: {
                        wins: rankValue('tiw', data.tiw, intelligenceTactics.wins),
                        draws: rankValue('tid', data.tid, intelligenceTactics.draws),
                        losses: rankValue('til', data.til, intelligenceTactics.losses),
                    },
                },
            },
            history,
            records: { battleResult: battleResultRecords },
            availability: {
                mastery: mastery.some((value) => value !== null),
                battleAggregates: [battles, wins, losses, killedCrew, lostCrew].some((value) => value !== null),
                tactics: tacticsAvailable,
                history: history.length > 0,
                battleDetailLogs: false,
                battleResultLogs:
                    storedAvailability.battleResultLogs === true ||
                    (storedAvailability.battleResultLogs !== false &&
                        Object.prototype.hasOwnProperty.call(nestedRecords, 'battleResult')),
            },
        },
    };
};
