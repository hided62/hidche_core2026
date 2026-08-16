import type { LoadOperation } from './config.js';
import type { PhaseMetrics } from './metrics.js';

export interface TrpcRequest {
    url: string;
    init: RequestInit;
}

export const buildTrpcQuery = (baseUrl: string, trpcPath: string, operation: LoadOperation, token: string): TrpcRequest => {
    const normalizedPath = trpcPath.endsWith('/') ? trpcPath.slice(0, -1) : trpcPath;
    const url = new URL(`${normalizedPath}/${operation.procedure}`, baseUrl);
    if (operation.input !== undefined) url.searchParams.set('input', JSON.stringify(operation.input));
    return {
        url: url.toString(),
        init: {
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        },
    };
};

const classifyTrpcPayload = (payload: unknown): string | null => {
    if (typeof payload !== 'object' || payload === null) return 'invalid-payload';
    if ('error' in payload) {
        const error = (payload as { error?: unknown }).error;
        if (typeof error === 'object' && error !== null && 'data' in error) {
            const data = (error as { data?: unknown }).data;
            if (typeof data === 'object' && data !== null && 'code' in data && typeof (data as { code?: unknown }).code === 'string') {
                const code = (data as { code: string }).code;
                return `trpc-${/^[A-Z_]+$/u.test(code) ? code.toLowerCase() : 'error'}`;
            }
        }
        return 'trpc-error';
    }
    return null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const unwrapTrpcData = (payload: unknown): unknown => {
    const result = asRecord(asRecord(payload)?.result);
    const data = asRecord(result?.data);
    return data && 'json' in data ? data.json : result?.data;
};

export interface DashboardRevisions {
    context?: string;
    commandTable?: string;
    boardAccess?: string;
}

export const extractDashboardRevisions = (payload: unknown): { revisions: DashboardRevisions; resultKinds: string[] } | null => {
    const data = asRecord(unwrapTrpcData(payload));
    if (!data) return null;
    const revisions: DashboardRevisions = {};
    const resultKinds: string[] = [];
    for (const [wireName, outputName] of [
        ['context', 'context'],
        ['commandTable', 'commandTable'],
        ['boardAccess', 'boardAccess'],
    ] as const) {
        const slice = asRecord(data[wireName]);
        if (!slice) continue;
        if (typeof slice.revision === 'string' && /^[A-Za-z0-9_-]{22}$/u.test(slice.revision)) revisions[outputName] = slice.revision;
        if (typeof slice.kind === 'string' && ['unchanged', 'snapshot', 'patch'].includes(slice.kind)) resultKinds.push(slice.kind);
        else resultKinds.push('other');
    }
    return { revisions, resultKinds };
};

export const executeTrpcQuery = async (options: {
    baseUrl: string;
    trpcPath: string;
    operation: LoadOperation;
    token: string;
    signal: AbortSignal;
    metrics: PhaseMetrics;
}): Promise<DashboardRevisions | undefined> => {
    const started = performance.now();
    let outcome: string | null;
    try {
        const request = buildTrpcQuery(options.baseUrl, options.trpcPath, options.operation, options.token);
        const response = await fetch(request.url, { ...request.init, signal: options.signal });
        if (!response.ok) {
            outcome = `http-${response.status}`;
            await response.body?.cancel();
        } else {
            const payload: unknown = await response.json();
            outcome = classifyTrpcPayload(payload);
            if (outcome === null && options.operation.procedure === 'dashboard.getContextBundleDelta') {
                const dashboard = extractDashboardRevisions(payload);
                for (const kind of dashboard?.resultKinds ?? []) options.metrics.recordHttpResult(options.operation.name, kind);
                options.metrics.recordHttp(options.operation.name, performance.now() - started, outcome);
                return dashboard?.revisions;
            }
        }
    } catch (error) {
        if (options.signal.aborted) return;
        outcome = error instanceof TypeError ? 'network' : 'client';
    }
    options.metrics.recordHttp(options.operation.name, performance.now() - started, outcome);
    return undefined;
};
