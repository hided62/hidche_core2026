import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const profileFlagIndex = args.indexOf('--profile');
const profile = profileFlagIndex >= 0 ? args[profileFlagIndex + 1] : process.env.PROFILE;

if (!profile) {
    console.error('Missing profile. Use --profile or set PROFILE.');
    process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outputDir = path.join(repoRoot, 'dist', profile);
const resourceRoot = path.join(repoRoot, 'app', 'game-engine', 'resources');

const copyDir = async (sourceDir, targetDir) => {
    await fs.mkdir(targetDir, { recursive: true });
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    await Promise.all(
        entries.map(async (entry) => {
            const sourcePath = path.join(sourceDir, entry.name);
            const targetPath = path.join(targetDir, entry.name);

            if (entry.isDirectory()) {
                await copyDir(sourcePath, targetPath);
                return;
            }
            if (entry.isFile()) {
                await fs.copyFile(sourcePath, targetPath);
            }
        })
    );
};

const copyResources = async () => {
    const resourceDirs = ['map', 'scenario'];
    for (const dirName of resourceDirs) {
        const sourceDir = path.join(resourceRoot, dirName);
        const targetDir = path.join(outputDir, 'resources', dirName);
        await copyDir(sourceDir, targetDir);
    }
};

console.log(`[build-scripts] build:server placeholder for profile: ${profile}`);
console.log(`[build-scripts] Expected output: ${outputDir}`);

await copyResources();
console.log('[build-scripts] Copied game-engine resources (map/scenario).');
