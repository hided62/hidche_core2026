import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PhaseKind = 'idle' | 'own' | 'global' | 'mixed';

export interface LoadOperation {
    name: string;
    procedure: string;
    type: 'query';
    weight: number;
    input?: unknown;
}

export interface LoadPhase {
    name: string;
    kind: PhaseKind;
    durationMs: number;
    sseConnections: number;
    requestIntervalMs: number | null;
    operations: LoadOperation[];
}

export interface LoadConfig {
    $schema?: string;
    version: 1;
    name: string;
    target: {
        baseUrl: string;
        trpcPath: string;
        ssePath: string;
        publicProfile: false;
        allowedHosts: string[];
    };
    isolation: {
        postgresSchema: string;
        redisPrefix: string;
        redisDatabase: number;
        profileName: string;
    };
    capacity: {
        authenticatedViewers: number;
        npcGenerals: number;
        humanGenerals: number;
        turnIntervalMs: number;
    };
    runtimeMetadata: {
        fixtureSha256: string;
        imageDigest: string;
        postgresVersion: string;
        redisVersion: string;
    };
    phases: LoadPhase[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const integerAtLeast = (value: unknown, minimum: number): boolean =>
    typeof value === 'number' && Number.isInteger(value) && value >= minimum;

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
    Object.keys(value).every((key) => allowed.includes(key));

export const isPrivateTargetHost = (hostname: string): boolean => {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.localhost')) return true;
    if (normalized.endsWith('.internal') || normalized.endsWith('.local')) return true;
    const parts = normalized.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
    }
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31);
};

