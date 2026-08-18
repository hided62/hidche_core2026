import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { TextDecoder } from 'node:util';

import type { LegacyArchiveProfile } from './game.js';
import type { MigrationSourceIdentity } from './incremental.js';

const MAX_BATTLE_RESULT_FILE_BYTES = 4 * 1024 * 1024;
const SSH_HOST = /^(?:[a-zA-Z0-9._-]+@)?[a-zA-Z0-9._-]+$/u;
const HASH = /^[a-f0-9]{64}$/u;

export interface BattleResultSourceConfig {
    kind: 'local' | 'ssh';
    directory: string;
    sshHost?: string;
    identity: MigrationSourceIdentity;
}

export interface BattleResultFileDescriptor {
    serverId: string;
    generalNo: number;
    sourceBytes: number;
    contentHash: string;
}

export interface BattleResultSeasonManifest {
    serverId: string;
    files: BattleResultFileDescriptor[];
    fileCount: number;
    totalBytes: number;
    manifestHash: string;
}

export interface BattleResultFile extends BattleResultFileDescriptor {
    content: string;
    lineCount: number;
}

type RemoteDescriptor = {
    serverId: string;
    generalNo: number;
    sourceBytes: number;
    contentHash: string;
    contentBase64?: string;
};

const REMOTE_READER = String.raw`
import base64, hashlib, json, os, re, sys

MAX_BYTES = 4 * 1024 * 1024
action, root_input, profile = sys.argv[1:4]
selected = set(json.loads(base64.urlsafe_b64decode(sys.argv[4]).decode('utf-8'))) if len(sys.argv) > 4 else set()
root = os.path.realpath(root_input)
season_re = re.compile(r'^' + re.escape(profile) + r'_[A-Za-z0-9_-]{1,96}$')
file_re = re.compile(r'^batres([0-9]+)\.txt$')

if not os.path.isdir(root):
    raise RuntimeError('preserved battle-result directory is not readable')

for season in sorted(os.scandir(root), key=lambda item: item.name):
    if not season.is_dir(follow_symlinks=False) or not season_re.fullmatch(season.name):
        continue
    if action == 'read' and season.name not in selected:
        continue
    for item in sorted(os.scandir(season.path), key=lambda entry: entry.name):
        match = file_re.fullmatch(item.name)
        if not match or not item.is_file(follow_symlinks=False):
            continue
        size = item.stat(follow_symlinks=False).st_size
        if size > MAX_BYTES:
            raise RuntimeError(f'battle-result file exceeds {MAX_BYTES} bytes: {season.name}/{item.name}')
        digest = hashlib.sha256()
        content = bytearray()
        with open(item.path, 'rb') as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                content.extend(chunk)
        content.decode('utf-8')
        if b'\0' in content:
            raise RuntimeError(f'battle-result file contains NUL: {season.name}/{item.name}')
        result = {
            'serverId': season.name,
            'generalNo': int(match.group(1)),
            'sourceBytes': size,
            'contentHash': digest.hexdigest(),
        }
        if action == 'read':
            result['contentBase64'] = base64.b64encode(content).decode('ascii')
        print(json.dumps(result, ensure_ascii=True), flush=True)
`;

const safeSourceDirectory = (directory: string): string => {
    if (!path.isAbsolute(directory) || directory.length > 4096 || /[\0\r\n]/u.test(directory)) {
        throw new Error('Preserved battle-result directory must be a safe absolute path');
    }
    return directory;
};

