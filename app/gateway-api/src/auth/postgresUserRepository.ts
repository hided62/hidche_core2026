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
    createdAt: Date;
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
    passwordHash: row.passwordHash,
    passwordSalt: row.passwordSalt,
    createdAt: row.createdAt.toISOString(),
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
            const salt = hasher.createSalt();
            const oauthType = input.oauth?.type ?? 'NONE';
            const row = await prisma.appUser.create({
                data: {
                    loginId: input.username,
                    displayName: input.displayName ?? input.username,
                    passwordHash: hasher.hash(input.password, salt),
                    passwordSalt: salt,
                    roles: ['user'] satisfies GatewayPrisma.JsonArray,
                    sanctions: {} satisfies GatewayPrisma.JsonObject,
                    oauthType,
                    oauthId: input.oauth?.id,
                    email: input.oauth?.email?.toLowerCase(),
                    oauthInfo: (input.oauth?.info ?? {}) as GatewayPrisma.JsonObject,
                },
            });
            return mapUser(row);
        },
        async verifyPassword(user: UserRecord, password: string): Promise<boolean> {
            return hasher.hash(password, user.passwordSalt) === user.passwordHash;
        },
        async updatePassword(userId: string, password: string): Promise<void> {
            const salt = hasher.createSalt();
            await prisma.appUser.update({
                where: { id: userId },
                data: {
                    passwordHash: hasher.hash(password, salt),
                    passwordSalt: salt,
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
        async deleteUser(userId: string): Promise<void> {
            await prisma.appUser.delete({
                where: { id: userId },
            });
        },
    };
};