export const validateLoadConfig = (raw: unknown): LoadConfig => {
    const issues: string[] = [];
    if (!isRecord(raw)) throw new Error('config must be a JSON object');
    if (!hasOnlyKeys(raw, ['$schema', 'version', 'name', 'target', 'isolation', 'capacity', 'runtimeMetadata', 'phases'])) {
        issues.push('config contains unknown fields');
    }
    if (raw.version !== 1) issues.push('version must be 1');
    if (typeof raw.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(raw.name)) issues.push('name is invalid');

    const target = raw.target;
    if (!isRecord(target)) {
        issues.push('target must be an object');
    } else {
        if (!hasOnlyKeys(target, ['baseUrl', 'trpcPath', 'ssePath', 'publicProfile', 'allowedHosts'])) {
            issues.push('target contains unknown fields');
        }
        let parsedUrl: URL | null = null;
        try {
            parsedUrl = new URL(typeof target.baseUrl === 'string' ? target.baseUrl : 'invalid:');
        } catch {
            issues.push('target.baseUrl must be a URL');
        }
        if (parsedUrl && !['http:', 'https:'].includes(parsedUrl.protocol)) issues.push('target.baseUrl must use HTTP(S)');
        if (parsedUrl && !isPrivateTargetHost(parsedUrl.hostname)) issues.push('target.baseUrl must use a loopback or private/internal hostname');
        if (parsedUrl && (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash)) {
            issues.push('target.baseUrl must not contain credentials, query, or fragment');
        }
        if (target.publicProfile !== false) issues.push('target.publicProfile must be false');
        if (!Array.isArray(target.allowedHosts) || target.allowedHosts.length === 0 || !target.allowedHosts.every((item) => typeof item === 'string' && item.length > 0)) {
            issues.push('target.allowedHosts must contain explicit hostnames');
        } else if (parsedUrl && !target.allowedHosts.includes(parsedUrl.hostname)) {
            issues.push('target hostname is not explicitly allowlisted');
        }
        if (typeof target.trpcPath !== 'string' || !target.trpcPath.startsWith('/')) issues.push('target.trpcPath must be absolute');
        if (typeof target.ssePath !== 'string' || !target.ssePath.startsWith('/')) issues.push('target.ssePath must be absolute');
    }

    const isolation = raw.isolation;
    if (!isRecord(isolation)) {
        issues.push('isolation must be an object');
    } else {
        if (!hasOnlyKeys(isolation, ['postgresSchema', 'redisPrefix', 'redisDatabase', 'profileName'])) issues.push('isolation contains unknown fields');
        if (typeof isolation.postgresSchema !== 'string' || !/^load_[a-z0-9_]+$/u.test(isolation.postgresSchema)) {
            issues.push('isolation.postgresSchema must start with load_');
        }
        if (typeof isolation.redisPrefix !== 'string' || !/^load-tests:[a-z0-9:_-]+:$/u.test(isolation.redisPrefix)) {
            issues.push('isolation.redisPrefix must be load-tests scoped and end with a colon');
        }
        if (!integerAtLeast(isolation.redisDatabase, 1) || Number(isolation.redisDatabase) > 15) {
            issues.push('isolation.redisDatabase must be a dedicated Redis database in the range 1..15');
        }
        if (typeof isolation.profileName !== 'string' || !/^load-tests:[a-z0-9:_-]+$/u.test(isolation.profileName)) {
            issues.push('isolation.profileName must be load-tests scoped');
        } else if (typeof isolation.redisPrefix === 'string' && `${isolation.profileName}:` !== isolation.redisPrefix) {
            issues.push('isolation.profileName must match isolation.redisPrefix without the trailing colon');
        }
    }

    const capacity = raw.capacity;
    if (!isRecord(capacity)) {
        issues.push('capacity must be an object');
    } else {
        if (!hasOnlyKeys(capacity, ['authenticatedViewers', 'npcGenerals', 'humanGenerals', 'turnIntervalMs'])) issues.push('capacity contains unknown fields');
        if (!integerAtLeast(capacity.authenticatedViewers, 1)) issues.push('capacity.authenticatedViewers must be positive');
        if (!integerAtLeast(capacity.npcGenerals, 0)) issues.push('capacity.npcGenerals must be non-negative');
        if (!integerAtLeast(capacity.humanGenerals, 0)) issues.push('capacity.humanGenerals must be non-negative');
        if (!integerAtLeast(capacity.turnIntervalMs, 1000)) issues.push('capacity.turnIntervalMs must be at least 1000');
    }

    const metadata = raw.runtimeMetadata;
    if (!isRecord(metadata)) {
        issues.push('runtimeMetadata must be an object');
    } else {
        if (!hasOnlyKeys(metadata, ['fixtureSha256', 'imageDigest', 'postgresVersion', 'redisVersion'])) issues.push('runtimeMetadata contains unknown fields');
        if (typeof metadata.fixtureSha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(metadata.fixtureSha256)) issues.push('runtimeMetadata.fixtureSha256 must be a sha256 digest');
        for (const field of ['imageDigest', 'postgresVersion', 'redisVersion'] as const) {
            if (typeof metadata[field] !== 'string' || metadata[field].length === 0) issues.push(`runtimeMetadata.${field} is required`);
        }
    }

    const phases = raw.phases;
    if (!Array.isArray(phases)) {
        issues.push('phases must be an array');
    } else {
        const kinds = new Set<string>();
        for (const [index, phase] of phases.entries()) {
            if (!isRecord(phase)) {
                issues.push(`phases[${index}] must be an object`);
                continue;
            }
            if (!hasOnlyKeys(phase, ['name', 'kind', 'durationMs', 'sseConnections', 'requestIntervalMs', 'operations'])) issues.push(`phases[${index}] contains unknown fields`);
            if (typeof phase.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/u.test(phase.name)) issues.push(`phases[${index}].name is invalid`);
            if (!['idle', 'own', 'global', 'mixed'].includes(String(phase.kind))) issues.push(`phases[${index}].kind is invalid`);
            else kinds.add(String(phase.kind));
            if (!integerAtLeast(phase.durationMs, 1000)) issues.push(`phases[${index}].durationMs must be at least 1000`);
            if (!integerAtLeast(phase.sseConnections, 0)) issues.push(`phases[${index}].sseConnections must be non-negative`);
            const operations = phase.operations;
            if (!Array.isArray(operations)) {
                issues.push(`phases[${index}].operations must be an array`);
                continue;
            }
            if (phase.kind === 'idle') {
                if (phase.requestIntervalMs !== null || operations.length !== 0) issues.push(`phases[${index}] idle phase must not issue HTTP requests`);
            } else if (!integerAtLeast(phase.requestIntervalMs, 50) || operations.length === 0) {
                issues.push(`phases[${index}] active phase requires an interval and operations`);
            }
            for (const [operationIndex, operation] of operations.entries()) {
                if (!isRecord(operation)) {
                    issues.push(`phases[${index}].operations[${operationIndex}] must be an object`);
                    continue;
                }
                if (!hasOnlyKeys(operation, ['name', 'procedure', 'type', 'weight', 'input'])) issues.push(`phases[${index}].operations[${operationIndex}] contains unknown fields`);
                if (typeof operation.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/u.test(operation.name)) issues.push(`phases[${index}].operations[${operationIndex}].name is invalid`);
                if (typeof operation.procedure !== 'string' || !/^[A-Za-z][A-Za-z0-9_.]+$/u.test(operation.procedure)) issues.push(`phases[${index}].operations[${operationIndex}].procedure is invalid`);
                if (operation.type !== 'query') issues.push(`phases[${index}].operations[${operationIndex}] must be a read-only query`);
                if (!integerAtLeast(operation.weight, 1) || Number(operation.weight) > 100) issues.push(`phases[${index}].operations[${operationIndex}].weight must be 1..100`);
            }
        }
        for (const required of ['idle', 'own', 'global', 'mixed']) {
            if (!kinds.has(required)) issues.push(`phases must include ${required}`);
        }
    }

    if (isRecord(capacity) && Array.isArray(phases)) {
        for (const [index, phase] of phases.entries()) {
            if (isRecord(phase) && typeof phase.sseConnections === 'number' && typeof capacity.authenticatedViewers === 'number' && phase.sseConnections > capacity.authenticatedViewers) {
                issues.push(`phases[${index}].sseConnections exceeds authenticatedViewers`);
            }
        }
    }
    if (issues.length > 0) throw new Error(`invalid load configuration:\n- ${issues.join('\n- ')}`);
    return raw as unknown as LoadConfig;
};

