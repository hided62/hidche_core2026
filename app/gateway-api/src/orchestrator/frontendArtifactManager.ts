import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export type FrontendServeMode = 'preview' | 'static';

export interface FrontendArtifactManifest {
    version: 1;
    frontendKey: string;
    commitSha: string;
    digest: string;
    releaseId: string;
    files: number;
    dependencies?: FrontendArtifactDependency[];
}

export interface FrontendArtifactDependency {
    frontendKey: string;
    releaseId: string;
}

export interface StagedFrontendArtifact {
    releaseId: string;
    releasePath: string;
    manifest: FrontendArtifactManifest;
}

export interface FrontendArtifactCleanupResult {
    removed: string[];
    retained: string[];
    skipped: string[];
}

export interface FrontendArtifactCleanupOptions {
    frontendKeys: string[];
    protectedCommitShas?: Iterable<string>;
    retentionMs: number;
    keepNewest: number;
    now?: Date;
    cleanupProfileWrapperStaging?: boolean;
}

export interface ProfileFrontendRuntimeConfig {
    version: 1;
    profile: string;
    profileName: string;
    appBasePath: string;
    gameApiUrl: string;
    gameSseUrl: string;
    gatewayApiUrl: string;
    gatewayWebUrl: string;
    buildCommitSha: string;
    assetReleaseId: string;
}

export const SHARED_GAME_FRONTEND_KEY = 'game-assets';
export const GAME_FRONTEND_RUNTIME_CONFIG_ID = 'sammo-runtime-config';
export const DEFAULT_FRONTEND_ARTIFACT_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_FRONTEND_ARTIFACT_KEEP_NEWEST = 2;

const MANIFEST_FILE = '.sammo-artifact.json';
const FRONTEND_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const COMMIT_SHA = /^[0-9a-f]{40,64}$/iu;
const PUBLIC_ASSET_BASE = /^\/[0-9A-Za-z/_-]*$/u;
const RELEASE_ID = /^[0-9a-f]{40,64}-[0-9a-f]{16}$/iu;
const STAGING_DIRECTORY = /^\.staging-[0-9a-f-]+$/iu;

export const resolveFrontendServeMode = (value: string | undefined): FrontendServeMode => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || normalized === 'preview') return 'preview';
    if (normalized === 'static') return 'static';
    throw new Error('FRONTEND_SERVE_MODE must be preview or static.');
};

const assertFrontendKey = (value: string): void => {
    if (!FRONTEND_KEY.test(value)) throw new Error(`Invalid frontend artifact key: ${value}`);
};

const assertCommitSha = (value: string): void => {
    if (!COMMIT_SHA.test(value)) throw new Error('Frontend artifact commit SHA must be a full hexadecimal SHA.');
};

const assertReleaseId = (value: string): void => {
    if (!RELEASE_ID.test(value)) throw new Error(`Invalid frontend artifact release id: ${value}`);
};

const normalizeDependencies = (
    dependencies: FrontendArtifactDependency[] | undefined
): FrontendArtifactDependency[] => {
    if (!dependencies) return [];
    const normalized = dependencies.map((dependency) => {
        assertFrontendKey(dependency.frontendKey);
        assertReleaseId(dependency.releaseId);
        return {
            frontendKey: dependency.frontendKey,
            releaseId: dependency.releaseId.toLowerCase(),
        };
    });
    normalized.sort((left, right) =>
        `${left.frontendKey}/${left.releaseId}`.localeCompare(`${right.frontendKey}/${right.releaseId}`)
    );
    return normalized.filter(
        (dependency, index) =>
            index === 0 ||
            dependency.frontendKey !== normalized[index - 1].frontendKey ||
            dependency.releaseId !== normalized[index - 1].releaseId
    );
};

