import { describe, expect, it, vi } from 'vitest';
import type { GamePrisma } from '../src/gamePrisma.js';
import { withPlayAuditSavepoint } from '../src/playAuditBestEffort.js';

describe('optional gameplay audit transaction', () => {
    it('propagates broken transaction recovery instead of claiming a safe gameplay commit', async () => {
        const db = {
            $queryRaw: vi.fn().mockResolvedValue([{ statement: '0', lock: '0' }]),
            $executeRaw: vi.fn().mockImplementation(async (sql: TemplateStringsArray) => {
                if (sql[0]!.startsWith('ROLLBACK')) throw new Error('connection lost');
                return 0;
            }),
        } as unknown as GamePrisma.TransactionClient;
        await expect(
            withPlayAuditSavepoint(db, async () => {
                throw new Error('audit insert');
            })
        ).rejects.toThrow('connection lost');
    });

    it('stops subsequent batches when the whole audit budget is spent', async () => {
        let now = 0;
        const timer = vi.spyOn(performance, 'now').mockImplementation(() => now);
        const write = vi.fn().mockImplementation(async () => {
            now += 600;
            return { count: 1 };
        });
        const db = {
            $queryRaw: vi.fn().mockResolvedValue([{ statement: '0', lock: '0' }]),
            $executeRaw: vi.fn().mockResolvedValue(0),
            playAuditPolicy: { createMany: write },
        } as unknown as GamePrisma.TransactionClient;
        try {
            const result = await withPlayAuditSavepoint(db, async (auditDb) => {
                for (let i = 0; i < 100; i++) await auditDb.playAuditPolicy.createMany({ data: [] });
            });
            expect(result.ok).toBe(false);
            expect(write).toHaveBeenCalledTimes(2);
            expect(
                vi
                    .mocked(db.$executeRaw)
                    .mock.calls.some(
                        ([sql]) => Array.isArray(sql) && sql[0] === 'ROLLBACK TO SAVEPOINT play_audit_optional'
                    )
            ).toBe(true);
        } finally {
            timer.mockRestore();
        }
    });
});
