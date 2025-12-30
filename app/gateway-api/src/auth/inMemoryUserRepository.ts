import { randomUUID } from 'node:crypto';

import { createSimplePasswordHasher, type PasswordHasher } from './passwordHasher.js';
import type { CreateUserInput, UserRecord, UserRepository } from './userRepository.js';

// 유저 데이터 저장소를 메모리로 대체한 임시 구현.
export const createInMemoryUserRepository = (
    hasher: PasswordHasher = createSimplePasswordHasher()
): UserRepository => {
    const usersByName = new Map<string, UserRecord>();

    return {
        async findByUsername(username: string): Promise<UserRecord | null> {
            return usersByName.get(username) ?? null;
        },
        async createUser(input: CreateUserInput): Promise<UserRecord> {
            if (usersByName.has(input.username)) {
                throw new Error('User already exists.');
            }
            const salt = hasher.createSalt();
            const user: UserRecord = {
                id: randomUUID(),
                username: input.username,
                displayName: input.displayName ?? input.username,
                passwordSalt: salt,
                passwordHash: hasher.hash(input.password, salt),
                createdAt: new Date().toISOString(),
            };
            usersByName.set(input.username, user);
            return user;
        },
        async verifyPassword(user: UserRecord, password: string): Promise<boolean> {
            return hasher.hash(password, user.passwordSalt) === user.passwordHash;
        },
    };
};
