import { GatewayPrisma, type GatewayPrismaClient } from '@sammo-ts/infra';

import { createPasswordHasher, type PasswordHasher } from './passwordHasher.js';
import type {
    AdminUserListItem,
    CreateUserInput,
    SpecialAccountAccessGrantRecord,
    UserIconRecord,
    UserOAuthInfo,
    UserRecord,
    UserRepository,
    UserSanctions,
} from './userRepository.js';
import { hasActiveUserSanction } from './userRepository.js';

const toAdminUserListItem = (user: UserRecord): AdminUserListItem => {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        oauthType: user.oauthType,
        roles: user.roles,
        hasActiveSanction: hasActiveUserSanction(user.sanctions),
        deleteAfter: user.deleteAfter,
        createdAt: user.createdAt,
    };
};

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
    return typeof memberNo === 'number' && Number.isSafeInteger(memberNo) && memberNo > 0 ? memberNo : undefined;
};

const readLegacyGrade = (value: unknown): number | undefined => {
    const legacyData = readObject<Record<string, unknown>>(value, {});
    const grade = legacyData.grade;
    return typeof grade === 'number' && Number.isSafeInteger(grade) ? grade : undefined;
};

const mapUser = (row: {
    id: string;
    loginId: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
    passwordResetRequired: boolean;
    roles: GatewayPrisma.JsonValue;
    sanctions: GatewayPrisma.JsonValue;
    oauthType: 'NONE' | 'KAKAO';
    oauthId: string | null;
    email: string | null;
    oauthInfo: GatewayPrisma.JsonValue;
    identityRevision: Date;
    authRevision: number;
    sessionRevokedBefore: Date | null;
    kakaoReplacementApprovedUntil: Date | null;
    kakaoReplacementApprovedByUserId: string | null;
    kakaoReplacementReason: string | null;
    picture: string;
    imageServer: number;
    iconUpdatedAt: Date | null;
    iconRevision: Date | null;
    profileIconResetAt: Date | null;
    iconRetiredAt: Date | null;
    thirdPartyUse: boolean;
    termsAcceptedAt: Date | null;
    privacyAcceptedAt: Date | null;
    kakaoVerifiedAt: Date | null;
    kakaoTalkVerifiedUntil: Date | null;
    kakaoGraceStartedAt: Date;
    kakaoGraceUntil: Date | null;
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
    identityRevision: row.identityRevision.toISOString(),
    authRevision: row.authRevision,
    sessionRevokedBefore: row.sessionRevokedBefore?.toISOString(),
    kakaoReplacementApprovedUntil: row.kakaoReplacementApprovedUntil?.toISOString(),
    kakaoReplacementApprovedByUserId: row.kakaoReplacementApprovedByUserId ?? undefined,
    kakaoReplacementReason: row.kakaoReplacementReason ?? undefined,
    picture: row.picture,
    imageServer: row.imageServer,
    iconUpdatedAt: row.iconUpdatedAt?.toISOString(),
    iconRevision: row.iconRevision?.toISOString(),
    profileIconResetAt: row.profileIconResetAt?.toISOString(),
    iconRetiredAt: row.iconRetiredAt?.toISOString(),
    thirdPartyUse: row.thirdPartyUse,
    termsAcceptedAt: row.termsAcceptedAt?.toISOString(),
    privacyAcceptedAt: row.privacyAcceptedAt?.toISOString(),
    kakaoVerifiedAt: row.kakaoVerifiedAt?.toISOString(),
    kakaoTalkVerifiedUntil: row.kakaoTalkVerifiedUntil?.toISOString(),
    kakaoGraceStartedAt: row.kakaoGraceStartedAt.toISOString(),
    kakaoGraceUntil: row.kakaoGraceUntil?.toISOString(),
    deleteAfter: row.deleteAfter?.toISOString(),
    passwordHash: row.passwordHash,
    passwordSalt: row.passwordSalt,
    passwordResetRequired: row.passwordResetRequired,
    createdAt: row.createdAt.toISOString(),
    legacyMemberNo: readLegacyMemberNo(row.legacyData),
    legacyGrade: readLegacyGrade(row.legacyData),
});

