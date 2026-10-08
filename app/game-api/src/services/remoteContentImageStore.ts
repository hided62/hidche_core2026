import { performSignedImageUpload } from '@sammo-ts/common/images/imageUpload';

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
        await performSignedImageUpload(
            {
                ...input,
                kind: 'content',
                baseUrl: this.baseUrl,
                secret: this.secret,
            },
            this.fetchImpl,
            this.now
        );
        return { publicUrl: `${this.publicBaseUrl.replace(/\/$/, '')}/${input.filename}` };
    }
}
