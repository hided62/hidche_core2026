import { randomUUID } from 'node:crypto';

import { createSimplePasswordHasher, type PasswordHasher } from './passwordHasher.js';
import type { CreateUserInput, UserRecord, UserRepository } from './userRepository.js';

// 유저 데이터 저장소를 메모리로 대체한 임시 구현.
export const createInMemoryUserRepository = (hasher: PasswordHasher = createSimplePasswordHasher()): UserRepository => {
    const usersByName = new Map<string, UserRecord>();
    const usersByOauthId = new Map<string, UserRecord>();
    const usersByEmail = new Map<string, UserRecord>();

    return {
        async findById(id: string): Promise<UserRecord | null> {
            for (const user of usersByName.values()) {
                if (user.id === id) {
                    return user;
                }
            }
            return null;
        },
        async findByIds(ids: string[]): Promise<UserRecord[]> {
            const requested = new Set(ids);
            return [...usersByName.values()].filter((user) => requested.has(user.id));
        },
        async findByUsername(username: string): Promise<UserRecord | null> {
            return usersByName.get(username) ?? null;
        },
        async findByDisplayName(displayName: string): Promise<UserRecord | null> {
            for (const user of usersByName.values()) {
                if (user.displayName === displayName) {
                    return user;
                }
            }
            return null;
        },
        async findByOauthId(type: 'KAKAO', oauthId: string): Promise<UserRecord | null> {
            return usersByOauthId.get(`${type}:${oauthId}`) ?? null;
        },
        async findByEmail(email: string): Promise<UserRecord | null> {
            return usersByEmail.get(email.toLowerCase()) ?? null;
        },
        async createUser(input: CreateUserInput): Promise<UserRecord> {
            if (usersByName.has(input.username)) {
                throw new Error('User already exists.');
            }
            for (const existing of usersByName.values()) {
                if ((input.displayName ?? input.username) === existing.displayName) {
                    throw new Error('Display name already exists.');
                }
            }
            const password = await hasher.hash(input.password);
            const oauthType = input.oauth?.type ?? 'NONE';
            const now = new Date();
            const user: UserRecord = {
                id: randomUUID(),
                username: input.username,
                displayName: input.displayName ?? input.username,
                roles: ['user'],
                sanctions: {},
                oauthType,
                oauthId: input.oauth?.id,
                email: input.oauth?.email,
                oauthInfo: input.oauth?.info,
                picture: 'default.jpg',
                imageServer: 0,
                thirdPartyUse: input.thirdPartyUse ?? false,
                termsAcceptedAt: input.termsAcceptedAt?.toISOString(),
                privacyAcceptedAt: input.privacyAcceptedAt?.toISOString(),
                kakaoVerifiedAt: input.oauth ? now.toISOString() : undefined,
                kakaoGraceStartedAt: now.toISOString(),
                passwordSalt: password.salt,
                passwordHash: password.hash,
                createdAt: now.toISOString(),
            };
            usersByName.set(input.username, user);
            if (user.oauthType === 'KAKAO' && user.oauthId) {
                usersByOauthId.set(`${user.oauthType}:${user.oauthId}`, user);
            }
            if (user.email) {
                usersByEmail.set(user.email.toLowerCase(), user);
            }
            return user;
        },
        async verifyPassword(user: UserRecord, password: string): Promise<boolean> {
            const verified = await hasher.verify(password, user.passwordHash, user.passwordSalt);
            if (verified.ok && verified.needsUpgrade) {
                const upgraded = await hasher.hash(password);
                user.passwordSalt = upgraded.salt;
                user.passwordHash = upgraded.hash;
            }
            return verified.ok;
        },
        async updatePassword(userId: string, password: string): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    const next = await hasher.hash(password);
                    user.passwordSalt = next.salt;
                    user.passwordHash = next.hash;
                    return;
                }
            }
            throw new Error('User not found.');
        },
        async updateOAuthInfo(userId: string, oauthInfo: UserRecord['oauthInfo']): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    user.oauthInfo = oauthInfo;
                    return;
                }
            }
            throw new Error('User not found.');
        },
        async linkKakao(userId, input): Promise<UserRecord> {
            if (usersByOauthId.has(`KAKAO:${input.oauthId}`) || usersByEmail.has(input.email.toLowerCase())) {
                throw new Error('Kakao account already linked.');
            }
            for (const user of usersByName.values()) {
                if (user.id !== userId) {
                    continue;
                }
                user.oauthType = 'KAKAO';
                user.oauthId = input.oauthId;
                user.email = input.email.toLowerCase();
                user.oauthInfo = input.oauthInfo;
                user.kakaoVerifiedAt = input.verifiedAt.toISOString();
                usersByOauthId.set(`KAKAO:${input.oauthId}`, user);
                usersByEmail.set(user.email, user);
                return user;
            }
            throw new Error('User not found.');
        },
        async updateRoles(userId: string, roles: string[]): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    user.roles = [...roles];
                    return;
                }
            }
            throw new Error('User not found.');
        },
        async updateSanctions(userId: string, sanctions: UserRecord['sanctions']): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    user.sanctions = { ...sanctions };
                    return;
                }
            }
            throw new Error('User not found.');
        },
        async updateIcon(userId: string, picture: string, imageServer: number, updatedAt: Date): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    user.picture = picture;
                    user.imageServer = imageServer;
                    user.iconUpdatedAt = updatedAt.toISOString();
                    user.iconRevision = updatedAt.toISOString();
                    return;
                }
            }
            throw new Error('User not found.');
        },
        async updateIconForDay(
            userId: string,
            picture: string,
            imageServer: number,
            updatedAt: Date,
            dayStart: Date,
            consumeDailyQuota: boolean
        ): Promise<string | null> {
            for (const user of usersByName.values()) {
                if (user.id !== userId) {
                    continue;
                }
                if (user.picture !== 'default.jpg' && user.iconUpdatedAt && new Date(user.iconUpdatedAt) >= dayStart) {
                    return null;
                }
                const previousRevision = Math.max(
                    new Date(user.createdAt).getTime(),
                    user.iconUpdatedAt ? new Date(user.iconUpdatedAt).getTime() : 0,
                    user.iconRevision ? new Date(user.iconRevision).getTime() : 0,
                    user.profileIconResetAt ? new Date(user.profileIconResetAt).getTime() : 0
                );
                const revision = new Date(Math.max(updatedAt.getTime(), previousRevision + 1)).toISOString();
                user.picture = picture;
                user.imageServer = imageServer;
                if (consumeDailyQuota) {
                    user.iconUpdatedAt = updatedAt.toISOString();
                }
                user.iconRevision = revision;
                return revision;
            }
            throw new Error('User not found.');
        },
        async resetProfileIcon(userId: string, requestedAt: Date): Promise<string | null> {
            for (const user of usersByName.values()) {
                if (user.id !== userId) {
                    continue;
                }
                const previousRevision = Math.max(
                    new Date(user.createdAt).getTime(),
                    user.iconUpdatedAt ? new Date(user.iconUpdatedAt).getTime() : 0,
                    user.iconRevision ? new Date(user.iconRevision).getTime() : 0,
                    user.profileIconResetAt ? new Date(user.profileIconResetAt).getTime() : 0
                );
                const revision = new Date(Math.max(requestedAt.getTime(), previousRevision + 1)).toISOString();
                user.iconRevision = revision;
                user.profileIconResetAt = revision;
                return revision;
            }
            return null;
        },
        async setThirdPartyUse(userId: string, allowed: boolean): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    user.thirdPartyUse = allowed;
                    return;
                }
            }
            throw new Error('User not found.');
        },
        async scheduleDeletion(userId: string, deleteAfter: Date): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    user.deleteAfter = deleteAfter.toISOString();
                    return;
                }
            }
            throw new Error('User not found.');
        },
        async deleteUser(userId: string): Promise<void> {
            for (const [username, user] of usersByName.entries()) {
                if (user.id === userId) {
                    usersByName.delete(username);
                    if (user.oauthType === 'KAKAO' && user.oauthId) {
                        usersByOauthId.delete(`${user.oauthType}:${user.oauthId}`);
                    }
                    if (user.email) {
                        usersByEmail.delete(user.email.toLowerCase());
                    }
                    return;
                }
            }
            throw new Error('User not found.');
        },
    };
};
