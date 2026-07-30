import type { GatewayPrisma, GatewayPrismaClient } from '@sammo-ts/infra';

import { createSimplePasswordHasher, type PasswordHasher } from './passwordHasher.js';
import type { CreateUserInput, UserOAuthInfo, UserRecord, UserRepository, UserSanctions } from './userRepository.js';

const readStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
};

const readObject = <T extends object>(value: unknown, fallback: T): T => {
    if (!value || typeof value !== 'object') {
        return fallback;
    }
    return value as T;
};

const readLegacyMemberNo = (value: unknown): number | undefined => {
    const legacyData = readObject<Record<string, unknown>>(value, {});
    const memberNo = legacyData.memberNo;
    return typeof memberNo === 'number' && Number.isSafeInteger(memberNo) && memberNo > 0
        ? memberNo
        : undefined;
};

const mapUser = (row: {
    id: string;
    loginId: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
    roles: GatewayPrisma.JsonValue;
    sanctions: GatewayPrisma.JsonValue;
    oauthType: 'NONE' | 'KAKAO';
    oauthId: string | null;
    email: string | null;
    oauthInfo: GatewayPrisma.JsonValue;
    picture: string;
    imageServer: number;
    iconUpdatedAt: Date | null;
    thirdPartyUse: boolean;
    termsAcceptedAt: Date | null;
    privacyAcceptedAt: Date | null;
    kakaoVerifiedAt: Date | null;
    kakaoGraceStartedAt: Date;
    deleteAfter: Date | null;
    createdAt: Date;
    legacyData: GatewayPrisma.JsonValue;
}): UserRecord => ({
    id: row.id,
    username: row.loginId,
    displayName: row.displayName,
    roles: readStringArray(row.roles),
    sanctions: readObject<UserSanctions>(row.sanctions, {}),
    oauthType: row.oauthType,
    oauthId: row.oauthId ?? undefined,
    email: row.email ?? undefined,
    oauthInfo: readObject<UserOAuthInfo>(row.oauthInfo, {}),
    picture: row.picture,
    imageServer: row.imageServer,
    iconUpdatedAt: row.iconUpdatedAt?.toISOString(),
    thirdPartyUse: row.thirdPartyUse,
    termsAcceptedAt: row.termsAcceptedAt?.toISOString(),
    privacyAcceptedAt: row.privacyAcceptedAt?.toISOString(),
    kakaoVerifiedAt: row.kakaoVerifiedAt?.toISOString(),
    kakaoGraceStartedAt: row.kakaoGraceStartedAt.toISOString(),
    deleteAfter: row.deleteAfter?.toISOString(),
    passwordHash: row.passwordHash,
    passwordSalt: row.passwordSalt,
    createdAt: row.createdAt.toISOString(),
    legacyMemberNo: readLegacyMemberNo(row.legacyData),
});