const listSourceFiles = async (sourceRoot: string): Promise<string[]> => {
    const rootStat = await fs.lstat(sourceRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error(`Frontend artifact source must be a real directory: ${sourceRoot}`);
    }
    const files: string[] = [];
    const visit = async (relativeDirectory: string): Promise<void> => {
        const directory = path.join(sourceRoot, relativeDirectory);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const relativePath = path.join(relativeDirectory, entry.name);
            const absolutePath = path.join(sourceRoot, relativePath);
            const stat = await fs.lstat(absolutePath);
            if (stat.isSymbolicLink()) {
                throw new Error(`Frontend artifact source contains a symbolic link: ${relativePath}`);
            }
            if (stat.isDirectory()) {
                await visit(relativePath);
                continue;
            }
            if (!stat.isFile()) {
                throw new Error(`Frontend artifact source contains an unsupported entry: ${relativePath}`);
            }
            files.push(relativePath);
        }
    };
    await visit('');
    if (!files.includes('index.html')) {
        throw new Error(`Frontend artifact source is missing index.html: ${sourceRoot}`);
    }
    return files;
};

const buildDigest = async (sourceRoot: string, files: string[]): Promise<string> => {
    const hash = createHash('sha256');
    for (const relativePath of files) {
        hash.update(relativePath.split(path.sep).join('/'));
        hash.update('\0');
        hash.update(await fs.readFile(path.join(sourceRoot, relativePath)));
        hash.update('\0');
    }
    return hash.digest('hex');
};

const readManifest = async (releasePath: string): Promise<FrontendArtifactManifest> => {
    const raw = JSON.parse(
        await fs.readFile(path.join(releasePath, MANIFEST_FILE), 'utf8')
    ) as Partial<FrontendArtifactManifest>;
    if (
        raw.version !== 1 ||
        typeof raw.frontendKey !== 'string' ||
        typeof raw.commitSha !== 'string' ||
        typeof raw.digest !== 'string' ||
        typeof raw.releaseId !== 'string' ||
        typeof raw.files !== 'number' ||
        (raw.dependencies !== undefined && !Array.isArray(raw.dependencies))
    ) {
        throw new Error(`Invalid frontend artifact manifest: ${releasePath}`);
    }
    const dependencies = normalizeDependencies(raw.dependencies);
    await fs.access(path.join(releasePath, 'index.html'));
    return { ...(raw as FrontendArtifactManifest), ...(dependencies.length > 0 ? { dependencies } : {}) };
};

const isMissing = (error: unknown): boolean =>
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';

const escapeEmbeddedJson = (value: unknown): string =>
    JSON.stringify(value)
        .replaceAll('&', '\\u0026')
        .replaceAll('<', '\\u003c')
        .replaceAll('>', '\\u003e')
        .replaceAll('\u2028', '\\u2028')
        .replaceAll('\u2029', '\\u2029');

export const renderProfileFrontendIndex = (options: {
    sharedIndexHtml: string;
    sharedReleaseId: string;
    sharedAssetPublicBase: string;
    runtimeConfig: ProfileFrontendRuntimeConfig;
}): string => {
    const publicBase = options.sharedAssetPublicBase.trim().replace(/\/+$/u, '');
    if (!PUBLIC_ASSET_BASE.test(publicBase) || !publicBase) {
        throw new Error(`Invalid shared frontend asset public base: ${options.sharedAssetPublicBase}`);
    }
    if (options.runtimeConfig.assetReleaseId !== options.sharedReleaseId) {
        throw new Error('Profile frontend runtime config does not match the shared asset release.');
    }
    const releaseBase = `${publicBase}/${options.sharedReleaseId}`;
    const rewritten = options.sharedIndexHtml.replace(
        /\b(src|href)="\.\/(assets\/[^"?#]+(?:[?#][^"]*)?)"/gu,
        (_match, attribute: string, assetPath: string) => `${attribute}="${releaseBase}/${assetPath}"`
    );
    if (rewritten === options.sharedIndexHtml || /(?:src|href)="\.\/assets\//u.test(rewritten)) {
        throw new Error('Shared frontend index does not contain only rewritable relative asset URLs.');
    }
    const moduleScript = rewritten.search(/<script\b[^>]*\btype="module"/iu);
    if (moduleScript < 0) {
        throw new Error('Shared frontend index is missing its module script.');
    }
    const runtimeScript = `    <script id="${GAME_FRONTEND_RUNTIME_CONFIG_ID}" type="application/json">${escapeEmbeddedJson(options.runtimeConfig)}</script>\n`;
    return `${rewritten.slice(0, moduleScript)}${runtimeScript}${rewritten.slice(moduleScript)}`;
};

export class FrontendArtifactManager {
    readonly root: string;

    constructor(root: string) {
        this.root = path.resolve(root);
    }

