import { createHash, createHmac, randomUUID } from 'node:crypto';

export class ImageWorkBusyError extends Error {
    constructor() {
        super('Image service is busy.');
    }
}

/** Admission lasts until actual work settles, including work that ignores abort. No queue. */
export class ImageWorkBudget {
    private pending = 0;
    constructor(private readonly limit = 4) {}
    async run<T>(work: () => Promise<T>): Promise<T> {
        if (this.pending >= this.limit) throw new ImageWorkBusyError();
        this.pending++;
        try {
            return await work();
        } finally {
            this.pending--;
        }
    }
}

export class ImageUploadError extends Error {}
const uploadBudget = new ImageWorkBudget();
export const MAX_IMAGE_RESPONSE_BYTES = 16 * 1024;
export const IMAGE_UPLOAD_TIMEOUT_MS = 10_000;

export const isRasterImage = (body: Buffer): boolean =>
    body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (body[0] === 255 && body[1] === 216 && body[2] === 255) ||
    ['GIF87a', 'GIF89a'].includes(body.toString('ascii', 0, 6)) ||
    (body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') ||
    body.toString('ascii', 0, 2) === 'BM' ||
    ['49492a00', '4d4d002a', '49492b00', '4d4d002b'].includes(body.subarray(0, 4).toString('hex')) ||
    (body.length >= 12 && body.toString('ascii', 4, 8) === 'ftyp');

export const performSignedImageUpload = async (
    input: {
        kind: 'content' | 'user-icons';
        baseUrl: string;
        filename: string;
        contentType: string;
        body: Buffer;
        secret: string;
    },
    fetchImpl: typeof fetch = fetch,
    now: () => number = Date.now,
    options: { timeoutMs?: number; budget?: ImageWorkBudget } = {}
): Promise<void> => {
    const base = new URL(input.baseUrl);
    if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        !/^[a-f0-9]{32}\.(?:avif|webp|jpg|png|gif)$/.test(input.filename) ||
        input.body.length > 16 * 1024 * 1024
    ) {
        throw new ImageUploadError('Invalid image upload.');
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = (options.budget ?? uploadBudget).run(async () => {
        const pathname = `/v1/uploads/${input.kind}/core2026/${input.filename}`;
        const expires = String(Math.floor(now() / 1000) + 60);
        const requestId = randomUUID();
        const digest = createHash('sha256').update(input.body).digest('hex');
        const signature = createHmac('sha256', input.secret)
            .update(`${expires}.${requestId}.${pathname}.${input.contentType}.${digest}`)
            .digest('hex');
        const response = await fetchImpl(`${input.baseUrl.replace(/\/$/, '')}${pathname}`, {
            method: 'PUT',
            redirect: 'error',
            signal: controller.signal,
            headers: {
                'content-type': input.contentType,
                'x-image-client': 'core2026',
                'x-image-expires': expires,
                'x-image-request-id': requestId,
                'x-image-signature': signature,
            },
            body: new Uint8Array(input.body),
        });
        if (controller.signal.aborted || !response.ok) {
            await response.body?.cancel();
            throw new ImageUploadError(
                controller.signal.aborted
                    ? 'Image upload timed out.'
                    : `Image repository upload failed with HTTP ${response.status}.`
            );
        }
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (declared > MAX_IMAGE_RESPONSE_BYTES) {
            await response.body?.cancel();
            throw new ImageUploadError('Image response exceeds its size limit.');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new ImageUploadError('Image repository returned an invalid response.');
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
            for (;;) {
                const chunk = await reader.read();
                if (controller.signal.aborted) throw new ImageUploadError('Image upload timed out.');
                if (chunk.done) break;
                total += chunk.value.byteLength;
                if (total > MAX_IMAGE_RESPONSE_BYTES)
                    throw new ImageUploadError('Image response exceeds its size limit.');
                chunks.push(chunk.value);
            }
        } catch (error) {
            await reader.cancel();
            throw error;
        } finally {
            reader.releaseLock();
        }
        const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const expected =
            input.kind === 'content' ? `uploads/core2026/${input.filename}` : `icons/users/core2026/${input.filename}`;
        if (!payload || typeof payload !== 'object' || !('path' in payload) || payload.path !== expected) {
            throw new ImageUploadError('Image repository returned an unexpected upload path.');
        }
    });
    try {
        await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new ImageUploadError('Image upload timed out.'));
                }, options.timeoutMs ?? IMAGE_UPLOAD_TIMEOUT_MS);
            }),
        ]);
    } catch (error) {
        if (error instanceof ImageWorkBusyError || error instanceof ImageUploadError) throw error;
        // Request errors can contain credential-bearing URLs and signatures.
        throw new ImageUploadError('Image repository upload failed.');
    } finally {
        clearTimeout(timer);
    }
};
