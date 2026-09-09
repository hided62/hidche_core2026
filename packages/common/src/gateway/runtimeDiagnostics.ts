/** 관리자 장애 기록에서도 연결 URL과 인증값을 보존하지 않는다. */
export const sanitizeRuntimeErrorText = (text: string): string =>
    text
        .replace(/\b(?:https?|postgres(?:ql)?|rediss?):\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
        .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
        .replace(
            /((?:password|passwd|token|secret|authorization|cookie|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
            '$1[REDACTED]'
        )
        .slice(0, 2000);

export const describeRuntimeError = (error: unknown): { code: string; message: string; frames: string[] } => ({
    code: error instanceof Error ? error.name.slice(0, 100) : 'RuntimeError',
    message: sanitizeRuntimeErrorText(error instanceof Error ? error.message : String(error)),
    frames:
        error instanceof Error
            ? (error.stack ?? '')
                  .split('\n')
                  .filter((line) => /^\s*at\s/.test(line))
                  .slice(0, 8)
                  .map(sanitizeRuntimeErrorText)
            : [],
});

export interface ProfileRuntimeDiagnostics {
    profileName: string;
    checkedAt: string;
    database: 'AVAILABLE' | 'UNAVAILABLE' | 'UNINITIALIZED';
    processObservation: 'AVAILABLE' | 'UNAVAILABLE';
    processes: Array<{ name: string; status: string; restartCount: number; exitCode: number | null }>;
    lease: {
        ownerId: string;
        fencingEpoch: string;
        heartbeatAt: string;
        leaseUntil: string;
        heartbeatAgeMs: number;
        valid: boolean;
        clockReady: boolean;
    } | null;
    clock: {
        phase: string;
        revision: string;
        tick: string | null;
        lastTurnTick: string | null;
        year: number;
        month: number;
        wallAnchor: string | null;
        recoveryStartWallAt: string | null;
        recoveryEndTick: string | null;
    } | null;
}