    private frontendRoot(frontendKey: string): string {
        assertFrontendKey(frontendKey);
        return path.join(this.root, frontendKey);
    }

    private releasePath(frontendKey: string, releaseId: string): string {
        assertReleaseId(releaseId);
        return path.join(this.frontendRoot(frontendKey), 'releases', releaseId);
    }

    private async readPointerReleaseId(frontendKey: string, pointer: 'current' | 'previous'): Promise<string | null> {
        const frontendRoot = this.frontendRoot(frontendKey);
        let target: string;
        try {
            target = await fs.readlink(path.join(frontendRoot, pointer));
        } catch (error) {
            if (isMissing(error)) return null;
            throw error;
        }
        const normalized = target.split(path.sep).join('/');
        const match = /^releases\/([0-9a-f]{40,64}-[0-9a-f]{16})$/iu.exec(normalized);
        if (!match) throw new Error(`Invalid ${pointer} frontend artifact pointer for ${frontendKey}.`);
        const manifest = await readManifest(this.releasePath(frontendKey, match[1]));
        if (manifest.frontendKey !== frontendKey || manifest.releaseId !== match[1]) {
            throw new Error(`Frontend artifact manifest does not match ${frontendKey}/${match[1]}.`);
        }
        return match[1];
    }

    private async readReleaseDependencies(
        frontendKey: string,
        releaseId: string
    ): Promise<FrontendArtifactDependency[]> {
        const releasePath = this.releasePath(frontendKey, releaseId);
        const manifest = await readManifest(releasePath);
        if (manifest.dependencies?.length) return manifest.dependencies;
        const indexHtml = await fs.readFile(path.join(releasePath, 'index.html'), 'utf8');
        if (!indexHtml.includes(GAME_FRONTEND_RUNTIME_CONFIG_ID)) return [];
        const runtimeScript =
            /<script\b(?=[^>]*\bid="sammo-runtime-config")(?=[^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script>/iu.exec(
                indexHtml
            );
        if (!runtimeScript) {
            throw new Error(`Invalid profile frontend runtime config script: ${releasePath}`);
        }
        const runtimeConfig = JSON.parse(runtimeScript[1]) as Partial<ProfileFrontendRuntimeConfig>;
        if (typeof runtimeConfig.assetReleaseId !== 'string') {
            throw new Error(`Profile frontend runtime config has no shared asset release: ${releasePath}`);
        }
        assertReleaseId(runtimeConfig.assetReleaseId);
        return [{ frontendKey: SHARED_GAME_FRONTEND_KEY, releaseId: runtimeConfig.assetReleaseId.toLowerCase() }];
    }

    private async touchRelease(frontendKey: string, releaseId: string, at: Date): Promise<void> {
        const releasePath = this.releasePath(frontendKey, releaseId);
        const dependencies = await this.readReleaseDependencies(frontendKey, releaseId);
        for (const dependency of dependencies) {
            const dependencyPath = this.releasePath(dependency.frontendKey, dependency.releaseId);
            const dependencyManifest = await readManifest(dependencyPath);
            if (
                dependencyManifest.frontendKey !== dependency.frontendKey ||
                dependencyManifest.releaseId !== dependency.releaseId
            ) {
                throw new Error(
                    `Frontend artifact dependency manifest does not match ${dependency.frontendKey}/${dependency.releaseId}.`
                );
            }
            await fs.utimes(dependencyPath, at, at);
        }
        await fs.utimes(releasePath, at, at);
    }

    async stage(options: {
        frontendKey: string;
        sourceRoot: string;
        commitSha: string;
        dependencies?: FrontendArtifactDependency[];
    }): Promise<StagedFrontendArtifact> {
        assertFrontendKey(options.frontendKey);
        assertCommitSha(options.commitSha);
        const commitSha = options.commitSha.toLowerCase();
        const sourceRoot = path.resolve(options.sourceRoot);
        const files = await listSourceFiles(sourceRoot);
        const digest = await buildDigest(sourceRoot, files);
        const releaseId = `${commitSha}-${digest.slice(0, 16)}`;
        const releasePath = this.releasePath(options.frontendKey, releaseId);
        const dependencies = normalizeDependencies(options.dependencies);
        for (const dependency of dependencies) {
            const dependencyManifest = await readManifest(
                this.releasePath(dependency.frontendKey, dependency.releaseId)
            );
            if (
                dependencyManifest.frontendKey !== dependency.frontendKey ||
                dependencyManifest.releaseId !== dependency.releaseId
            ) {
                throw new Error(
                    `Frontend artifact dependency manifest does not match ${dependency.frontendKey}/${dependency.releaseId}.`
                );
            }
        }
        const manifest: FrontendArtifactManifest = {
            version: 1,
            frontendKey: options.frontendKey,
            commitSha,
            digest,
            releaseId,
            files: files.length,
            ...(dependencies.length > 0 ? { dependencies } : {}),
        };
        try {
            const existing = await readManifest(releasePath);
            if (existing.digest !== digest || existing.commitSha !== commitSha) {
                throw new Error(`Frontend artifact release collision: ${releaseId}`);
            }
            return { releaseId, releasePath, manifest: existing };
        } catch (error) {
            if (!isMissing(error)) throw error;
        }

        const releasesRoot = path.dirname(releasePath);
        await fs.mkdir(releasesRoot, { recursive: true, mode: 0o755 });
        const stagingPath = path.join(releasesRoot, `.staging-${randomUUID()}`);
        await fs.mkdir(stagingPath, { mode: 0o755 });
        try {
            for (const relativePath of files) {
                const targetPath = path.join(stagingPath, relativePath);
                await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o755 });
                await fs.copyFile(path.join(sourceRoot, relativePath), targetPath);
                await fs.chmod(targetPath, 0o644);
            }
            await fs.writeFile(path.join(stagingPath, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
                encoding: 'utf8',
                mode: 0o644,
            });
            try {
                await fs.rename(stagingPath, releasePath);
            } catch (error) {
                if (
                    !isMissing(error) &&
                    error instanceof Error &&
                    'code' in error &&
                    (error as NodeJS.ErrnoException).code === 'EEXIST'
                ) {
                    const existing = await readManifest(releasePath);
                    if (existing.digest !== digest || existing.commitSha !== commitSha) throw error;
                } else {
                    throw error;
                }
            }
        } finally {
            await fs.rm(stagingPath, { recursive: true, force: true });
        }
        return { releaseId, releasePath, manifest };
    }

