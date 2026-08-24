import { describe, expect, it, vi } from 'vitest';

import type { GamePrisma } from '@sammo-ts/infra';

import { persistHallOfFameCandidate, resolveOfficialGameIndex } from '../src/turn/hallOfFamePersistence.js';

const candidate = {
    serverId: 'hall-server',
    season: 3,
    scenario: 22,
    generalNo: 20,
    type: 'experience' as const,
    value: 2_000,
    owner: 'same-owner',
    aux: { name: '새장수' },
};

describe('Hall of Fame persistence policy', () => {
    it('preserves an owner record belonging to another general for both higher and lower new values', async () => {
        const update = vi.fn(async () => undefined);
        const prisma = {
            hallOfFame: {
                findMany: vi.fn(async () => [
                    {
                        id: 1,
                        serverId: candidate.serverId,
                        season: 3,
                        scenario: 22,
                        generalNo: 10,
                        type: candidate.type,
                        value: 1_000,
                        owner: candidate.owner,
                        aux: { name: '기존장수' },
                    },
                ]),
                create: vi.fn(async () => undefined),
                update,
            },
        } as unknown as GamePrisma.TransactionClient;

        await expect(persistHallOfFameCandidate(prisma, candidate)).resolves.toBe('PRESERVED');
        await expect(persistHallOfFameCandidate(prisma, { ...candidate, value: 500 })).resolves.toBe('PRESERVED');
        expect(update).not.toHaveBeenCalled();
        expect(prisma.hallOfFame.create).not.toHaveBeenCalled();
    });

    it('updates only value and aux for a higher same-general record, and preserves a lower value', async () => {
        const existing = {
            id: 2,
            serverId: candidate.serverId,
            season: 3,
            scenario: 22,
            generalNo: candidate.generalNo,
            type: candidate.type,
            value: 1_500,
            owner: 'old-owner',
            aux: { name: '기존장수' },
        };
        const update = vi.fn(async () => undefined);
        const prisma = {
            hallOfFame: {
                findMany: vi.fn(async () => [existing]),
                create: vi.fn(async () => undefined),
                update,
            },
        } as unknown as GamePrisma.TransactionClient;

        await expect(persistHallOfFameCandidate(prisma, candidate)).resolves.toBe('UPDATED');
        expect(update).toHaveBeenCalledWith({
            where: { id: existing.id },
            data: { value: candidate.value, aux: candidate.aux },
        });

        update.mockClear();
        await expect(persistHallOfFameCandidate(prisma, { ...candidate, value: 1_000 })).resolves.toBe('PRESERVED');
        expect(update).not.toHaveBeenCalled();
    });

    it('uses persisted gameIdx and reconstructs fallback from COMPLETED games only', async () => {
        const count = vi.fn(async () => 4);
        const prisma = { gameHistory: { count } } as unknown as GamePrisma.TransactionClient;

        await expect(resolveOfficialGameIndex(prisma, { gameIdx: 0 })).resolves.toBe(0);
        expect(count).not.toHaveBeenCalled();

        await expect(resolveOfficialGameIndex(prisma, { firstGameIdx: 0 })).resolves.toBe(4);
        expect(count).toHaveBeenCalledWith({ where: { status: 'COMPLETED' } });
    });
});
