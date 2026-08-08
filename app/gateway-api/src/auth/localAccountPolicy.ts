import type { SpecialAccountAccessGrantRecord, UserRecord } from './userRepository.js';

const GENERAL_CREATION_GRACE_PROFILES = new Set(['nya', 'pya', 'hwe']);
const ADMIN_ROLES = new Set(['superuser', 'admin', 'admin.superuser']);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LocalAccountProfilePolicy {
    requiresKakaoVerification: boolean;
    kakaoVerified: boolean;
    accessAllowed: boolean;
    canCreateGeneral: boolean;
    graceEndsAt: string | null;
    generalCreationGraceDays: number;
    accessGraceDays: number;
    specialAccess: {
        kind: 'OPERATOR' | SpecialAccountAccessGrantRecord['kind'];
        grantId: string | null;
        expiresAt: string | null;
        allowsGeneralCreation: boolean;
    } | null;
}

const readGraceDays = (meta: Record<string, unknown>, key: string, fallback: number): number => {
    const value = meta[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(Math.floor(value), 0), 365);
};

export const hasOperatorSpecialAccess = (user: UserRecord): boolean =>
    user.roles.some((role) => ADMIN_ROLES.has(role) || role.startsWith('admin.'));

export const hasActiveSpecialAccountGrant = (
    grants: readonly SpecialAccountAccessGrantRecord[],
    now: Date = new Date()
): boolean =>
    grants.some((grant) => !grant.revokedAt && (!grant.expiresAt || new Date(grant.expiresAt).getTime() > now.getTime()));

const appliesToProfile = (grant: SpecialAccountAccessGrantRecord, profile: string, profileName: string): boolean =>
    grant.profiles.length === 0 || grant.profiles.includes(profile) || grant.profiles.includes(profileName);

const resolveSpecialAccess = (options: {
    user: UserRecord;
    grants: readonly SpecialAccountAccessGrantRecord[];
    profile: string;
    profileName: string;
    now: Date;
}): LocalAccountProfilePolicy['specialAccess'] => {
    if (hasOperatorSpecialAccess(options.user)) {
        return {
            kind: 'OPERATOR',
            grantId: null,
            expiresAt: null,
            allowsGeneralCreation: true,
        };
    }
    const active = options.grants.filter((grant) => {
        if (grant.revokedAt || !appliesToProfile(grant, options.profile, options.profileName)) {
            return false;
        }
        return !grant.expiresAt || new Date(grant.expiresAt).getTime() > options.now.getTime();
    });
    if (active.length === 0) {
        return null;
    }
    const selected = active.find((grant) => grant.allowsGeneralCreation) ?? active[0]!;
    const expiresAt = active.some((grant) => !grant.expiresAt)
        ? null
        : active
              .map((grant) => grant.expiresAt!)
              .sort((left, right) => right.localeCompare(left))[0] ?? null;
    return {
        kind: selected.kind,
        grantId: selected.id,
        expiresAt,
        allowsGeneralCreation: active.some((grant) => grant.allowsGeneralCreation),
    };
};

export const resolveLocalAccountProfilePolicy = (options: {
    profile: string;
    profileName?: string;
    profileMeta?: Record<string, unknown>;
    defaultGraceDays: number;
    user: UserRecord;
    specialAccessGrants?: readonly SpecialAccountAccessGrantRecord[];
    now?: Date;
}): LocalAccountProfilePolicy => {
    const profile = options.profile.toLowerCase();
    const profileName = (options.profileName ?? options.profile).toLowerCase();
    const meta = options.profileMeta ?? {};
    const defaultGraceDays = Math.min(Math.max(Math.floor(options.defaultGraceDays), 0), 365);
    const accessGraceDays = readGraceDays(meta, 'localAccountAccessGraceDays', defaultGraceDays);
    const generalCreationDefault = GENERAL_CREATION_GRACE_PROFILES.has(profile) ? defaultGraceDays : 0;
    const generalCreationGraceDays = readGraceDays(
        meta,
        'localAccountGeneralCreationGraceDays',
        generalCreationDefault
    );
    const kakaoVerified = options.user.oauthType === 'KAKAO' && Boolean(options.user.kakaoVerifiedAt);
    const graceStartedAt = new Date(options.user.kakaoGraceStartedAt);
    const now = options.now ?? new Date();
    const specialAccess = resolveSpecialAccess({
        user: options.user,
        grants: options.specialAccessGrants ?? [],
        profile,
        profileName,
        now,
    });
    const accessEndsAt = new Date(graceStartedAt.getTime() + accessGraceDays * DAY_MS);
    const adminGraceUntil = options.user.kakaoGraceUntil ? new Date(options.user.kakaoGraceUntil) : null;
    if (adminGraceUntil && Number.isFinite(adminGraceUntil.getTime()) && adminGraceUntil > accessEndsAt) {
        accessEndsAt.setTime(adminGraceUntil.getTime());
    }
    const generalCreationEndsAt = new Date(graceStartedAt.getTime() + generalCreationGraceDays * DAY_MS);
    const accessAllowed = kakaoVerified || specialAccess !== null || now < accessEndsAt;
    const canCreateGeneral =
        kakaoVerified || specialAccess?.allowsGeneralCreation === true || (accessAllowed && now < generalCreationEndsAt);

    return {
        requiresKakaoVerification: !kakaoVerified && specialAccess === null,
        kakaoVerified,
        accessAllowed,
        canCreateGeneral,
        graceEndsAt: kakaoVerified ? null : specialAccess ? specialAccess.expiresAt : accessEndsAt.toISOString(),
        generalCreationGraceDays,
        accessGraceDays,
        specialAccess,
    };
};
