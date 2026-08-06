import { createHash, createHmac, randomUUID } from 'node:crypto';

export interface ContentImageUploadResult {
    publicUrl: string;
}

export interface ContentImageUploadStore {
    upload(input: { filename: string; contentType: string; body: Buffer }): Promise<ContentImageUploadResult>;
}

export class RemoteContentImageStore implements ContentImageUploadStore {
    constructor(
        private readonly baseUrl: string,
        private readonly publicBaseUrl: string,
        private readonly secret: string,
        private readonly fetchImpl: typeof fetch = fetch,
        private readonly now: () => number = Date.now
    ) {}

    async upload(input: { filename: string; contentType: string; body: Buffer }): Promise<ContentImageUploadResult> {
        if (!/^[a-f0-9]{32}\.(?:avif|webp|jpg|png|gif)$/.test(input.filename)) {
            throw new Error('Invalid content image filename.');
        }
        const pathname = `/v1/uploads/content/core2026/${input.filename}`;
        const expires = String(Math.floor(this.now() / 1000) + 60);
        const requestId = randomUUID();
        const digest = createHash('sha256').update(input.body).digest('hex');
        const signature = createHmac('sha256', this.secret)
            .update(`${expires}.${requestId}.${pathname}.${input.contentType}.${digest}`)
            .digest('hex');
        const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${pathname}`, {
            method: 'PUT',
            headers: {
                'content-type': input.contentType,
                'x-image-client': 'core2026',
                'x-image-expires': expires,
                'x-image-request-id': requestId,
                'x-image-signature': signature,
            },
            body: input.body,
        });
        if (!response.ok) {
            throw new Error(`Image repository upload failed with HTTP ${response.status}.`);
        }
        const expectedPath = `uploads/core2026/${input.filename}`;
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== 'object' || !('path' in payload) || payload.path !== expectedPath) {
            throw new Error('Image repository returned an unexpected content path.');
        }
        return { publicUrl: `${this.publicBaseUrl.replace(/\/$/, '')}/${input.filename}` };
    }
}
