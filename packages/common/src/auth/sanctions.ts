import type { UserSanctions, UserServerRestriction } from './gameToken.js';

export type SanctionFeature = 'login' | 'game' | 'messages';

const FEATURE_ALIASES: Record<SanctionFeature, ReadonlySet<string>> = {
    login: new Set(['login']),
    game: new Set(['*', 'game', 'gameplay']),
    messages: new Set(['*', 'message', 'messages']),
};

const isFutureSanctionDate = (value: string | undefined, now = new Date()): boolean => {
    if (!value) {
        return false;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > now.getTime();
};

export const isActiveServerRestriction = (
    restriction: UserServerRestriction | undefined,
    now = new Date()
): restriction is UserServerRestriction => {
    if (!restriction) {
        return false;
    }
    return restriction.until === undefined || isFutureSanctionDate(restriction.until, now);
};

export const isProfileFeatureBlocked = (
    sanctions: UserSanctions,
    profileNames: readonly string[],
    feature: SanctionFeature,
    now = new Date()
): boolean => {
    const aliases = FEATURE_ALIASES[feature];
    for (const profileName of new Set(profileNames)) {
        const restriction = sanctions.serverRestrictions?.[profileName];
        if (!isActiveServerRestriction(restriction, now)) {
            continue;
        }
        if (restriction.blockedFeatures?.some((blockedFeature) => aliases.has(blockedFeature.trim().toLowerCase()))) {
            return true;
        }
    }
    return false;
};

export const isLoginBanned = (sanctions: UserSanctions, now = new Date()): boolean =>
    isFutureSanctionDate(sanctions.bannedUntil, now);

export const isGameAccessBlocked = (
    sanctions: UserSanctions,
    profileNames: readonly string[],
    now = new Date()
): boolean =>
    isLoginBanned(sanctions, now) ||
    isFutureSanctionDate(sanctions.suspendedUntil, now) ||
    isProfileFeatureBlocked(sanctions, profileNames, 'login', now) ||
    isProfileFeatureBlocked(sanctions, profileNames, 'game', now);

export const isMessageAccessBlocked = (
    sanctions: UserSanctions,
    profileNames: readonly string[],
    now = new Date()
): boolean =>
    isGameAccessBlocked(sanctions, profileNames, now) ||
    isFutureSanctionDate(sanctions.mutedUntil, now) ||
    isProfileFeatureBlocked(sanctions, profileNames, 'messages', now);
