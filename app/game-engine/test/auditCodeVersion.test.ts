import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeAuditCodeVersion } from '../src/playAudit/decision.js';
const runtimeFactory = vi.hoisted(() => vi.fn());
vi.mock('../src/turn/turnDaemon.js', () => ({ createTurnDaemonRuntime: runtimeFactory }));
vi.mock('../src/turn/turnDaemonMemoryReporter.js', () => ({
    createTurnDaemonMemoryReporter: () => ({ report: vi.fn(), stop: vi.fn() }),
}));
import { runTurnDaemonCli } from '../src/turn/cli.js';

afterEach(() => {
    vi.restoreAllMocks();
    runtimeFactory.mockReset();
});
describe('audit runtime build identity', () => {
    it.each([undefined, '', 'main', 'abcd1234', '0'.repeat(40), 'a'.repeat(41), 'g'.repeat(40)])(
        'leaves unconfirmed SHA %s unknown',
        (value) => {
            expect(normalizeAuditCodeVersion(value)).toBeUndefined();
        }
    );
    it.each([40, 64])('normalizes an exact %s digit SHA', (length) => {
        expect(normalizeAuditCodeVersion(` ${'A'.repeat(length)} `)).toBe('a'.repeat(length));
    });
    it.each([undefined, 'a'.repeat(40)])('passes the startup build identity to the runtime', async (sha) => {
        vi.spyOn(process, 'on').mockReturnValue(process);
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const close = vi.fn();
        runtimeFactory.mockResolvedValue({
            lifecycle: { start: vi.fn(), stop: vi.fn() },
            close,
        });
        await runTurnDaemonCli({
            profile: 'che',
            profileName: 'che:fixture',
            tickMinutes: 10,
            databaseUrl: 'postgresql://fixture/game',
            gatewayDatabaseUrl: 'postgresql://fixture/gateway',
            env: sha ? { TURN_BUILD_COMMIT_SHA: sha } : {},
        });
        expect(runtimeFactory).toHaveBeenCalledWith(
            expect.objectContaining({ auditCodeVersion: sha, profileName: 'che:fixture' })
        );
        expect(close).toHaveBeenCalledOnce();
    });
});