export const resolveBattleResultSourceConfig = async (
    input: { directory: string; sshHost?: string },
    sourceKey: string,
    profile: LegacyArchiveProfile,
    configDirectory: string
): Promise<BattleResultSourceConfig> => {
    const sshHost = input.sshHost?.trim();
    let directory: string;
    let kind: BattleResultSourceConfig['kind'];
    if (sshHost) {
        if (!SSH_HOST.test(sshHost) || sshHost.startsWith('-')) {
            throw new Error('battleResults.sshHost must be a safe SSH host or configured alias');
        }
        directory = safeSourceDirectory(input.directory.trim());
        kind = 'ssh';
    } else {
        directory = await realpath(path.resolve(configDirectory, input.directory));
        safeSourceDirectory(directory);
        const info = await lstat(directory);
        if (!info.isDirectory()) throw new Error('battleResults.directory must be a directory');
        kind = 'local';
    }
    const fingerprint = createHash('sha256')
        .update(JSON.stringify({ kind, directory, sshHost: sshHost ?? null, profile }))
        .digest('hex');
    return {
        kind,
        directory,
        ...(sshHost ? { sshHost } : {}),
        identity: { key: `${sourceKey}:battle-results`, fingerprint },
    };
};

const localDescriptors = async (
    source: BattleResultSourceConfig,
    profile: LegacyArchiveProfile,
    selected?: ReadonlySet<string>
): Promise<RemoteDescriptor[]> => {
    const seasonPattern = new RegExp(`^${profile}_[A-Za-z0-9_-]{1,96}$`, 'u');
    const filePattern = /^batres([0-9]+)\.txt$/u;
    const result: RemoteDescriptor[] = [];
    for (const season of (await readdir(source.directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name)
    )) {
        if (!season.isDirectory() || !seasonPattern.test(season.name) || (selected && !selected.has(season.name))) {
            continue;
        }
        const seasonPath = path.join(source.directory, season.name);
        for (const file of (await readdir(seasonPath, { withFileTypes: true })).sort((a, b) =>
            a.name.localeCompare(b.name)
        )) {
            const match = filePattern.exec(file.name);
            if (!match || !file.isFile()) continue;
            const filePath = path.join(seasonPath, file.name);
            const info = await lstat(filePath);
            if (!info.isFile() || info.isSymbolicLink()) continue;
            if (info.size > MAX_BATTLE_RESULT_FILE_BYTES) {
                throw new Error(
                    `Battle-result file exceeds ${MAX_BATTLE_RESULT_FILE_BYTES} bytes: ${season.name}/${file.name}`
                );
            }
            const content = await readFile(filePath);
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
            if (decoded.includes('\0')) {
                throw new Error(`Battle-result file contains NUL: ${season.name}/${file.name}`);
            }
            result.push({
                serverId: season.name,
                generalNo: Number(match[1]),
                sourceBytes: info.size,
                contentHash: createHash('sha256').update(content).digest('hex'),
                ...(selected ? { contentBase64: content.toString('base64') } : {}),
            });
        }
    }
    return result;
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

const remoteDescriptors = async (
    source: BattleResultSourceConfig,
    profile: LegacyArchiveProfile,
    selected?: ReadonlySet<string>
): Promise<RemoteDescriptor[]> => {
    if (!source.sshHost) throw new Error('SSH battle-result source is missing its host');
    const action = selected ? 'read' : 'list';
    const encodedSelection = Buffer.from(JSON.stringify([...(selected ?? [])]), 'utf8').toString('base64');
    const remoteCommand = ['python3', '-c', REMOTE_READER, action, source.directory, profile, encodedSelection]
        .map(shellQuote)
        .join(' ');
    const child = spawn('ssh', ['-C', '--', source.sshHost, remoteCommand], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8192) stderr += chunk.slice(0, 8192 - stderr.length);
    });
    const exit = new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve(code ?? 1));
    });
    const output: RemoteDescriptor[] = [];
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            if (!line.trim()) continue;
            const parsed = JSON.parse(line) as RemoteDescriptor;
            output.push(parsed);
        }
    } catch (error) {
        child.kill();
        throw new Error('Could not parse the preserved battle-result SSH stream', { cause: error });
    }
    const code = await exit;
    if (code !== 0) {
        throw new Error(`Preserved battle-result SSH scan failed (${code}): ${stderr.trim() || 'no error text'}`);
    }
    return output;
};

