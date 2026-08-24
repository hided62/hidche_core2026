export interface UserRecord {
    id: string;
    username: string;
    displayName: string;
    roles: string[];
    sanctions: UserSanctions;
    oauthType: 'NONE' | 'KAKAO';
    oauthId?: string;
    email?: string;
    oauthInfo?: UserOAuthInfo;
    identityRevision?: string;
    authRevision?: number;
    sessionRevokedBefore?: string;
    kakaoReplacementApprovedUntil?: string;
    kakaoReplacementApprovedByUserId?: string;
    kakaoReplacementReason?: string;
    picture: string;
    imageServer: number;
    iconUpdatedAt?: string;
    iconRevision?: string;
    profileIconResetAt?: string;
    iconRetiredAt?: string;
    thirdPartyUse: boolean;
    termsAcceptedAt?: string;
    privacyAcceptedAt?: string;
    kakaoVerifiedAt?: string;
    kakaoTalkVerifiedUntil?: string;
    kakaoGraceStartedAt: string;
    kakaoGraceUntil?: string;
    deleteAfter?: string;
    passwordHash: string;
    passwordSalt: string;
    passwordResetRequired: boolean;
    createdAt: string;
    legacyMemberNo?: number;
    legacyGrade?: number;
}

export interface UserIconRecord {
    id: string;
    userId: string;
    picture: string;
    imageServer: number;
    createdAt: string;
    retiredAt?: string;
}

export type SpecialAccountAccessKind = 'TESTER' | 'RECOVERY' | 'OTHER';

export interface SpecialAccountAccessGrantRecord {
    id: string;
    userId: string;
    kind: SpecialAccountAccessKind;
    profiles: string[];
    allowsGeneralCreation: boolean;
    expiresAt?: string;
    reason: string;
    grantedByUserId: string;
    revokedAt?: string;
    revokedByUserId?: string;
    revokedReason?: string;
    createdAt: string;
}

export type AddUserIconResult =
    { ok: true; icon: UserIconRecord; revision: string } | { ok: false; reason: 'COOLDOWN' | 'LIMIT' | 'NOT_FOUND' };

export type RetireUserIconResult =
    | { ok: true; icon: UserIconRecord; revision: string; preferredChanged: boolean }
    | { ok: false; reason: 'COOLDOWN' | 'NOT_FOUND' | 'ALREADY_RETIRED' };

export interface PublicUser {
    id: string;
    username: string;
    displayName: string;
    roles: string[];
    picture: string;
    kakaoVerified: boolean;
    kakaoGraceStartedAt: string;
    createdAt: string;
}

export interface AdminUserListItem {
    id: string;
    username: string;
    displayName: string;
    email?: string;
    oauthType: 'NONE' | 'KAKAO';
    roles: string[];
    hasActiveSanction: boolean;
    deleteAfter?: string;
    createdAt: string;
}

export interface AdminUserListResult {
    users: AdminUserListItem[];
    total: number;
    nextCursor?: string;
}

export interface UserSanctions {
    bannedUntil?: string;
    mutedUntil?: string;
    suspendedUntil?: string;
    warningCount?: number;
    flags?: string[];
    notes?: string;
    serverRestrictions?: Record<string, UserServerRestriction>;
    legacyPenalty?: Record<string, unknown>;
}

export interface UserServerRestriction {
    blockedFeatures?: string[];
    until?: string;
    reason?: string;
    notes?: string;
}

export const hasActiveUserSanction = (sanctions: UserSanctions, now = Date.now()): boolean => {
    const hasActiveGlobalSanction = [sanctions.bannedUntil, sanctions.mutedUntil, sanctions.suspendedUntil].some(
        (value) => value !== undefined && new Date(value).getTime() > now
    );
    if (hasActiveGlobalSanction || (sanctions.flags?.length ?? 0) > 0) {
        return true;
    }
    return Object.values(sanctions.serverRestrictions ?? {}).some((restriction) => {
        if ((restriction.blockedFeatures?.length ?? 0) === 0) return false;
        return restriction.until === undefined || new Date(restriction.until).getTime() > now;
    });
};

export const toPublicUser = (user: UserRecord): PublicUser => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: user.roles,
    picture: user.picture,
    kakaoVerified: user.oauthType === 'KAKAO' && Boolean(user.oauthId?.trim()) && Boolean(user.kakaoVerifiedAt),
    kakaoGraceStartedAt: user.kakaoGraceStartedAt,
    createdAt: user.createdAt,
});