    async stageProfileWrapper(options: {
        frontendKey: string;
        sharedArtifact: StagedFrontendArtifact;
        sharedAssetPublicBase: string;
        runtimeConfig: Omit<ProfileFrontendRuntimeConfig, 'buildCommitSha' | 'assetReleaseId'>;
    }): Promise<StagedFrontendArtifact> {
        if (options.runtimeConfig.profile !== options.frontendKey) {
            throw new Error('Profile frontend wrapper key does not match its runtime profile.');
        }
        await fs.mkdir(this.root, { recursive: true, mode: 0o755 });
        const sourceRoot = await fs.mkdtemp(path.join(this.root, '.profile-wrapper-'));
        try {
            const runtimeConfig: ProfileFrontendRuntimeConfig = {
                ...options.runtimeConfig,
                buildCommitSha: options.sharedArtifact.manifest.commitSha,
                assetReleaseId: options.sharedArtifact.releaseId,
            };
            const sharedIndexHtml = await fs.readFile(
                path.join(options.sharedArtifact.releasePath, 'index.html'),
                'utf8'
            );
            const wrapperIndexHtml = renderProfileFrontendIndex({
                sharedIndexHtml,
                sharedReleaseId: options.sharedArtifact.releaseId,
                sharedAssetPublicBase: options.sharedAssetPublicBase,
                runtimeConfig,
            });
            await fs.writeFile(path.join(sourceRoot, 'index.html'), wrapperIndexHtml, {
                encoding: 'utf8',
                mode: 0o644,
            });
            await fs.copyFile(
                path.join(options.sharedArtifact.releasePath, 'deployment-version.json'),
                path.join(sourceRoot, 'deployment-version.json')
            );
            return await this.stage({
                frontendKey: options.frontendKey,
                sourceRoot,
                commitSha: options.sharedArtifact.manifest.commitSha,
                dependencies: [
                    {
                        frontendKey: SHARED_GAME_FRONTEND_KEY,
                        releaseId: options.sharedArtifact.releaseId,
                    },
                ],
            });
        } finally {
            await fs.rm(sourceRoot, { recursive: true, force: true });
        }
    }