export const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
};

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const loadConfig = async (configPath: string): Promise<{ config: LoadConfig; sha256: string }> => {
    const text = await readFile(configPath, 'utf8');
    const parsed: unknown = JSON.parse(text);
    const config = validateLoadConfig(parsed);
    return { config, sha256: sha256(canonicalJson(config)) };
};

export const assertRuntimeMetadataFinalized = (config: LoadConfig): void => {
    const placeholderFields = Object.entries(config.runtimeMetadata)
        .filter(([, value]) => value.includes('replace-before-measurement') || /^sha256:0{64}$/u.test(value))
        .map(([key]) => key);
    if (placeholderFields.length > 0) {
        throw new Error(`runtime metadata placeholders must be replaced before run: ${placeholderFields.join(', ')}`);
    }
};

export const loadTokens = async (tokenPath: string, workspaceRoot: string, requiredCount: number): Promise<string[]> => {
    const absolute = path.resolve(tokenPath);
    const root = await realpath(path.resolve(workspaceRoot));
    const linkStat = await lstat(absolute);
    if (linkStat.isSymbolicLink()) throw new Error('token file must not be a symbolic link');
    const resolved = await realpath(absolute);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('token file must be inside the workspace and gitignored');
    const fileStat = await stat(absolute);
    if ((fileStat.mode & 0o777) !== 0o600) throw new Error('token file mode must be exactly 0600');
    try {
        await execFileAsync('git', ['check-ignore', '--quiet', '--', resolved], { cwd: root });
    } catch {
        throw new Error('token file must be covered by .gitignore');
    }
    const parsed: unknown = JSON.parse(await readFile(absolute, 'utf8'));
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['tokens']) || !Array.isArray(parsed.tokens)) throw new Error('token file must contain only a tokens array');
    if (!parsed.tokens.every((token) => typeof token === 'string' && token.length >= 16)) throw new Error('each bearer token must be a non-empty string of at least 16 characters');
    if (new Set(parsed.tokens).size !== parsed.tokens.length) throw new Error('token file contains duplicate tokens');
    if (parsed.tokens.length < requiredCount) throw new Error(`token file has fewer than ${requiredCount} entries`);
    return parsed.tokens.slice(0, requiredCount);
};

export const expandWeightedOperations = (operations: readonly LoadOperation[]): LoadOperation[] =>
    operations.flatMap((operation) => Array.from({ length: operation.weight }, () => operation));
