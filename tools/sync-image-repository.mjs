import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://sam-image.hided.net';
const DEFAULT_SECRET_FILE = '/run/secrets/image_sync_core2026_secret';

const parseArgs = (argv) => {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--commit' || argument === '--url' || argument === '--secret-file') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error(`${argument} requires a value.`);
            }
            result[argument.slice(2)] = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${argument}`);
    }
    return result;
};

const normalizeEndpoint = (baseUrl) => {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Image sync URL must use HTTP or HTTPS.');
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/sync`;
    url.search = '';
    url.hash = '';
    return url.toString();
};

export const syncImageRepository = async ({
    baseUrl = DEFAULT_BASE_URL,
    secretFile = DEFAULT_SECRET_FILE,
    commit,
    fetchImpl = fetch,
    now = Date.now,
    requestIdFactory = randomUUID,
} = {}) => {
    if (commit !== undefined && !/^[0-9a-f]{40,64}$/i.test(commit)) {
        throw new Error('Commit must be a full 40-64 character hexadecimal object ID.');
    }
    const secret = (await readFile(secretFile, 'utf8')).trim();
    if (secret.length < 32) {
        throw new Error('IMAGE_SYNC_SECRET_FILE must contain at least 32 characters.');
    }
    const body = commit ? JSON.stringify({ commit }) : '{}';
    const timestamp = String(Math.floor(now() / 1000));
    const requestId = requestIdFactory();
    const signature = createHmac('sha256', secret).update(`${timestamp}.${requestId}.${body}`).digest('hex');
    const response = await fetchImpl(normalizeEndpoint(baseUrl), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-image-client': 'core2026',
            'x-image-timestamp': timestamp,
            'x-image-request-id': requestId,
            'x-image-signature': signature,
        },
        body,
    });
    if (!response.ok) {
        throw new Error(`Image repository sync failed with HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || payload.ok !== true) {
        throw new Error('Image repository returned an unexpected sync response.');
    }
    return payload;
};

const run = async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await syncImageRepository({
        baseUrl: args.url ?? process.env.IMAGE_SYNC_URL ?? DEFAULT_BASE_URL,
        secretFile: args['secret-file'] ?? process.env.IMAGE_SYNC_SECRET_FILE ?? DEFAULT_SECRET_FILE,
        commit: args.commit,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
