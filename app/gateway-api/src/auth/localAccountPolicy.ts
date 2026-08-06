import type { UserRecord } from './userRepository.js';

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
}

const readGraceDays = (meta: Record<string, unknown>, key: string, fallback: number): number => {
    const value = meta[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(Math.floor(value), 0), 365);
};

const hasAdminBypass = (user: UserRecord): boolean =>
    user.roles.some((role) => ADMIN_ROLES.has(role) || role.startsWith('admin.'));

export const resolveLocalAccountProfilePolicy = (options: {
    profile: string;
    profileMeta?: Record<string, unknown>;
    defaultGraceDays: number;
    user: UserRecord;
    now?: Date;
}): LocalAccountProfilePolicy => {
    const profile = options.profile.toLowerCase();
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
    const bypass = hasAdminBypass(options.user);
    const graceStartedAt = new Date(options.user.kakaoGraceStartedAt);
    const now = options.now ?? new Date();
    const accessEndsAt = new Date(graceStartedAt.getTime() + accessGraceDays * DAY_MS);
    const adminGraceUntil = options.user.kakaoGraceUntil ? new Date(options.user.kakaoGraceUntil) : null;
    if (adminGraceUntil && Number.isFinite(adminGraceUntil.getTime()) && adminGraceUntil > accessEndsAt) {
        accessEndsAt.setTime(adminGraceUntil.getTime());
    }
    const generalCreationEndsAt = new Date(graceStartedAt.getTime() + generalCreationGraceDays * DAY_MS);
    const accessAllowed = kakaoVerified || bypass || now < accessEndsAt;
    const canCreateGeneral = kakaoVerified || bypass || (accessAllowed && now < generalCreationEndsAt);

    return {
        requiresKakaoVerification: !kakaoVerified && !bypass,
        kakaoVerified,
        accessAllowed,
        canCreateGeneral,
        graceEndsAt: kakaoVerified || bypass ? null : accessEndsAt.toISOString(),
        generalCreationGraceDays,
        accessGraceDays,
    };
};
