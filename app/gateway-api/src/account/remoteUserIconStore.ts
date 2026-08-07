import { createHash, createHmac, randomUUID } from 'node:crypto';

export interface UserIconUploadResult {
    picture: string;
    publicUrl: string;
}

export interface UserIconUploadStore {
    upload(input: { filename: string; contentType: string; body: Buffer }): Promise<UserIconUploadResult>;
}

const signature = (
    secret: string,
    expires: string,
    requestId: string,
    pathname: string,
    contentType: string,
    body: Buffer
): string => {
    const digest = createHash('sha256').update(body).digest('hex');
    return createHmac('sha256', secret)
        .update(`${expires}.${requestId}.${pathname}.${contentType}.${digest}`)
        .digest('hex');
};

export class RemoteUserIconStore implements UserIconUploadStore {
    constructor(
        private readonly baseUrl: string,
        private readonly publicBaseUrl: string,
        private readonly secret: string,
        private readonly fetchImpl: typeof fetch = fetch,
        private readonly now: () => number = Date.now
    ) {}

    async upload(input: { filename: string; contentType: string; body: Buffer }): Promise<UserIconUploadResult> {
        if (!/^[a-f0-9]{32}\.(?:avif|webp|jpg|png|gif)$/.test(input.filename)) {
            throw new Error('Invalid user icon filename.');
        }
        const pathname = `/v1/uploads/user-icons/core2026/${input.filename}`;
        const expires = String(Math.floor(this.now() / 1000) + 60);
        const requestId = randomUUID();
        const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${pathname}`, {
            method: 'PUT',
            headers: {
                'content-type': input.contentType,
                'x-image-client': 'core2026',
                'x-image-expires': expires,
                'x-image-request-id': requestId,
                'x-image-signature': signature(
                    this.secret,
                    expires,
                    requestId,
                    pathname,
                    input.contentType,
                    input.body
                ),
            },
            body: new Uint8Array(input.body),
        });
        if (!response.ok) {
            throw new Error(`Image repository upload failed with HTTP ${response.status}.`);
        }
        const picture = `users/core2026/${input.filename}`;
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== 'object' || !('path' in payload) || payload.path !== `icons/${picture}`) {
            throw new Error('Image repository returned an unexpected upload path.');
        }
        return { picture, publicUrl: `${this.publicBaseUrl.replace(/\/$/, '')}/${picture}` };
    }
}
