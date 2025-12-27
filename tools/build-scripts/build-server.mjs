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

console.log(`[build-scripts] build:server placeholder for profile: ${profile}`);
console.log(`[build-scripts] Expected output: ${outputDir}`);