export const createPostgresUserRepository = (
    prisma: GatewayPrismaClient,
    hasher: PasswordHasher = createSimplePasswordHasher()
): UserRepository => {
    return {
        async findById(id: string): Promise<UserRecord | null> {
            const row = await prisma.appUser.findUnique({
                where: {
                    id,
                },
            });
            return row ? mapUser(row) : null;
        },
        async findByUsername(username: string): Promise<UserRecord | null> {
            const row = await prisma.appUser.findUnique({
                where: {
                    loginId: username,
                },
            });
            return row ? mapUser(row) : null;
        },
        async findByDisplayName(displayName: string): Promise<UserRecord | null> {
            const row = await prisma.appUser.findUnique({
                where: {
                    displayName,
                },
            });
            return row ? mapUser(row) : null;
        },
        async findByOauthId(type: 'KAKAO', oauthId: string): Promise<UserRecord | null> {
            const row = await prisma.appUser.findFirst({
                where: {
                    oauthType: type,
                    oauthId,
                },
            });
            return row ? mapUser(row) : null;
        },
        async findByEmail(email: string): Promise<UserRecord | null> {
            const row = await prisma.appUser.findUnique({
                where: {
                    email: email.toLowerCase(),
                },
            });
            return row ? mapUser(row) : null;
        },
        async createUser(input: CreateUserInput): Promise<UserRecord> {
            const password = await hasher.hash(input.password);
            const oauthType = input.oauth?.type ?? 'NONE';
            const now = new Date();
            const row = await prisma.appUser.create({
                data: {
                    loginId: input.username,
                    displayName: input.displayName ?? input.username,
                    passwordHash: password.hash,
                    passwordSalt: password.salt,
                    roles: ['user'] satisfies GatewayPrisma.JsonArray,
                    sanctions: {} satisfies GatewayPrisma.JsonObject,
                    oauthType,
                    oauthId: input.oauth?.id,
                    email: input.oauth?.email?.toLowerCase(),
                    oauthInfo: (input.oauth?.info ?? {}) as GatewayPrisma.JsonObject,
                    termsAcceptedAt: input.termsAcceptedAt,
                    privacyAcceptedAt: input.privacyAcceptedAt,
                    thirdPartyUse: input.thirdPartyUse ?? false,
                    kakaoVerifiedAt: input.oauth ? now : undefined,
                    kakaoGraceStartedAt: now,
                },
            });
            return mapUser(row);
        },
        async verifyPassword(user: UserRecord, password: string): Promise<boolean> {
            const verified = await hasher.verify(password, user.passwordHash, user.passwordSalt);
            if (verified.ok && verified.needsUpgrade) {
                const upgraded = await hasher.hash(password);
                await prisma.appUser.update({
                    where: { id: user.id },
                    data: {
                        passwordHash: upgraded.hash,
                        passwordSalt: upgraded.salt,
                    },
                });
                user.passwordHash = upgraded.hash;
                user.passwordSalt = upgraded.salt;
            }
            return verified.ok;
        },
        async updatePassword(userId: string, password: string): Promise<void> {
            const next = await hasher.hash(password);
            await prisma.appUser.update({
                where: { id: userId },
                data: {
                    passwordHash: next.hash,
                    passwordSalt: next.salt,
                },
            });
        },
        async updateOAuthInfo(userId: string, oauthInfo: UserOAuthInfo): Promise<void> {
            await prisma.appUser.update({
                where: { id: userId },
                data: {
                    oauthInfo: oauthInfo as GatewayPrisma.JsonObject,
                },
            });
        },
        async linkKakao(userId, input): Promise<UserRecord> {
            const row = await prisma.appUser.update({
                where: { id: userId },
                data: {
                    oauthType: 'KAKAO',
                    oauthId: input.oauthId,
                    email: input.email.toLowerCase(),
                    oauthInfo: input.oauthInfo as GatewayPrisma.JsonObject,
                    kakaoVerifiedAt: input.verifiedAt,
                },
            });
            return mapUser(row);
        },
        async updateRoles(userId: string, roles: string[]): Promise<void> {
            await prisma.appUser.update({
                where: { id: userId },
                data: {
                    roles: roles as GatewayPrisma.JsonArray,
                },
            });
        },
        async updateSanctions(userId: string, sanctions: UserSanctions): Promise<void> {
            await prisma.appUser.update({
                where: { id: userId },
                data: {
                    sanctions: sanctions as GatewayPrisma.JsonObject,
                },
            });
        },
        async updateIcon(userId: string, picture: string, imageServer: number, updatedAt: Date): Promise<void> {
            await prisma.appUser.update({
                where: { id: userId },
                data: {
                    picture,
                    imageServer,
                    iconUpdatedAt: updatedAt,
                },
            });
        },
        async setThirdPartyUse(userId: string, allowed: boolean): Promise<void> {
            await prisma.appUser.update({
                where: { id: userId },
                data: { thirdPartyUse: allowed },
            });
        },
        async scheduleDeletion(userId: string, deleteAfter: Date): Promise<void> {
            await prisma.appUser.update({
                where: { id: userId },
                data: { deleteAfter },
            });
        },
        async deleteUser(userId: string): Promise<void> {
            await prisma.appUser.delete({
                where: { id: userId },
            });
        },
    };
};