const mapIcon = (row: {
    id: string;
    userId: string;
    picture: string;
    imageServer: number;
    createdAt: Date;
    retiredAt: Date | null;
}): UserIconRecord => ({
    id: row.id,
    userId: row.userId,
    picture: row.picture,
    imageServer: row.imageServer,
    createdAt: row.createdAt.toISOString(),
    retiredAt: row.retiredAt?.toISOString(),
});

const mapSpecialAccessGrant = (row: {
    id: string;
    userId: string;
    kind: 'TESTER' | 'RECOVERY' | 'OTHER';
    profiles: string[];
    allowsGeneralCreation: boolean;
    expiresAt: Date | null;
    reason: string;
    grantedByUserId: string;
    revokedAt: Date | null;
    revokedByUserId: string | null;
    revokedReason: string | null;
    createdAt: Date;
}): SpecialAccountAccessGrantRecord => ({
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    profiles: row.profiles,
    allowsGeneralCreation: row.allowsGeneralCreation,
    expiresAt: row.expiresAt?.toISOString(),
    reason: row.reason,
    grantedByUserId: row.grantedByUserId,
    revokedAt: row.revokedAt?.toISOString(),
    revokedByUserId: row.revokedByUserId ?? undefined,
    revokedReason: row.revokedReason ?? undefined,
    createdAt: row.createdAt.toISOString(),
});