const descriptors = (
    source: BattleResultSourceConfig,
    profile: LegacyArchiveProfile,
    selected?: ReadonlySet<string>
): Promise<RemoteDescriptor[]> =>
    source.kind === 'local'
        ? localDescriptors(source, profile, selected)
        : remoteDescriptors(source, profile, selected);

const validateDescriptor = (descriptor: RemoteDescriptor, profile: LegacyArchiveProfile): void => {
    if (!new RegExp(`^${profile}_[A-Za-z0-9_-]{1,96}$`, 'u').test(descriptor.serverId)) {
        throw new Error(`Invalid battle-result server ID: ${descriptor.serverId}`);
    }
    if (!Number.isSafeInteger(descriptor.generalNo) || descriptor.generalNo < 0) {
        throw new Error(`Invalid battle-result general number for ${descriptor.serverId}`);
    }
    if (
        !Number.isSafeInteger(descriptor.sourceBytes) ||
        descriptor.sourceBytes < 0 ||
        descriptor.sourceBytes > MAX_BATTLE_RESULT_FILE_BYTES ||
        !HASH.test(descriptor.contentHash)
    ) {
        throw new Error(`Invalid battle-result descriptor for ${descriptor.serverId}/${descriptor.generalNo}`);
    }
};

const manifestFor = (serverId: string, files: BattleResultFileDescriptor[]): BattleResultSeasonManifest => {
    files.sort((left, right) => left.generalNo - right.generalNo);
    const manifest = createHash('sha256');
    for (const file of files) {
        manifest.update(`${file.generalNo}\0${file.sourceBytes}\0${file.contentHash}\n`);
    }
    return {
        serverId,
        files,
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.sourceBytes, 0),
        manifestHash: manifest.digest('hex'),
    };
};

export const listBattleResultSeasons = async (
    source: BattleResultSourceConfig,
    profile: LegacyArchiveProfile
): Promise<BattleResultSeasonManifest[]> => {
    const grouped = new Map<string, BattleResultFileDescriptor[]>();
    for (const descriptor of await descriptors(source, profile)) {
        validateDescriptor(descriptor, profile);
        const files = grouped.get(descriptor.serverId) ?? [];
        if (files.some((file) => file.generalNo === descriptor.generalNo)) {
            throw new Error(`Duplicate battle-result file for ${descriptor.serverId}/${descriptor.generalNo}`);
        }
        files.push(descriptor);
        grouped.set(descriptor.serverId, files);
    }
    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([serverId, files]) => manifestFor(serverId, files));
};

export const readBattleResultSeason = async (
    source: BattleResultSourceConfig,
    profile: LegacyArchiveProfile,
    serverId: string
): Promise<{ manifest: BattleResultSeasonManifest; files: BattleResultFile[] }> => {
    const files: BattleResultFile[] = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const descriptor of await descriptors(source, profile, new Set([serverId]))) {
        validateDescriptor(descriptor, profile);
        if (descriptor.serverId !== serverId || typeof descriptor.contentBase64 !== 'string') {
            throw new Error(`Unexpected battle-result file while reading ${serverId}`);
        }
        const bytes = Buffer.from(descriptor.contentBase64, 'base64');
        if (
            bytes.byteLength !== descriptor.sourceBytes ||
            createHash('sha256').update(bytes).digest('hex') !== descriptor.contentHash
        ) {
            throw new Error(`Battle-result content changed while reading ${serverId}/${descriptor.generalNo}`);
        }
        const content = decoder.decode(bytes);
        if (content.includes('\0'))
            throw new Error(`Battle-result file contains NUL: ${serverId}/${descriptor.generalNo}`);
        files.push({
            serverId,
            generalNo: descriptor.generalNo,
            sourceBytes: descriptor.sourceBytes,
            contentHash: descriptor.contentHash,
            content,
            lineCount: content.split(/\r?\n/u).filter((line) => line.length > 0).length,
        });
    }
    return { manifest: manifestFor(serverId, files), files };
};
