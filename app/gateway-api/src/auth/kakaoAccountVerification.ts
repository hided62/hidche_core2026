import { randomInt } from 'node:crypto';

import { addDays, addSeconds, isAfter, isValid, parseISO } from 'date-fns';

import type { KakaoOAuthClient, KakaoOAuthToken, KakaoUserInfo } from './kakaoClient.js';
import type { OAuthSessionStore } from './oauthSessionStore.js';
import type { UserOAuthInfo, UserRecord, UserRepository } from './userRepository.js';

const KAKAO_LOGIN_SCOPES = ['account_email', 'talk_message'] as const;
const KAKAO_OTP_TTL_SECONDS = 180;
const KAKAO_OTP_ATTEMPTS = 3;
const KAKAO_TALK_VERIFICATION_DAYS = 10;

export type KakaoVerificationErrorCode =
    | 'EMAIL_REQUIRED'
    | 'EMAIL_UNVERIFIED'
    | 'EMAIL_CONFLICT'
    | 'IDENTITY_MISMATCH'
    | 'REAUTH_REQUIRED'
    | 'MESSAGE_FAILED';

export class KakaoVerificationError extends Error {
    readonly verificationCode: KakaoVerificationErrorCode;

    constructor(verificationCode: KakaoVerificationErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'KakaoVerificationError';
        this.verificationCode = verificationCode;
    }
}

export interface VerifiedKakaoProfile {
    kakaoId: string;
    email: string;
}

export interface KakaoLoginReady {
    user: UserRecord;
    accessToken: string;
    oauthInfo: UserOAuthInfo;
}

export interface KakaoOtpRequired {
    status: 'otp';
    challengeId: string;
    expiresAt: string;
    attemptsRemaining: number;
}

const parseDate = (value: string | undefined): Date | null => {
    if (!value) {
        return null;
    }
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value;
    const parsed = parseISO(normalized);
    return isValid(parsed) ? parsed : null;
};

export const readVerifiedKakaoProfile = (me: KakaoUserInfo): VerifiedKakaoProfile => {
    const account = me.kakaoAccount;
    if (!account.hasEmail || !account.email) {
        throw new KakaoVerificationError('EMAIL_REQUIRED', '이메일 정보 제공에 동의해야 합니다.');
    }
    if (!account.isEmailValid || !account.isEmailVerified) {
        throw new KakaoVerificationError('EMAIL_UNVERIFIED', '카카오 계정 이메일이 인증되지 않았습니다.');
    }
    if (!me.id) {
        throw new KakaoVerificationError('IDENTITY_MISMATCH', '카카오 계정 고유 ID를 확인하지 못했습니다.');
    }
    return {
        kakaoId: me.id,
        email: account.email.trim().toLocaleLowerCase('en-US'),
    };
};

export const oauthInfoFromToken = (
    token: KakaoOAuthToken,
    issuedAt: Date,
    previous: UserOAuthInfo = {}
): UserOAuthInfo => ({
    ...previous,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? previous.refreshToken,
    accessTokenValidUntil: addSeconds(issuedAt, token.accessTokenExpiresIn).toISOString(),
    refreshTokenValidUntil: token.refreshTokenExpiresIn
        ? addSeconds(issuedAt, token.refreshTokenExpiresIn).toISOString()
        : previous.refreshTokenValidUntil,
});

const resolveStoredAccessToken = async (
    user: UserRecord,
    kakaoClient: KakaoOAuthClient,
    now: Date
): Promise<{ accessToken: string; oauthInfo: UserOAuthInfo }> => {
    const oauthInfo = user.oauthInfo ?? {};
    const accessValidUntil = parseDate(oauthInfo.accessTokenValidUntil);
    if (oauthInfo.accessToken && accessValidUntil && isAfter(accessValidUntil, now)) {
        return { accessToken: oauthInfo.accessToken, oauthInfo };
    }

    const refreshValidUntil = parseDate(oauthInfo.refreshTokenValidUntil);
    if (!oauthInfo.refreshToken || !refreshValidUntil || !isAfter(refreshValidUntil, now)) {
        throw new KakaoVerificationError(
            'REAUTH_REQUIRED',
            '카카오 로그인 토큰이 만료되었습니다. 카카오 로그인을 다시 수행해 주세요.'
        );
    }

    let refreshed: KakaoOAuthToken;
    try {
        refreshed = await kakaoClient.refreshToken(oauthInfo.refreshToken);
    } catch (error) {
        throw new KakaoVerificationError(
            'REAUTH_REQUIRED',
            '카카오 로그인 토큰을 갱신하지 못했습니다. 카카오 로그인을 다시 수행해 주세요.',
            { cause: error }
        );
    }
    if (!refreshed.accessToken || refreshed.accessTokenExpiresIn <= 0) {
        throw new KakaoVerificationError(
            'REAUTH_REQUIRED',
            '카카오 로그인 토큰을 갱신하지 못했습니다. 카카오 로그인을 다시 수행해 주세요.'
        );
    }
    return {
        accessToken: refreshed.accessToken,
        oauthInfo: oauthInfoFromToken(refreshed, now, oauthInfo),
    };
};

