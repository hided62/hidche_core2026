import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

import { isLegacyArchiveProfile, LEGACY_ARCHIVE_PROFILES, type LegacyArchiveProfile } from './game.js';
import { fingerprintMariaConnection, type MigrationSourceIdentity } from './incremental.js';

export interface ResolvedMigrationStage {
    kind: 'gateway' | 'game';
    name: string;
    profile?: LegacyArchiveProfile;
    sourceUrl: string;
    targetUrl: string;
    sourceIdentity: MigrationSourceIdentity;
}

export interface ResolvedMigrationPlan {
    sourceSet: string;
    stages: ResolvedMigrationStage[];
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/u;
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,127}$/u;

const assertSecureRegularFile = async (filePath: string, label: string): Promise<void> => {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`${label} must be a regular file and not a symbolic link`);
    }
    if ((info.mode & 0o077) !== 0) {
        throw new Error(`${label} must not be readable or writable by group/other (expected mode 0600)`);
    }
};

const readSecureText = async (filePath: string, label: string): Promise<string> => {
    await assertSecureRegularFile(filePath, label);
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        return await handle.readFile('utf8');
    } finally {
        await handle.close();
    }
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
};

const requiredString = (record: Record<string, unknown>, key: string, label: string): string => {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label}.${key} must be a non-empty string`);
    }
    return value.trim();
};

const rejectUnknownKeys = (record: Record<string, unknown>, allowed: readonly string[], label: string): void => {
    const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
    if (unknown.length) {
        throw new Error(`${label} has unknown keys: ${unknown.join(', ')}`);
    }
};

const resolvePassword = async (
    source: Record<string, unknown>,
    configDirectory: string,
    label: string
): Promise<string> => {
    const configured = ['password', 'passwordEnv', 'passwordFile'].filter(
        (key) => typeof source[key] === 'string' && Boolean(String(source[key]).trim())
    );
    if (configured.length !== 1) {
        throw new Error(`${label} must configure exactly one of password, passwordEnv, or passwordFile`);
    }
    if (configured[0] === 'password') {
        return requiredString(source, 'password', label);
    }
    if (configured[0] === 'passwordEnv') {
        const environmentName = requiredString(source, 'passwordEnv', label);
        if (!ENV_NAME.test(environmentName)) throw new Error(`${label}.passwordEnv is not a safe environment name`);
        const value = process.env[environmentName];
        if (!value) throw new Error(`${environmentName} is required by ${label}`);
        return value;
    }
    const configuredPath = requiredString(source, 'passwordFile', label);
    const passwordPath = path.resolve(configDirectory, configuredPath);
    const value = (await readSecureText(passwordPath, `${label}.passwordFile`)).replace(/\r?\n$/u, '');
    if (!value) throw new Error(`${label}.passwordFile is empty`);
    return value;
};

const resolveSource = async (value: unknown, configDirectory: string, label: string): Promise<string> => {
    const source = asRecord(value, label);
    rejectUnknownKeys(
        source,
        ['host', 'port', 'database', 'user', 'password', 'passwordEnv', 'passwordFile', 'tls'],
        label
    );
    const host = requiredString(source, 'host', label);
    const database = requiredString(source, 'database', label);
    const user = requiredString(source, 'user', label);
    const port = source.port === undefined ? 3306 : Number(source.port);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${label}.port must be an integer from 1 through 65535`);
    }
    const dnsName =
        host.length <= 253 && host.split('.').every((part) => /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/u.test(part));
    if (!isIP(host) && !dnsName) throw new Error(`${label}.host must be an IP address or DNS name`);
    if (!/^[a-zA-Z0-9_$.-]{1,64}$/u.test(database)) {
        throw new Error(`${label}.database must be a safe MariaDB database name`);
    }
    if (source.tls !== undefined && typeof source.tls !== 'boolean') {
        throw new Error(`${label}.tls must be a boolean`);
    }
    const password = await resolvePassword(source, configDirectory, label);
    const url = new URL('mariadb://localhost');
    url.hostname = host;
    url.port = String(port);
    url.username = user;
    url.password = password;
    url.pathname = `/${database}`;
    if (source.tls) url.searchParams.set('ssl', 'true');
    return url.toString();
};

