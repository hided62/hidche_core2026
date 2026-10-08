import { performSignedImageUpload } from '@sammo-ts/common/images/imageUpload';

export interface UserIconUploadResult {
    picture: string;
    publicUrl: string;
}

export interface UserIconUploadStore {
    upload(input: { filename: string; contentType: string; body: Buffer }): Promise<UserIconUploadResult>;
}

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
        await performSignedImageUpload(
            {
                ...input,
                kind: 'user-icons',
                baseUrl: this.baseUrl,
                secret: this.secret,
            },
            this.fetchImpl,
            this.now
        );
        const picture = `users/core2026/${input.filename}`;
        return { picture, publicUrl: `${this.publicBaseUrl.replace(/\/$/, '')}/${picture}` };
    }
}
