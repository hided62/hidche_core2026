import type { HallOfFameType } from '@sammo-ts/common';
import type { GamePrisma, InputJsonValue } from '@sammo-ts/infra';

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

const readInteger = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

/**
 * `gameIdx` is fixed when RESET opens a game and deliberately excludes
 * retained ABANDONED rows. Older fixtures may not carry it, so reconstruct the
 * same sequence from completed games plus the configured first index.
 */
export const resolveOfficialGameIndex = async (
    prisma: GamePrisma.TransactionClient,
    worldMeta: Record<string, unknown>
): Promise<number> => {
    if (worldMeta.gameIdx !== undefined) {
        return readInteger(worldMeta.gameIdx, 0);
    }
    const completedGames = await prisma.gameHistory.count({ where: { status: 'COMPLETED' } });
    return completedGames + readInteger(worldMeta.firstGameIdx, 1);
};

export interface HallOfFameCandidate {
    serverId: string;
    season: number;
    scenario: number;
    generalNo: number;
    type: HallOfFameType;
    value: number;
    owner: string | null;
    aux: unknown;
}

/**
 * Ref insertIgnore treats an owner record belonging to another general as a
 * complete winner: it does not reassign that row even when the new value is
 * higher. Only an existing row for the same general and scenario may replace
 * value+aux, keeping every identity column unchanged. This avoids the former
 * Core state where an old general number was combined with a new general's aux.
 */
export const persistHallOfFameCandidate = async (
    prisma: GamePrisma.TransactionClient,
    candidate: HallOfFameCandidate
): Promise<'CREATED' | 'UPDATED' | 'PRESERVED'> => {
    const matches = await prisma.hallOfFame.findMany({
        where: {
            OR: [
                { serverId: candidate.serverId, type: candidate.type, generalNo: candidate.generalNo },
                ...(candidate.owner
                    ? [{ serverId: candidate.serverId, type: candidate.type, owner: candidate.owner }]
                    : []),
            ],
        },
    });
    const sameGeneral = matches.find((entry) => entry.generalNo === candidate.generalNo);
    if (!sameGeneral && matches.length > 0) {
        return 'PRESERVED';
    }
    if (!sameGeneral) {
        await prisma.hallOfFame.create({
            data: {
                ...candidate,
                aux: asJson(candidate.aux),
            },
        });
        return 'CREATED';
    }
    if (sameGeneral.scenario !== candidate.scenario || candidate.value <= sameGeneral.value) {
        return 'PRESERVED';
    }
    await prisma.hallOfFame.update({
        where: { id: sameGeneral.id },
        data: {
            value: candidate.value,
            aux: asJson(candidate.aux),
        },
    });
    return 'UPDATED';
};