export const createPostgresUserRepository = (
    prisma: GatewayPrismaClient,
    hasher: PasswordHasher = createPasswordHasher()
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
        async findByIds(ids: string[]): Promise<UserRecord[]> {
            if (ids.length === 0) {
                return [];
            }
            const rows = await prisma.appUser.findMany({
                where: { id: { in: ids } },
            });
            return rows.map(mapUser);
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
        async listForAdmin(input) {
            const query = input.query?.trim();
            const where = query
                ? {
                      OR: [
                          { loginId: { contains: query, mode: 'insensitive' as const } },
                          { displayName: { contains: query, mode: 'insensitive' as const } },
                          { email: { contains: query, mode: 'insensitive' as const } },
                          { id: { contains: query, mode: 'insensitive' as const } },
                      ],
                  }
                : undefined;
            const [rows, total] = await Promise.all([
                prisma.appUser.findMany({
                    where,
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    take: input.limit + 1,
                    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
                }),
                prisma.appUser.count({ where }),
            ]);
            const hasNextPage = rows.length > input.limit;
            const page = rows.slice(0, input.limit);
            return {
                users: page.map(mapUser).map(toAdminUserListItem),
                total,
                nextCursor: hasNextPage ? page.at(-1)?.id : undefined,
            };
        },
        async createUser(input: CreateUserInput): Promise<UserRecord> {
            const password = await hasher.hash(input.password);
            const oauthType = input.oauth?.type ?? 'NONE';
            const now = new Date();
            const data: GatewayPrisma.AppUserCreateInput = {
                loginId: input.username,
                displayName: input.displayName ?? input.username,
                passwordHash: password.hash,
                passwordSalt: password.salt,
                passwordResetRequired: false,
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
            };
            const row = input.oauth
                ? await prisma.$transaction(
                      async (tx) => {
                          const retired = await tx.retiredKakaoIdentity.findUnique({
                              where: { oauthId: input.oauth!.id },
                              select: { id: true },
                          });
                          if (retired) {
                              throw new Error('Kakao identity is permanently retired.');
                          }
                          return tx.appUser.create({ data });
                      },
                      { isolationLevel: 'Serializable' }
                  )
                : await prisma.appUser.create({ data });
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
                        passwordResetRequired: false,
                    },
                });
                user.passwordHash = upgraded.hash;
                user.passwordSalt = upgraded.salt;
                user.passwordResetRequired = false;
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
                    passwordResetRequired: false,
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
        async syncKakaoIdentity(userId: string, email: string, oauthInfo: UserOAuthInfo): Promise<UserRecord> {
            const row = await prisma.appUser.update({
                where: { id: userId },
                data: {
                    email: email.toLowerCase(),
                    oauthInfo: oauthInfo as GatewayPrisma.JsonObject,
                },
            });
            return mapUser(row);
        },
        async markKakaoTalkVerified(userId: string, validUntil: Date): Promise<UserRecord> {
            const row = await prisma.appUser.update({
                where: { id: userId },
                data: { kakaoTalkVerifiedUntil: validUntil },
            });
            return mapUser(row);
        },
        async linkKakao(userId, input): Promise<UserRecord> {
            return prisma.$transaction(
                async (tx) => {
                    const retired = await tx.retiredKakaoIdentity.findUnique({
                        where: { oauthId: input.oauthId },
                        select: { id: true },
                    });
                    if (retired) {
                        throw new Error('Kakao identity is permanently retired.');
                    }
                    const row = await tx.appUser.update({
                        where: { id: userId },
                        data: {
                            oauthType: 'KAKAO',
                            oauthId: input.oauthId,
                            email: input.email.toLowerCase(),
                            oauthInfo: input.oauthInfo as GatewayPrisma.JsonObject,
                            kakaoVerifiedAt: input.verifiedAt,
                            kakaoTalkVerifiedUntil: null,
                        },
                    });
                    return mapUser(row);
                },
                { isolationLevel: 'Serializable' }
            );
        },
        async relinkKakaoByEmail(userId, input): Promise<UserRecord> {
            const normalizedEmail = input.email.toLowerCase();
            return prisma.$transaction(
                async (tx) => {
                    const retired = await tx.retiredKakaoIdentity.findUnique({
                        where: { oauthId: input.oauthId },
                        select: { id: true },
                    });
                    if (retired) {
                        throw new Error('Kakao identity is permanently retired.');
                    }
                    const updated = await tx.appUser.updateMany({
                        where: {
                            id: userId,
                            email: normalizedEmail,
                        },
                        data: {
                            oauthType: 'KAKAO',
                            oauthId: input.oauthId,
                            oauthInfo: input.oauthInfo as GatewayPrisma.JsonObject,
                            kakaoVerifiedAt: input.verifiedAt,
                            kakaoTalkVerifiedUntil: null,
                        },
                    });
                    if (updated.count !== 1) {
                        throw new Error('Kakao account recovery ownership changed.');
                    }
                    const row = await tx.appUser.findUniqueOrThrow({ where: { id: userId } });
                    return mapUser(row);
                },
                { isolationLevel: 'Serializable' }
            );
        },
        async isKakaoIdentityRetired(oauthId: string): Promise<boolean> {
            return (await prisma.retiredKakaoIdentity.count({ where: { oauthId } })) > 0;
        },
        async setKakaoReplacementApproval(userId, input): Promise<UserRecord> {
            const row = await prisma.appUser.update({
                where: { id: userId },
                data: input.until
                    ? {
                          kakaoReplacementApprovedUntil: input.until,
                          kakaoReplacementApprovedByUserId: input.approvedByUserId,
                          kakaoReplacementReason: input.reason,
                      }
                    : {
                          kakaoReplacementApprovedUntil: null,
                          kakaoReplacementApprovedByUserId: null,
                          kakaoReplacementReason: null,
                      },
            });
            return mapUser(row);
        },
        async replaceKakaoWithApprovedIdentity(userId, input): Promise<UserRecord> {
            return prisma.$transaction(
                async (tx) => {
                    const user = await tx.appUser.findUnique({ where: { id: userId } });
                    const now = input.verifiedAt;
                    if (
                        !user ||
                        user.oauthType !== 'KAKAO' ||
                        !user.oauthId ||
                        user.oauthId === input.oauthId ||
                        !user.kakaoReplacementApprovedUntil ||
                        user.kakaoReplacementApprovedUntil < now ||
                        !user.kakaoReplacementApprovedByUserId ||
                        !user.kakaoReplacementReason
                    ) {
                        throw new Error('Kakao account replacement is not approved.');
                    }
                    const normalizedEmail = input.email.toLowerCase();
                    const [oauthOwner, emailOwner, retired] = await Promise.all([
                        tx.appUser.findUnique({ where: { oauthId: input.oauthId }, select: { id: true } }),
                        tx.appUser.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
                        tx.retiredKakaoIdentity.findUnique({ where: { oauthId: input.oauthId }, select: { id: true } }),
                    ]);
                    if (
                        retired ||
                        (oauthOwner && oauthOwner.id !== userId) ||
                        (emailOwner && emailOwner.id !== userId)
                    ) {
                        throw new Error('Kakao account replacement ownership changed.');
                    }
                    await tx.retiredKakaoIdentity.create({
                        data: {
                            oauthId: user.oauthId,
                            formerUserId: user.id,
                            approvedByUserId: user.kakaoReplacementApprovedByUserId,
                            reason: user.kakaoReplacementReason,
                            retiredAt: now,
                        },
                    });
                    const updated = await tx.appUser.updateMany({
                        where: {
                            id: userId,
                            oauthType: 'KAKAO',
                            oauthId: user.oauthId,
                            kakaoReplacementApprovedUntil: { gte: now },
                            kakaoReplacementApprovedByUserId: user.kakaoReplacementApprovedByUserId,
                            kakaoReplacementReason: user.kakaoReplacementReason,
                        },
                        data: {
                            oauthType: 'KAKAO',
                            oauthId: input.oauthId,
                            email: normalizedEmail,
                            oauthInfo: input.oauthInfo as GatewayPrisma.JsonObject,
                            kakaoVerifiedAt: now,
                            kakaoTalkVerifiedUntil: null,
                            kakaoReplacementApprovedUntil: null,
                            kakaoReplacementApprovedByUserId: null,
                            kakaoReplacementReason: null,
                            sessionRevokedBefore: now,
                            authRevision: { increment: 1 },
                        },
                    });
                    if (updated.count !== 1) {
                        throw new Error('Kakao account replacement approval changed.');
                    }
                    const row = await tx.appUser.findUniqueOrThrow({ where: { id: userId } });
                    return mapUser(row);
                },
                { isolationLevel: 'Serializable' }
            );
        },
        async updateIdentity(userId, input): Promise<UserRecord> {
            return prisma.$transaction(
                async (tx) => {
                    const current = await tx.appUser.findUnique({ where: { id: userId } });
                    if (!current) {
                        throw new Error('User not found.');
                    }
                    const [usernameOwner, displayNameOwner] = await Promise.all([
                        tx.appUser.findUnique({ where: { loginId: input.username }, select: { id: true } }),
                        tx.appUser.findUnique({ where: { displayName: input.displayName }, select: { id: true } }),
                    ]);
                    if (
                        (usernameOwner && usernameOwner.id !== userId) ||
                        (displayNameOwner && displayNameOwner.id !== userId)
                    ) {
                        throw new Error('Account identity already exists.');
                    }
                    const nextRevision = new Date(
                        Math.max(input.changedAt.getTime(), current.identityRevision.getTime() + 1)
                    );
                    const row = await tx.appUser.update({
                        where: { id: userId },
                        data: {
                            loginId: input.username,
                            displayName: input.displayName,
                            identityRevision: nextRevision,
                        },
                    });
                    return mapUser(row);
                },
                { isolationLevel: 'Serializable' }
            );
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
        async updateKakaoGraceUntil(userId: string, until: Date | null): Promise<void> {
            await prisma.appUser.update({
                where: { id: userId },
                data: { kakaoGraceUntil: until },
            });
        },
        async listSpecialAccessGrants(userId: string): Promise<SpecialAccountAccessGrantRecord[]> {
            const rows = await prisma.specialAccountAccessGrant.findMany({
                where: { userId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            });
            return rows.map(mapSpecialAccessGrant);
        },
        async createSpecialAccessGrant(userId, input): Promise<SpecialAccountAccessGrantRecord> {
            const row = await prisma.specialAccountAccessGrant.create({
                data: {
                    userId,
                    kind: input.kind,
                    profiles: input.profiles,
                    allowsGeneralCreation: input.allowsGeneralCreation,
                    expiresAt: input.expiresAt,
                    reason: input.reason,
                    grantedByUserId: input.grantedByUserId,
                },
            });
            return mapSpecialAccessGrant(row);
        },
        async revokeSpecialAccessGrant(userId, grantId, input): Promise<SpecialAccountAccessGrantRecord | null> {
            const result = await prisma.specialAccountAccessGrant.updateMany({
                where: { id: grantId, userId, revokedAt: null },
                data: {
                    revokedAt: input.revokedAt,
                    revokedByUserId: input.revokedByUserId,
                    revokedReason: input.reason,
                },
            });
            if (result.count !== 1) {
                return null;
            }
            return mapSpecialAccessGrant(
                await prisma.specialAccountAccessGrant.findUniqueOrThrow({ where: { id: grantId } })
            );
        },
        async updateIcon(userId: string, picture: string, imageServer: number, updatedAt: Date): Promise<void> {
            await prisma.appUser.update({
                where: { id: userId },
                data: {
                    picture,
                    imageServer,
                    iconUpdatedAt: updatedAt,
                    iconRevision: updatedAt,
                },
            });
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
            const rows = await prisma.$queryRaw<Array<{ iconRevision: Date }>>(GatewayPrisma.sql`
                UPDATE "app_user"
                SET
                    "picture" = ${picture},
                    "image_server" = ${imageServer},
                    "icon_updated_at" = CASE
                        WHEN ${consumeDailyQuota} THEN ${updatedAt}
                        ELSE "icon_updated_at"
                    END,
                    "icon_revision" = GREATEST(
                        ${updatedAt},
                        COALESCE("icon_revision", "icon_updated_at", "created_at") + INTERVAL '1 millisecond'
                    )
                WHERE "id" = ${userId}
                  AND (
                      "picture" = 'default.jpg'
                      OR "icon_updated_at" IS NULL
                      OR "icon_updated_at" < ${dayStart}
                      OR (${allowCutoffEquality} AND "icon_updated_at" = ${dayStart})
                  )
                RETURNING "icon_revision" AS "iconRevision"
            `);
            return rows[0]?.iconRevision.toISOString() ?? null;
        },
        async listIcons(userId: string, includeRetired = false): Promise<UserIconRecord[]> {
            const rows = await prisma.userIcon.findMany({
                where: { userId, ...(includeRetired ? {} : { retiredAt: null }) },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            });
            return rows.map(mapIcon);
        },
        async addIconForWindow(userId, picture, imageServer, now, uploadCutoff, maxActive) {
            return prisma.$transaction(async (tx) => {
                const users = await tx.$queryRaw<
                    Array<{ createdAt: Date; iconUpdatedAt: Date | null; iconRevision: Date | null }>
                >(GatewayPrisma.sql`
                    SELECT "created_at" AS "createdAt", "icon_updated_at" AS "iconUpdatedAt",
                           "icon_revision" AS "iconRevision"
                    FROM "app_user" WHERE "id" = ${userId} FOR UPDATE
                `);
                const user = users[0];
                if (!user) return { ok: false as const, reason: 'NOT_FOUND' as const };
                if (user.iconUpdatedAt && user.iconUpdatedAt > uploadCutoff) {
                    return { ok: false as const, reason: 'COOLDOWN' as const };
                }
                const activeCount = await tx.userIcon.count({ where: { userId, retiredAt: null } });
                if (activeCount >= maxActive) return { ok: false as const, reason: 'LIMIT' as const };
                const revision = new Date(
                    Math.max(now.getTime(), user.iconRevision?.getTime() ?? 0, user.createdAt.getTime()) +
                        (now.getTime() <= (user.iconRevision?.getTime() ?? 0) ? 1 : 0)
                );
                const icon = await tx.userIcon.create({ data: { userId, picture, imageServer, createdAt: now } });
                await tx.appUser.update({
                    where: { id: userId },
                    data: { picture, imageServer, iconUpdatedAt: now, iconRevision: revision },
                });
                return { ok: true as const, icon: mapIcon(icon), revision: revision.toISOString() };
            });
        },
        async setPreferredIcon(userId, iconId, now) {
            return prisma.$transaction(async (tx) => {
                const users = await tx.$queryRaw<Array<{ createdAt: Date; iconRevision: Date | null }>>(
                    GatewayPrisma.sql`SELECT "created_at" AS "createdAt", "icon_revision" AS "iconRevision"
                                      FROM "app_user" WHERE "id" = ${userId} FOR UPDATE`
                );
                const user = users[0];
                if (!user) return null;
                const icon = await tx.userIcon.findFirst({ where: { id: iconId, userId, retiredAt: null } });
                if (!icon) return null;
                const previous = Math.max(user.createdAt.getTime(), user.iconRevision?.getTime() ?? 0);
                const revision = new Date(Math.max(now.getTime(), previous + 1));
                await tx.appUser.update({
                    where: { id: userId },
                    data: { picture: icon.picture, imageServer: icon.imageServer, iconRevision: revision },
                });
                return revision.toISOString();
            });
        },
        async retireIconForWindow(userId, iconId, now, retireCutoff) {
            return prisma.$transaction(async (tx) => {
                const users = await tx.$queryRaw<
                    Array<{
                        picture: string;
                        createdAt: Date;
                        iconRevision: Date | null;
                        iconRetiredAt: Date | null;
                    }>
                >(GatewayPrisma.sql`
                    SELECT "picture", "created_at" AS "createdAt", "icon_revision" AS "iconRevision",
                           "icon_retired_at" AS "iconRetiredAt"
                    FROM "app_user" WHERE "id" = ${userId} FOR UPDATE
                `);
                const user = users[0];
                if (!user) return { ok: false as const, reason: 'NOT_FOUND' as const };
                if (user.iconRetiredAt && user.iconRetiredAt > retireCutoff) {
                    return { ok: false as const, reason: 'COOLDOWN' as const };
                }
                const icon = await tx.userIcon.findFirst({ where: { id: iconId, userId } });
                if (!icon) return { ok: false as const, reason: 'NOT_FOUND' as const };
                if (icon.retiredAt) return { ok: false as const, reason: 'ALREADY_RETIRED' as const };
                const retired = await tx.userIcon.update({ where: { id: icon.id }, data: { retiredAt: now } });
                const preferredChanged = user.picture === icon.picture;
                const fallback = preferredChanged
                    ? await tx.userIcon.findFirst({
                          where: { userId, retiredAt: null, id: { not: icon.id } },
                          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                      })
                    : null;
                const previous = Math.max(user.createdAt.getTime(), user.iconRevision?.getTime() ?? 0);
                const revision = new Date(Math.max(now.getTime(), previous + 1));
                await tx.appUser.update({
                    where: { id: userId },
                    data: {
                        iconRetiredAt: now,
                        iconRevision: revision,
                        ...(preferredChanged
                            ? {
                                  picture: fallback?.picture ?? 'default.jpg',
                                  imageServer: fallback?.imageServer ?? 0,
                              }
                            : {}),
                    },
                });
                return {
                    ok: true as const,
                    icon: mapIcon(retired),
                    revision: revision.toISOString(),
                    preferredChanged,
                };
            });
        },
        async resetProfileIcon(userId: string, requestedAt: Date): Promise<string | null> {
            return prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                    Array<{
                        iconRevision: Date | null;
                        iconUpdatedAt: Date | null;
                        createdAt: Date;
                        profileIconResetAt: Date | null;
                    }>
                >(GatewayPrisma.sql`
                    SELECT
                        "icon_revision" AS "iconRevision",
                        "icon_updated_at" AS "iconUpdatedAt",
                        "created_at" AS "createdAt",
                        "profile_icon_reset_at" AS "profileIconResetAt"
                    FROM "app_user"
                    WHERE "id" = ${userId}
                    FOR UPDATE
                `);
                const row = rows[0];
                if (!row) {
                    return null;
                }
                const previous = Math.max(
                    row.createdAt.getTime(),
                    row.iconUpdatedAt?.getTime() ?? 0,
                    row.iconRevision?.getTime() ?? 0,
                    row.profileIconResetAt?.getTime() ?? 0
                );
                const revision = new Date(Math.max(requestedAt.getTime(), previous + 1));
                await tx.appUser.update({
                    where: { id: userId },
                    data: {
                        iconRevision: revision,
                        profileIconResetAt: revision,
                    },
                });
                return revision.toISOString();
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