    async readCurrentReleaseId(frontendKey: string): Promise<string | null> {
        return this.readPointerReleaseId(frontendKey, 'current');
    }

    async activate(frontendKey: string, releaseId: string): Promise<string | null> {
        const frontendRoot = this.frontendRoot(frontendKey);
        const releasePath = this.releasePath(frontendKey, releaseId);
        const manifest = await readManifest(releasePath);
        if (manifest.frontendKey !== frontendKey || manifest.releaseId !== releaseId) {
            throw new Error(`Frontend artifact manifest does not match ${frontendKey}/${releaseId}.`);
        }
        await fs.mkdir(frontendRoot, { recursive: true, mode: 0o755 });
        const previousReleaseId = await this.readCurrentReleaseId(frontendKey);
        const replacePointer = async (name: 'current' | 'previous', targetReleaseId: string): Promise<void> => {
            const temporary = path.join(frontendRoot, `.${name}-${randomUUID()}`);
            await fs.symlink(path.join('releases', targetReleaseId), temporary);
            try {
                await fs.rename(temporary, path.join(frontendRoot, name));
            } finally {
                await fs.rm(temporary, { force: true });
            }
        };
        const activatedAt = new Date();
        await this.touchRelease(frontendKey, releaseId, activatedAt);
        if (previousReleaseId && previousReleaseId !== releaseId) {
            await this.touchRelease(frontendKey, previousReleaseId, activatedAt);
            await replacePointer('previous', previousReleaseId);
        }
        await replacePointer('current', releaseId);
        return previousReleaseId;
    }

    async stageAndActivate(options: {
        frontendKey: string;
        sourceRoot: string;
        commitSha: string;
    }): Promise<StagedFrontendArtifact & { previousReleaseId: string | null }> {
        const staged = await this.stage(options);
        const previousReleaseId = await this.activate(options.frontendKey, staged.releaseId);
        return { ...staged, previousReleaseId };
    }

    async deactivate(frontendKey: string): Promise<string | null> {
        const releaseId = await this.readCurrentReleaseId(frontendKey);
        await fs.rm(path.join(this.frontendRoot(frontendKey), 'current'), { force: true });
        return releaseId;
    }

