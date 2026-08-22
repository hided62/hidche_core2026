import { createHash, randomUUID } from 'node:crypto';
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
}

export interface StagedFrontendArtifact {
    releaseId: string;
    releasePath: string;
    manifest: FrontendArtifactManifest;
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

const MANIFEST_FILE = '.sammo-artifact.json';
const FRONTEND_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const COMMIT_SHA = /^[0-9a-f]{40,64}$/iu;
const PUBLIC_ASSET_BASE = /^\/[0-9A-Za-z/_-]*$/u;

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
        typeof raw.files !== 'number'
    ) {
        throw new Error(`Invalid frontend artifact manifest: ${releasePath}`);
    }
    await fs.access(path.join(releasePath, 'index.html'));
    return raw as FrontendArtifactManifest;
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
        if (!/^[0-9a-f]{40,64}-[0-9a-f]{16}$/iu.test(releaseId)) {
            throw new Error(`Invalid frontend artifact release id: ${releaseId}`);
        }
        return path.join(this.frontendRoot(frontendKey), 'releases', releaseId);
    }

    async stage(options: {
        frontendKey: string;
        sourceRoot: string;
        commitSha: string;
    }): Promise<StagedFrontendArtifact> {
        assertFrontendKey(options.frontendKey);
        assertCommitSha(options.commitSha);
        const commitSha = options.commitSha.toLowerCase();
        const sourceRoot = path.resolve(options.sourceRoot);
        const files = await listSourceFiles(sourceRoot);
        const digest = await buildDigest(sourceRoot, files);
        const releaseId = `${commitSha}-${digest.slice(0, 16)}`;
        const releasePath = this.releasePath(options.frontendKey, releaseId);
        const manifest: FrontendArtifactManifest = {
            version: 1,
            frontendKey: options.frontendKey,
            commitSha,
            digest,
            releaseId,
            files: files.length,
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
            });
        } finally {
            await fs.rm(sourceRoot, { recursive: true, force: true });
        }
    }

    async readCurrentReleaseId(frontendKey: string): Promise<string | null> {
        const frontendRoot = this.frontendRoot(frontendKey);
        try {
            const target = await fs.readlink(path.join(frontendRoot, 'current'));
            const normalized = target.split(path.sep).join('/');
            const match = /^releases\/([0-9a-f]{40,64}-[0-9a-f]{16})$/iu.exec(normalized);
            if (!match) throw new Error(`Invalid current frontend artifact pointer for ${frontendKey}.`);
            await readManifest(this.releasePath(frontendKey, match[1]));
            return match[1];
        } catch (error) {
            if (isMissing(error)) return null;
            throw error;
        }
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
        if (previousReleaseId && previousReleaseId !== releaseId) {
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
}
