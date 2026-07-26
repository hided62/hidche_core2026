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
    picture: string;
    imageServer: number;
    iconUpdatedAt?: string;
    thirdPartyUse: boolean;
    termsAcceptedAt?: string;
    privacyAcceptedAt?: string;
    kakaoVerifiedAt?: string;
    kakaoGraceStartedAt: string;
    deleteAfter?: string;
    passwordHash: string;
    passwordSalt: string;
    createdAt: string;
}

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

export interface UserSanctions {
    bannedUntil?: string;
    mutedUntil?: string;
    suspendedUntil?: string;
    warningCount?: number;
    flags?: string[];
    notes?: string;
    profileIconResetAt?: string;
    serverRestrictions?: Record<string, UserServerRestriction>;
}

export interface UserServerRestriction {
    blockedFeatures?: string[];
    until?: string;
    reason?: string;
    notes?: string;
}

export const toPublicUser = (user: UserRecord): PublicUser => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: user.roles,
    picture: user.picture,
    kakaoVerified: user.oauthType === 'KAKAO' && Boolean(user.kakaoVerifiedAt),
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
    findByUsername(username: string): Promise<UserRecord | null>;
    findByDisplayName(displayName: string): Promise<UserRecord | null>;
    findByOauthId(type: 'KAKAO', oauthId: string): Promise<UserRecord | null>;
    findByEmail(email: string): Promise<UserRecord | null>;
    createUser(input: CreateUserInput): Promise<UserRecord>;
    verifyPassword(user: UserRecord, password: string): Promise<boolean>;
    updatePassword(userId: string, password: string): Promise<void>;
    updateOAuthInfo(userId: string, oauthInfo: UserOAuthInfo): Promise<void>;
    linkKakao(
        userId: string,
        input: {
            oauthId: string;
            email: string;
            oauthInfo: UserOAuthInfo;
            verifiedAt: Date;
        }
    ): Promise<UserRecord>;
    updateRoles(userId: string, roles: string[]): Promise<void>;
    updateSanctions(userId: string, sanctions: UserSanctions): Promise<void>;
    updateIcon(userId: string, picture: string, imageServer: number, updatedAt: Date): Promise<void>;
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