const resolveTargetUrl = (record: Record<string, unknown>, label: string): string => {
    const environmentName = requiredString(record, 'targetUrlEnv', label);
    if (!ENV_NAME.test(environmentName)) throw new Error(`${label}.targetUrlEnv is not a safe environment name`);
    const value = process.env[environmentName]?.trim();
    if (!value) throw new Error(`${environmentName} is required by ${label}`);
    return value;
};

const parseStage = (value: unknown, label: string): Record<string, unknown> => {
    const record = asRecord(value, label);
    rejectUnknownKeys(record, ['source', 'targetUrlEnv', 'profile', 'enabled'], label);
    if (!('source' in record)) throw new Error(`${label}.source is required`);
    return record;
};

export const loadMigrationPlan = async (configPathInput: string): Promise<ResolvedMigrationPlan> => {
    const configPath = path.resolve(configPathInput);
    const rawText = await readSecureText(configPath, 'Migration config');
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch (error) {
        throw new Error('Migration config is not valid JSON', { cause: error });
    }
    const root = asRecord(parsed, 'Migration config');
    rejectUnknownKeys(root, ['version', 'sourceSet', 'gateway', 'profiles'], 'Migration config');
    if (root.version !== 1) throw new Error('Migration config.version must be 1');
    const sourceSet = requiredString(root, 'sourceSet', 'Migration config');
    if (!SAFE_KEY.test(sourceSet)) throw new Error('Migration config.sourceSet must use safe characters');
    const configDirectory = path.dirname(configPath);
    const stages: ResolvedMigrationStage[] = [];

    if (root.gateway !== undefined) {
        const gateway = parseStage(root.gateway, 'gateway');
        const sourceUrl = await resolveSource(gateway.source, configDirectory, 'gateway.source');
        stages.push({
            kind: 'gateway',
            name: 'gateway',
            sourceUrl,
            targetUrl: resolveTargetUrl(gateway, 'gateway'),
            sourceIdentity: {
                key: `${sourceSet}:gateway`,
                fingerprint: fingerprintMariaConnection(sourceUrl),
            },
        });
    }

    const profiles = root.profiles === undefined ? [] : root.profiles;
    if (!Array.isArray(profiles)) throw new Error('Migration config.profiles must be an array');
    const seen = new Set<string>();
    const profileStages = new Map<LegacyArchiveProfile, ResolvedMigrationStage>();
    for (const [index, value] of profiles.entries()) {
        const label = `profiles[${index}]`;
        const profileConfig = parseStage(value, label);
        if (profileConfig.enabled === false) continue;
        if (profileConfig.enabled !== undefined && profileConfig.enabled !== true) {
            throw new Error(`${label}.enabled must be a boolean`);
        }
        const profile = requiredString(profileConfig, 'profile', label);
        if (!isLegacyArchiveProfile(profile)) {
            throw new Error(`${label}.profile must be one of ${LEGACY_ARCHIVE_PROFILES.join(', ')}`);
        }
        if (seen.has(profile)) throw new Error(`Duplicate profile in migration config: ${profile}`);
        seen.add(profile);
        const sourceUrl = await resolveSource(profileConfig.source, configDirectory, `${label}.source`);
        profileStages.set(profile, {
            kind: 'game',
            name: profile,
            profile,
            sourceUrl,
            targetUrl: resolveTargetUrl(profileConfig, label),
            sourceIdentity: {
                key: `${sourceSet}:${profile}`,
                fingerprint: fingerprintMariaConnection(sourceUrl),
            },
        });
    }
    for (const profile of LEGACY_ARCHIVE_PROFILES) {
        const stage = profileStages.get(profile);
        if (stage) stages.push(stage);
    }
    if (!stages.length) throw new Error('Migration config has no enabled stages');
    return { sourceSet, stages };
};

export const readPasswordFileForReset = async (passwordPath: string): Promise<string> => {
    const value = (await readSecureText(path.resolve(passwordPath), 'Password file')).replace(/\r?\n$/u, '');
    if (!value) throw new Error('Password file is empty');
    return value;
};
