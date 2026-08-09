const normalizeProfileName = (profileName: string): string => {
    const trimmed = profileName.trim();
    return trimmed.length > 0 ? trimmed : 'unknown';
};

export const buildGameEventChannel = (profileName: string): string => {
    const normalized = normalizeProfileName(profileName);
    return `sammo:${normalized}:realtime:events`;
};

export const buildGameReadModelRevisionKey = (profileName: string): string => {
    const normalized = normalizeProfileName(profileName);
    return `sammo:${normalized}:read-model:revision`;
};

export const buildGameReadModelDomainRevisionKey = (profileName: string): string => {
    const normalized = normalizeProfileName(profileName);
    return `sammo:${normalized}:read-model:domain-revisions`;
};
