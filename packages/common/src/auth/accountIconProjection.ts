export interface AccountIconProjection {
    revision: string;
    picture: string;
    imageServer: number;
}

export const isCanonicalIsoTimestamp = (value: string): boolean => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

export const parseAccountIconProjection = (value: unknown): AccountIconProjection => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Account icon projection must be an object.');
    }
    const record = value as Record<string, unknown>;
    if (
        Object.keys(record).length !== 3 ||
        !Object.hasOwn(record, 'revision') ||
        !Object.hasOwn(record, 'picture') ||
        !Object.hasOwn(record, 'imageServer') ||
        typeof record.revision !== 'string' ||
        !isCanonicalIsoTimestamp(record.revision) ||
        typeof record.picture !== 'string' ||
        record.picture.length === 0 ||
        typeof record.imageServer !== 'number' ||
        !Number.isSafeInteger(record.imageServer) ||
        record.imageServer < 0
    ) {
        throw new Error('Account icon projection is invalid.');
    }
    return {
        revision: record.revision,
        picture: record.picture,
        imageServer: record.imageServer,
    };
};

const canonicalRevision = (value: string | undefined): string | null =>
    value && isCanonicalIsoTimestamp(value) ? value : null;

export const resolveAccountIconProjection = (input: {
    createdAt: string;
    picture: string;
    imageServer: number;
    iconUpdatedAt?: string;
    iconRevision?: string;
    profileIconResetAt?: string;
}): AccountIconProjection => {
    const iconRevision =
        canonicalRevision(input.iconRevision) ??
        canonicalRevision(input.iconUpdatedAt) ??
        canonicalRevision(input.createdAt);
    if (!iconRevision) {
        throw new Error('User account icon revision is invalid.');
    }
    const resetRevision = canonicalRevision(input.profileIconResetAt);
    if (resetRevision && resetRevision >= iconRevision) {
        return {
            revision: resetRevision,
            picture: 'default.jpg',
            imageServer: 0,
        };
    }
    if (!input.picture || !Number.isSafeInteger(input.imageServer) || input.imageServer < 0) {
        throw new Error('User account icon is invalid.');
    }
    return {
        revision: iconRevision,
        picture: input.picture,
        imageServer: input.imageServer,
    };
};