    async cleanup(options: FrontendArtifactCleanupOptions): Promise<FrontendArtifactCleanupResult> {
        if (!Number.isFinite(options.retentionMs) || options.retentionMs < 0) {
            throw new Error('Frontend artifact retention must be a non-negative finite duration.');
        }
        if (!Number.isInteger(options.keepNewest) || options.keepNewest < 0) {
            throw new Error('Frontend artifact keepNewest must be a non-negative integer.');
        }
        const frontendKeys = [...new Set(options.frontendKeys)];
        frontendKeys.forEach(assertFrontendKey);
        const protectedCommitShas = new Set(
            [...(options.protectedCommitShas ?? [])].map((commitSha) => {
                assertCommitSha(commitSha);
                return commitSha.toLowerCase();
            })
        );
        const result: FrontendArtifactCleanupResult = { removed: [], retained: [], skipped: [] };
        if (frontendKeys.length === 0) return result;

        const collectProtectedReleases = async (): Promise<Map<string, Set<string>>> => {
            const protectedReleases = new Map(frontendKeys.map((frontendKey) => [frontendKey, new Set<string>()]));
            for (const frontendKey of frontendKeys) {
                for (const pointer of ['current', 'previous'] as const) {
                    const releaseId = await this.readPointerReleaseId(frontendKey, pointer);
                    if (!releaseId) continue;
                    protectedReleases.get(frontendKey)?.add(releaseId);
                    for (const dependency of await this.readReleaseDependencies(frontendKey, releaseId)) {
                        protectedReleases.get(dependency.frontendKey)?.add(dependency.releaseId);
                    }
                }
            }
            return protectedReleases;
        };

        let protectedReleases: Map<string, Set<string>>;
        try {
            protectedReleases = await collectProtectedReleases();
        } catch {
            for (const frontendKey of frontendKeys) result.skipped.push(this.frontendRoot(frontendKey));
            return result;
        }

        const cutoffMs = (options.now ?? new Date()).getTime() - options.retentionMs;
        const candidates: Array<{ frontendKey: string; releaseId: string; releasePath: string }> = [];
        const staleStagingPaths: string[] = [];
        for (const frontendKey of frontendKeys) {
            const releasesRoot = path.join(this.frontendRoot(frontendKey), 'releases');
            let entries: Dirent[];
            try {
                entries = await fs.readdir(releasesRoot, { withFileTypes: true });
            } catch (error) {
                if (isMissing(error)) continue;
                result.skipped.push(releasesRoot);
                continue;
            }
            const unprotected: Array<{ releaseId: string; releasePath: string; mtimeMs: number }> = [];
            for (const entry of entries) {
                const entryPath = path.join(releasesRoot, entry.name);
                if (STAGING_DIRECTORY.test(entry.name)) {
                    if (!entry.isDirectory()) {
                        result.skipped.push(entryPath);
                        continue;
                    }
                    const stat = await fs.lstat(entryPath);
                    if (stat.mtimeMs <= cutoffMs) staleStagingPaths.push(entryPath);
                    else result.retained.push(entryPath);
                    continue;
                }
                if (!RELEASE_ID.test(entry.name) || !entry.isDirectory()) {
                    result.skipped.push(entryPath);
                    continue;
                }
                try {
                    const manifest = await readManifest(entryPath);
                    if (manifest.frontendKey !== frontendKey || manifest.releaseId !== entry.name) {
                        result.skipped.push(entryPath);
                        continue;
                    }
                    const stat = await fs.lstat(entryPath);
                    if (
                        protectedReleases.get(frontendKey)?.has(entry.name) ||
                        protectedCommitShas.has(manifest.commitSha.toLowerCase())
                    ) {
                        result.retained.push(entryPath);
                        continue;
                    }
                    unprotected.push({ releaseId: entry.name, releasePath: entryPath, mtimeMs: stat.mtimeMs });
                } catch {
                    result.skipped.push(entryPath);
                }
            }
            unprotected.sort(
                (left, right) => right.mtimeMs - left.mtimeMs || right.releaseId.localeCompare(left.releaseId)
            );
            unprotected.forEach((release, index) => {
                if (index < options.keepNewest || release.mtimeMs > cutoffMs) {
                    result.retained.push(release.releasePath);
                } else {
                    candidates.push({ frontendKey, releaseId: release.releaseId, releasePath: release.releasePath });
                }
            });
        }

        if (options.cleanupProfileWrapperStaging) {
            let entries: Dirent[] = [];
            try {
                entries = await fs.readdir(this.root, { withFileTypes: true });
            } catch (error) {
                if (!isMissing(error)) result.skipped.push(this.root);
            }
            for (const entry of entries) {
                if (!entry.name.startsWith('.profile-wrapper-')) continue;
                const entryPath = path.join(this.root, entry.name);
                if (!entry.isDirectory()) {
                    result.skipped.push(entryPath);
                    continue;
                }
                const stat = await fs.lstat(entryPath);
                if (stat.mtimeMs <= cutoffMs) staleStagingPaths.push(entryPath);
                else result.retained.push(entryPath);
            }
        }

        for (const candidate of candidates) {
            try {
                protectedReleases = await collectProtectedReleases();
                if (protectedReleases.get(candidate.frontendKey)?.has(candidate.releaseId)) {
                    result.retained.push(candidate.releasePath);
                    continue;
                }
                const stat = await fs.lstat(candidate.releasePath);
                if (!stat.isDirectory() || stat.isSymbolicLink()) {
                    result.skipped.push(candidate.releasePath);
                    continue;
                }
                await fs.rm(candidate.releasePath, { recursive: true });
                result.removed.push(candidate.releasePath);
            } catch (error) {
                if (!isMissing(error)) result.skipped.push(candidate.releasePath);
            }
        }
        for (const stagingPath of staleStagingPaths) {
            try {
                const stat = await fs.lstat(stagingPath);
                if (!stat.isDirectory() || stat.isSymbolicLink()) {
                    result.skipped.push(stagingPath);
                    continue;
                }
                await fs.rm(stagingPath, { recursive: true });
                result.removed.push(stagingPath);
            } catch (error) {
                if (!isMissing(error)) result.skipped.push(stagingPath);
            }
        }
        return result;
    }
}
