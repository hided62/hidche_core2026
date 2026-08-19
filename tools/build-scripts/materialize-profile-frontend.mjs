import { randomUUID } from 'node:crypto';
import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const sanitizeArtifactName = (value) => value.replace(/[^0-9A-Za-z._-]+/g, '_');

const pathExists = async (target) => {
    try {
        await stat(target);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
};

export const materializeProfileFrontend = async (workspaceRoot, profileName) => {
    const normalizedProfileName = profileName.trim();
    if (!normalizedProfileName) throw new Error('profileName is required.');

    const source = path.join(workspaceRoot, 'app', 'game-frontend', '.release-build');
    const target = path.join(
        workspaceRoot,
        '.release-dist',
        sanitizeArtifactName(normalizedProfileName),
        'game-frontend'
    );
    await stat(path.join(source, 'index.html'));

    const parent = path.dirname(target);
    const nonce = `${process.pid}-${randomUUID()}`;
    const staging = path.join(parent, `.game-frontend-staging-${nonce}`);
    const previous = path.join(parent, `.game-frontend-previous-${nonce}`);
    await mkdir(parent, { recursive: true });
    await cp(source, staging, { recursive: true, errorOnExist: true, force: false });

    let movedPrevious = false;
    try {
        if (await pathExists(target)) {
            await rename(target, previous);
            movedPrevious = true;
        }
        await rename(staging, target);
        if (movedPrevious) await rm(previous, { recursive: true, force: true });
    } catch (error) {
        await rm(staging, { recursive: true, force: true });
        if (movedPrevious && !(await pathExists(target))) await rename(previous, target);
        throw error;
    }

    return target;
};

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectExecution) {
    const profileName = process.argv[2];
    if (!profileName) throw new Error('Usage: materialize-profile-frontend.mjs <profileName>');
    const target = await materializeProfileFrontend(process.cwd(), profileName);
    process.stdout.write(`Profile frontend materialized at ${target}\n`);
}