export interface CreateUserInput {
    username: string;
    password: string;
    displayName?: string;
    termsAcceptedAt?: Date;
    privacyAcceptedAt?: Date;
    thirdPartyUse?: boolean;
    oauth?: {
        type: 'KAKAO';
        id: string;
        email: string;
        info: UserOAuthInfo;
    };
}

export interface UserRepository {
    findById(id: string): Promise<UserRecord | null>;
    findByIds(ids: string[]): Promise<UserRecord[]>;
    findByUsername(username: string): Promise<UserRecord | null>;
    findByDisplayName(displayName: string): Promise<UserRecord | null>;
    findByOauthId(type: 'KAKAO', oauthId: string): Promise<UserRecord | null>;
    findByEmail(email: string): Promise<UserRecord | null>;
    listForAdmin(input: { query?: string; limit: number; cursor?: string }): Promise<AdminUserListResult>;
    createUser(input: CreateUserInput): Promise<UserRecord>;
    verifyPassword(user: UserRecord, password: string): Promise<boolean>;
    updatePassword(userId: string, password: string): Promise<void>;
    updateOAuthInfo(userId: string, oauthInfo: UserOAuthInfo): Promise<void>;
    syncKakaoIdentity(userId: string, email: string, oauthInfo: UserOAuthInfo): Promise<UserRecord>;
    markKakaoTalkVerified(userId: string, validUntil: Date): Promise<UserRecord>;
    linkKakao(
        userId: string,
        input: {
            oauthId: string;
            email: string;
            oauthInfo: UserOAuthInfo;
            verifiedAt: Date;
        }
    ): Promise<UserRecord>;
    relinkKakaoByEmail(
        userId: string,
        input: {
            oauthId: string;
            email: string;
            oauthInfo: UserOAuthInfo;
            verifiedAt: Date;
        }
    ): Promise<UserRecord>;
    isKakaoIdentityRetired(oauthId: string): Promise<boolean>;
    setKakaoReplacementApproval(
        userId: string,
        input: { until: Date | null; approvedByUserId: string; reason: string }
    ): Promise<UserRecord>;
    replaceKakaoWithApprovedIdentity(
        userId: string,
        input: {
            oauthId: string;
            email: string;
            oauthInfo: UserOAuthInfo;
            verifiedAt: Date;
        }
    ): Promise<UserRecord>;
    updateIdentity(
        userId: string,
        input: { username: string; displayName: string; changedAt: Date }
    ): Promise<UserRecord>;
    updateRoles(userId: string, roles: string[]): Promise<void>;
    updateSanctions(userId: string, sanctions: UserSanctions): Promise<void>;
    updateKakaoGraceUntil(userId: string, until: Date | null): Promise<void>;
    listSpecialAccessGrants(userId: string): Promise<SpecialAccountAccessGrantRecord[]>;
    createSpecialAccessGrant(
        userId: string,
        input: {
            kind: SpecialAccountAccessKind;
            profiles: string[];
            allowsGeneralCreation: boolean;
            expiresAt: Date | null;
            reason: string;
            grantedByUserId: string;
        }
    ): Promise<SpecialAccountAccessGrantRecord>;
    revokeSpecialAccessGrant(
        userId: string,
        grantId: string,
        input: { revokedAt: Date; revokedByUserId: string; reason: string }
    ): Promise<SpecialAccountAccessGrantRecord | null>;
    updateIcon(userId: string, picture: string, imageServer: number, updatedAt: Date): Promise<void>;
    updateIconForDay(
        userId: string,
        picture: string,
        imageServer: number,
        updatedAt: Date,
        dayStart: Date,
        consumeDailyQuota: boolean,
        allowCutoffEquality?: boolean
    ): Promise<string | null>;
    listIcons(userId: string, includeRetired?: boolean): Promise<UserIconRecord[]>;
    addIconForWindow(
        userId: string,
        picture: string,
        imageServer: number,
        now: Date,
        uploadCutoff: Date,
        maxActive: number
    ): Promise<AddUserIconResult>;
    setPreferredIcon(userId: string, iconId: string, now: Date): Promise<string | null>;
    retireIconForWindow(userId: string, iconId: string, now: Date, retireCutoff: Date): Promise<RetireUserIconResult>;
    resetProfileIcon(userId: string, requestedAt: Date): Promise<string | null>;
    setThirdPartyUse(userId: string, allowed: boolean): Promise<void>;
    scheduleDeletion(userId: string, deleteAfter: Date): Promise<void>;
    deleteUser(userId: string): Promise<void>;
}

export interface UserOAuthInfo {
    accessToken?: string;
    refreshToken?: string;
    accessTokenValidUntil?: string;
    refreshTokenValidUntil?: string;
    nextPasswordChange?: string;
}
