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
        async findByUsername(username: string): Promise<UserRecord | null> {
            return usersByName.get(username) ?? null;
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
            const salt = hasher.createSalt();
            const oauthType = input.oauth?.type ?? 'NONE';
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
                passwordSalt: salt,
                passwordHash: hasher.hash(input.password, salt),
                createdAt: new Date().toISOString(),
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
            return hasher.hash(password, user.passwordSalt) === user.passwordHash;
        },
        async updatePassword(userId: string, password: string): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    const salt = hasher.createSalt();
                    user.passwordSalt = salt;
                    user.passwordHash = hasher.hash(password, salt);
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