export const verifyStoredKakaoIdentity = async (options: {
    user: UserRecord;
    users: UserRepository;
    kakaoClient: KakaoOAuthClient;
    now?: Date;
}): Promise<KakaoLoginReady> => {
    const { user, users, kakaoClient } = options;
    const now = options.now ?? new Date();
    if (user.oauthType !== 'KAKAO' || !user.oauthId) {
        throw new KakaoVerificationError('REAUTH_REQUIRED', '카카오 계정 연결 정보가 올바르지 않습니다.');
    }

    const resolved = await resolveStoredAccessToken(user, kakaoClient, now);
    let profile: VerifiedKakaoProfile;
    try {
        profile = readVerifiedKakaoProfile(await kakaoClient.getMe(resolved.accessToken));
    } catch (error) {
        if (error instanceof KakaoVerificationError) {
            throw error;
        }
        throw new KakaoVerificationError(
            'REAUTH_REQUIRED',
            '카카오 계정 정보를 확인하지 못했습니다. 카카오 로그인을 다시 수행해 주세요.',
            { cause: error }
        );
    }
    if (profile.kakaoId !== user.oauthId) {
        throw new KakaoVerificationError(
            'IDENTITY_MISMATCH',
            '저장된 카카오 계정과 현재 카카오 계정이 일치하지 않습니다.'
        );
    }
    const emailOwner = await users.findByEmail(profile.email);
    if (emailOwner && emailOwner.id !== user.id) {
        throw new KakaoVerificationError(
            'EMAIL_CONFLICT',
            '변경된 카카오 이메일이 이미 다른 계정에서 사용 중입니다. 관리자에게 문의해 주세요.'
        );
    }

    try {
        const synced = await users.syncKakaoIdentity(user.id, profile.email, resolved.oauthInfo);
        return {
            user: synced,
            accessToken: resolved.accessToken,
            oauthInfo: resolved.oauthInfo,
        };
    } catch (error) {
        throw new KakaoVerificationError(
            'EMAIL_CONFLICT',
            '변경된 카카오 이메일이 이미 다른 계정에서 사용 중입니다. 관리자에게 문의해 주세요.',
            { cause: error }
        );
    }
};

export const requireKakaoTalkProof = async (options: {
    user: UserRecord;
    accessToken: string;
    kakaoClient: KakaoOAuthClient;
    oauthSessions: OAuthSessionStore;
    publicBaseUrl: string;
    now?: Date;
}): Promise<KakaoOtpRequired | null> => {
    const now = options.now ?? new Date();
    const validUntil = parseDate(options.user.kakaoTalkVerifiedUntil);
    if (validUntil && isAfter(validUntil, now)) {
        return null;
    }

    const active = await options.oauthSessions.getLoginChallengeForUser(options.user.id);
    if (active) {
        return {
            status: 'otp',
            challengeId: active.id,
            expiresAt: active.expiresAt,
            attemptsRemaining: active.attemptsRemaining,
        };
    }

    const expiresAt = addSeconds(now, KAKAO_OTP_TTL_SECONDS);
    const challenge = await options.oauthSessions.createLoginChallenge({
        userId: options.user.id,
        code: String(randomInt(1000, 10_000)),
        attemptsRemaining: KAKAO_OTP_ATTEMPTS,
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
    });
    try {
        await options.kakaoClient.sendTalkMessage(
            options.accessToken,
            `인증 코드는 ${challenge.code} 입니다. ${challenge.expiresAt} 이내에 입력해 주세요.`,
            options.publicBaseUrl
        );
    } catch (error) {
        await options.oauthSessions.verifyLoginChallenge(challenge.id, challenge.code);
        throw new KakaoVerificationError('MESSAGE_FAILED', '카카오톡 인증 코드를 보내지 못했습니다.', {
            cause: error,
        });
    }
    return {
        status: 'otp',
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt,
        attemptsRemaining: challenge.attemptsRemaining,
    };
};

export const verifyKakaoTalkChallenge = async (options: {
    challengeId: string;
    code: string;
    oauthSessions: OAuthSessionStore;
    users: UserRepository;
    now?: Date;
}): Promise<{ user: UserRecord; validUntil: string }> => {
    const now = options.now ?? new Date();
    const result = await options.oauthSessions.verifyLoginChallenge(options.challengeId, options.code, now);
    if (result.status === 'expired') {
        throw new KakaoVerificationError('REAUTH_REQUIRED', '인증 기한이 만료되었습니다. 다시 로그인해 주세요.');
    }
    if (result.status === 'locked') {
        throw new KakaoVerificationError(
            'IDENTITY_MISMATCH',
            `인증 실패 횟수를 초과했습니다. ${result.expiresAt}까지 기다려 주세요.`
        );
    }
    if (result.status === 'mismatch') {
        throw new KakaoVerificationError(
            'IDENTITY_MISMATCH',
            result.attemptsRemaining > 0
                ? `인증 번호가 틀렸습니다. ${result.attemptsRemaining}회 더 시도할 수 있습니다.`
                : '인증 실패 횟수를 초과했습니다. 다시 로그인해 주세요.'
        );
    }

    const user = await options.users.findById(result.userId);
    if (!user || user.oauthType !== 'KAKAO' || !user.oauthId) {
        throw new KakaoVerificationError('REAUTH_REQUIRED', '카카오 계정 연결 정보를 찾지 못했습니다.');
    }
    const proofValidUntil = addDays(now, KAKAO_TALK_VERIFICATION_DAYS);
    const verified = await options.users.markKakaoTalkVerified(user.id, proofValidUntil);
    return { user: verified, validUntil: proofValidUntil.toISOString() };
};

export const mergeRequiredKakaoScopes = (requested?: string[]): string[] => [
    ...new Set([...(requested ?? []), ...KAKAO_LOGIN_SCOPES]),
];
