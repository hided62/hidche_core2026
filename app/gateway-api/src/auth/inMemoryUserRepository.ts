import { randomUUID } from 'node:crypto';

import { createSimplePasswordHasher, type PasswordHasher } from './passwordHasher.js';
import type {
    AdminUserListItem,
    CreateUserInput,
    SpecialAccountAccessGrantRecord,
    UserIconRecord,
    UserRecord,
    UserRepository,
} from './userRepository.js';
import { hasActiveUserSanction } from './userRepository.js';

const toAdminUserListItem = (user: UserRecord): AdminUserListItem => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    oauthType: user.oauthType,
    roles: [...user.roles],
    hasActiveSanction: hasActiveUserSanction(user.sanctions),
    deleteAfter: user.deleteAfter,
    createdAt: user.createdAt,
});

// 유저 데이터 저장소를 메모리로 대체한 임시 구현.
export const createInMemoryUserRepository = (hasher: PasswordHasher = createSimplePasswordHasher()): UserRepository => {
    const usersByName = new Map<string, UserRecord>();
    const usersByOauthId = new Map<string, UserRecord>();
    const usersByEmail = new Map<string, UserRecord>();
    const iconsById = new Map<string, UserIconRecord>();
    const specialAccessGrantsById = new Map<string, SpecialAccountAccessGrantRecord>();

    const nextRevision = (user: UserRecord, now: Date): string =>
        new Date(
            Math.max(
                now.getTime(),
                new Date(user.createdAt).getTime() + 1,
                (user.iconRevision ? new Date(user.iconRevision).getTime() : 0) + 1
            )
        ).toISOString();

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
        async listForAdmin(input) {
            const query = input.query?.trim().toLocaleLowerCase() ?? '';
            const matching = [...usersByName.values()]
                .filter((user) => {
                    if (!query) return true;
                    return [user.username, user.displayName, user.email ?? '', user.id].some((value) =>
                        value.toLocaleLowerCase().includes(query)
                    );
                })
                .sort((left, right) => {
                    const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
                    return byCreatedAt === 0 ? right.id.localeCompare(left.id) : byCreatedAt;
                });
            const startIndex = input.cursor
                ? Math.max(0, matching.findIndex((user) => user.id === input.cursor) + 1)
                : 0;
            const page = matching.slice(startIndex, startIndex + input.limit + 1);
            const hasNextPage = page.length > input.limit;
            const users = page.slice(0, input.limit);
            return {
                users: users.map(toAdminUserListItem),
                total: matching.length,
                nextCursor: hasNextPage ? users.at(-1)?.id : undefined,
            };
        },
        async createUser(input: CreateUserInput): Promise<UserRecord> {
            if (usersByName.has(input.username)) {
                throw new Error('User already exists.');
            }
            if (
                input.oauth &&
                (usersByOauthId.has(`${input.oauth.type}:${input.oauth.id}`) ||
                    usersByEmail.has(input.oauth.email.toLowerCase()))
            ) {
                throw new Error('Kakao account already linked.');
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
        async syncKakaoIdentity(
            userId: string,
            email: string,
            oauthInfo: UserRecord['oauthInfo']
        ): Promise<UserRecord> {
            const normalizedEmail = email.toLowerCase();
            const owner = usersByEmail.get(normalizedEmail);
            if (owner && owner.id !== userId) {
                throw new Error('Kakao email already linked.');
            }
            for (const user of usersByName.values()) {
                if (user.id !== userId) {
                    continue;
                }
                if (user.email) {
                    usersByEmail.delete(user.email.toLowerCase());
                }
                user.email = normalizedEmail;
                user.oauthInfo = oauthInfo;
                usersByEmail.set(normalizedEmail, user);
                return user;
            }
            throw new Error('User not found.');
        },
        async markKakaoTalkVerified(userId: string, validUntil: Date): Promise<UserRecord> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    user.kakaoTalkVerifiedUntil = validUntil.toISOString();
                    return user;
                }
            }
            throw new Error('User not found.');
        },
        async linkKakao(userId, input): Promise<UserRecord> {
            const normalizedEmail = input.email.toLowerCase();
            const oauthOwner = usersByOauthId.get(`KAKAO:${input.oauthId}`);
            const emailOwner = usersByEmail.get(normalizedEmail);
            if ((oauthOwner && oauthOwner.id !== userId) || (emailOwner && emailOwner.id !== userId)) {
                throw new Error('Kakao account already linked.');
            }
            for (const user of usersByName.values()) {
                if (user.id !== userId) {
                    continue;
                }
                if (user.oauthType === 'KAKAO' && user.oauthId) {
                    usersByOauthId.delete(`KAKAO:${user.oauthId}`);
                }
                if (user.email && user.email.toLowerCase() !== normalizedEmail) {
                    usersByEmail.delete(user.email.toLowerCase());
                }
                user.oauthType = 'KAKAO';
                user.oauthId = input.oauthId;
                user.email = normalizedEmail;
                user.oauthInfo = input.oauthInfo;
                user.kakaoVerifiedAt = input.verifiedAt.toISOString();
                user.kakaoTalkVerifiedUntil = undefined;
                usersByOauthId.set(`KAKAO:${input.oauthId}`, user);
                usersByEmail.set(user.email, user);
                return user;
            }
            throw new Error('User not found.');
        },
        async relinkKakaoByEmail(userId, input): Promise<UserRecord> {
            const normalizedEmail = input.email.toLowerCase();
            const oauthOwner = usersByOauthId.get(`KAKAO:${input.oauthId}`);
            const emailOwner = usersByEmail.get(normalizedEmail);
            if ((oauthOwner && oauthOwner.id !== userId) || emailOwner?.id !== userId) {
                throw new Error('Kakao account recovery ownership changed.');
            }
            for (const user of usersByName.values()) {
                if (user.id !== userId || user.email?.toLowerCase() !== normalizedEmail) {
                    continue;
                }
                if (user.oauthType === 'KAKAO' && user.oauthId) {
                    usersByOauthId.delete(`KAKAO:${user.oauthId}`);
                }
                user.oauthType = 'KAKAO';
                user.oauthId = input.oauthId;
                user.oauthInfo = input.oauthInfo;
                user.kakaoVerifiedAt = input.verifiedAt.toISOString();
                user.kakaoTalkVerifiedUntil = undefined;
                usersByOauthId.set(`KAKAO:${input.oauthId}`, user);
                return user;
            }
            throw new Error('Kakao account recovery ownership changed.');
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
        async updateKakaoGraceUntil(userId: string, until: Date | null): Promise<void> {
            for (const user of usersByName.values()) {
                if (user.id === userId) {
                    user.kakaoGraceUntil = until?.toISOString();
                    return;
                }
            }
            throw new Error('User not found.');
        },
        async listSpecialAccessGrants(userId: string): Promise<SpecialAccountAccessGrantRecord[]> {
            return [...specialAccessGrantsById.values()]
                .filter((grant) => grant.userId === userId)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        },
        async createSpecialAccessGrant(userId, input): Promise<SpecialAccountAccessGrantRecord> {
            if (![...usersByName.values()].some((user) => user.id === userId)) {
                throw new Error('User not found.');
            }
            const now = new Date().toISOString();
            const grant: SpecialAccountAccessGrantRecord = {
                id: randomUUID(),
                userId,
                kind: input.kind,
                profiles: [...input.profiles],
                allowsGeneralCreation: input.allowsGeneralCreation,
                expiresAt: input.expiresAt?.toISOString(),
                reason: input.reason,
                grantedByUserId: input.grantedByUserId,
                createdAt: now,
            };
            specialAccessGrantsById.set(grant.id, grant);
            return grant;
        },
        async revokeSpecialAccessGrant(userId, grantId, input): Promise<SpecialAccountAccessGrantRecord | null> {
            const grant = specialAccessGrantsById.get(grantId);
            if (!grant || grant.userId !== userId || grant.revokedAt) {
                return null;
            }
            grant.revokedAt = input.revokedAt.toISOString();
            grant.revokedByUserId = input.revokedByUserId;
            grant.revokedReason = input.reason;
            return grant;
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
            consumeDailyQuota: boolean,
            allowCutoffEquality = false
        ): Promise<string | null> {
            for (const user of usersByName.values()) {
                if (user.id !== userId) {
                    continue;
                }
                if (user.picture !== 'default.jpg' && user.iconUpdatedAt) {
                    const previousUpdate = new Date(user.iconUpdatedAt);
                    if (allowCutoffEquality ? previousUpdate > dayStart : previousUpdate >= dayStart) {
                        return null;
                    }
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
        async listIcons(userId: string, includeRetired = false): Promise<UserIconRecord[]> {
            return [...iconsById.values()]
                .filter((icon) => icon.userId === userId && (includeRetired || !icon.retiredAt))
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        },
        async addIconForWindow(userId, picture, imageServer, now, uploadCutoff, maxActive) {
            const user = [...usersByName.values()].find((candidate) => candidate.id === userId);
            if (!user) return { ok: false, reason: 'NOT_FOUND' };
            if (user.iconUpdatedAt && new Date(user.iconUpdatedAt) > uploadCutoff) {
                return { ok: false, reason: 'COOLDOWN' };
            }
            const active = [...iconsById.values()].filter((icon) => icon.userId === userId && !icon.retiredAt);
            if (active.length >= maxActive) return { ok: false, reason: 'LIMIT' };
            const revision = nextRevision(user, now);
            const icon: UserIconRecord = {
                id: randomUUID(),
                userId,
                picture,
                imageServer,
                createdAt: now.toISOString(),
            };
            iconsById.set(icon.id, icon);
            user.picture = picture;
            user.imageServer = imageServer;
            user.iconUpdatedAt = now.toISOString();
            user.iconRevision = revision;
            return { ok: true, icon, revision };
        },
        async setPreferredIcon(userId, iconId, now) {
            const user = [...usersByName.values()].find((candidate) => candidate.id === userId);
            const icon = iconsById.get(iconId);
            if (!user || !icon || icon.userId !== userId || icon.retiredAt) return null;
            const revision = nextRevision(user, now);
            user.picture = icon.picture;
            user.imageServer = icon.imageServer;
            user.iconRevision = revision;
            return revision;
        },
        async retireIconForWindow(userId, iconId, now, retireCutoff) {
            const user = [...usersByName.values()].find((candidate) => candidate.id === userId);
            if (!user) return { ok: false, reason: 'NOT_FOUND' };
            if (user.iconRetiredAt && new Date(user.iconRetiredAt) > retireCutoff) {
                return { ok: false, reason: 'COOLDOWN' };
            }
            const icon = iconsById.get(iconId);
            if (!icon || icon.userId !== userId) return { ok: false, reason: 'NOT_FOUND' };
            if (icon.retiredAt) return { ok: false, reason: 'ALREADY_RETIRED' };
            icon.retiredAt = now.toISOString();
            const preferredChanged = user.picture === icon.picture;
            if (preferredChanged) {
                const fallback = [...iconsById.values()]
                    .filter((candidate) => candidate.userId === userId && !candidate.retiredAt)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
                user.picture = fallback?.picture ?? 'default.jpg';
                user.imageServer = fallback?.imageServer ?? 0;
            }
            const revision = nextRevision(user, now);
            user.iconRevision = revision;
            user.iconRetiredAt = now.toISOString();
            return { ok: true, icon, revision, preferredChanged };
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
                    for (const [grantId, grant] of specialAccessGrantsById) {
                        if (grant.userId === userId) {
                            specialAccessGrantsById.delete(grantId);
                        }
                    }
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
