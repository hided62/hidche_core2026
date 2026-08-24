import { createHash } from 'node:crypto';

export const scopeHttpIdempotencyKey = (options: {
    rawKey: string | undefined;
    profileId: string;
    userId: string | null;
}): string | undefined => {
    const rawKey = options.rawKey?.trim();
    if (!rawKey) {
        return undefined;
    }
    // Request IDs are global in input_event. Hash the untrusted header with
    // its authenticated principal and profile so equal client keys cannot
    // collide across users or profiles, and oversized/punctuation-heavy
    // headers never flow into DB identifiers or child command IDs.
    const digest = createHash('sha256')
        .update(options.profileId)
        .update('\0')
        .update(options.userId ?? 'anonymous')
        .update('\0')
        .update(rawKey)
        .digest('hex');
    return `http:${digest}`;
};
