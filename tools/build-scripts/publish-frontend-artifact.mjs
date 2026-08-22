#!/usr/bin/env node

import { FrontendArtifactManager } from '../../app/gateway-api/dist/index.js';

const readOptions = (args) => {
    const options = new Map();
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (!name?.startsWith('--') || !value) {
            throw new Error(
                'usage: publish-frontend-artifact --artifact-root PATH --frontend-key KEY --source-root PATH --commit-sha SHA'
            );
        }
        options.set(name.slice(2), value);
    }
    for (const required of ['artifact-root', 'frontend-key', 'source-root', 'commit-sha']) {
        if (!options.get(required)) throw new Error(`--${required} is required`);
    }
    return options;
};

const options = readOptions(process.argv.slice(2));
const manager = new FrontendArtifactManager(options.get('artifact-root'));
const result = await manager.stageAndActivate({
    frontendKey: options.get('frontend-key'),
    sourceRoot: options.get('source-root'),
    commitSha: options.get('commit-sha'),
});
console.log(
    JSON.stringify({
        frontendKey: result.manifest.frontendKey,
        commitSha: result.manifest.commitSha,
        digest: result.manifest.digest,
        releaseId: result.releaseId,
        previousReleaseId: result.previousReleaseId,
    })
);
