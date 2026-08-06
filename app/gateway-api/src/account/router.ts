import { randomBytes } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import sharp from 'sharp';
import { z } from 'zod';

import type { GatewayApiContext } from '../context.js';
import { procedure, router } from '../trpc.js';
import type { UserRecord, UserSanctions } from '../auth/userRepository.js';
import { openPassword, zPasswordEnvelope } from '../auth/registrationInput.js';
import { resolveEffectiveAccountIcon } from '../auth/accountIconProjection.js';

const zSessionToken = z.string().min(1);
const MAX_ICON_BYTES = 50 * 1024;
const MAX_ACTIVE_ICONS = 5;
const ICON_UPLOAD_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ICON_RETIRE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_ICON_FORMATS = new Set(['avif', 'webp', 'jpeg', 'png', 'gif']);
const ICON_CONTENT_TYPES: Record<string, string> = {
    avif: 'image/avif',
    webp: 'image/webp',
    jpg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
};

const requireSessionUser = async (ctx: GatewayApiContext, sessionToken: string): Promise<UserRecord> => {
    const session = await ctx.sessions.getSession(sessionToken);
    if (!session) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session is not valid.' });
    }
    const user = await ctx.users.findById(session.userId);
    if (!user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User no longer exists.' });
    }
    return user;
};

const decodeImage = (input: string): Buffer => {
    const match = input.match(/^data:[^;]+;base64,(.+)$/);
    const encoded = match?.[1] ?? input;
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '아이콘은 50KB 이하여야 합니다.' });
    }
    return buffer;
};

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export const kstDayStart = (value: Date): Date => {
    const shifted = new Date(value.getTime() + SEOUL_OFFSET_MS);
    return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - SEOUL_OFFSET_MS);
};

const assertIconChangeAvailable = (user: UserRecord, now: Date): void => {
    if (
        user.picture !== 'default.jpg' &&
        user.iconUpdatedAt &&
        new Date(user.iconUpdatedAt).getTime() > now.getTime() - ICON_UPLOAD_COOLDOWN_MS
    ) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '아이콘 업로드는 24시간에 한 번만 가능합니다.' });
    }
};

const hasActiveSanction = (sanctions: UserSanctions, now: Date): boolean => {
    const dates = [sanctions.bannedUntil, sanctions.mutedUntil, sanctions.suspendedUntil];
    for (const value of dates) {
        if (value && new Date(value) > now) return true;
    }
    return Object.values(sanctions.serverRestrictions ?? {}).some((restriction) =>
        Boolean(restriction.until && new Date(restriction.until) > now)
    );
};

const encodeIconPath = (picture: string): string => picture.split('/').map(encodeURIComponent).join('/');

const buildPictureUrl = (ctx: GatewayApiContext, picture: string, imageServer: number): string =>
    imageServer === 1
        ? `${ctx.userIconPublicUrl.replace(/\/$/, '')}/${encodeURIComponent(picture)}`
        : `${ctx.sharedIconPublicUrl.replace(/\/$/, '')}/${encodeIconPath(picture)}`;

const buildIconUrl = (ctx: GatewayApiContext, user: UserRecord): string | null => {
    const icon = resolveEffectiveAccountIcon(user);
    if (icon.picture === 'default.jpg') return null;
    return buildPictureUrl(ctx, icon.picture, icon.imageServer);
};

const buildLibraryIcon = (
    ctx: GatewayApiContext,
    icon: Awaited<ReturnType<GatewayApiContext['users']['listIcons']>>[number]
) => ({
    id: icon.id,
    picture: icon.picture,
    imageServer: icon.imageServer,
    createdAt: icon.createdAt,
    retiredAt: icon.retiredAt ?? null,
    url: buildPictureUrl(ctx, icon.picture, icon.imageServer),
});

const listIconSyncProfiles = async (ctx: GatewayApiContext, userId: string) =>
    (await ctx.profileStatus.listLobbyProfiles({ userId }))
        .filter(
            (profile) => (profile.status === 'RUNNING' || profile.status === 'PREOPEN') && profile.runtime.apiRunning
        )
        .map(({ profileName, profile, apiPort, korName }) => ({
            profileName,
            profile,
            apiPort,
            korName,
        }));

const publishIconFlush = async (
    ctx: GatewayApiContext,
    userId: string,
    reason: 'account-icon-changed' | 'account-icon-deleted'
): Promise<boolean> => {
    try {
        await ctx.flushPublisher.publishUserFlush(userId, reason);
        return true;
    } catch {
        return false;
    }
};

export const accountRouter = router({
    get: procedure.input(z.object({ sessionToken: zSessionToken })).query(async ({ ctx, input }) => {
        const user = await requireSessionUser(ctx, input.sessionToken);
        const icons = await ctx.users.listIcons(user.id);
        return {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            roles: user.roles,
            oauthType: user.oauthType,
            createdAt: user.createdAt,
            iconUrl: buildIconUrl(ctx, user),
            icons: icons.map((icon) => buildLibraryIcon(ctx, icon)),
            preferredPicture: resolveEffectiveAccountIcon(user).picture,
            maxActiveIcons: MAX_ACTIVE_ICONS,
            nextUploadAt: user.iconUpdatedAt
                ? new Date(new Date(user.iconUpdatedAt).getTime() + ICON_UPLOAD_COOLDOWN_MS).toISOString()
                : null,
            nextRetireAt: user.iconRetiredAt
                ? new Date(new Date(user.iconRetiredAt).getTime() + ICON_RETIRE_COOLDOWN_MS).toISOString()
                : null,
            thirdPartyUse: user.thirdPartyUse,
            deleteAfter: user.deleteAfter ?? null,
        };
    }),
    changePassword: procedure
        .input(
            z.object({
                sessionToken: zSessionToken,
                currentCredential: zPasswordEnvelope,
                newCredential: zPasswordEnvelope,
            })
        )
        .mutation(async ({ ctx, input }) => {
            const user = await requireSessionUser(ctx, input.sessionToken);
            const currentPassword = openPassword(ctx.passwordEnvelope, input.currentCredential);
            if (!(await ctx.users.verifyPassword(user, currentPassword))) {
                throw new TRPCError({ code: 'UNAUTHORIZED', message: '현재 비밀번호가 일치하지 않습니다.' });
            }
            const newPassword = openPassword(ctx.passwordEnvelope, input.newCredential);
            await ctx.users.updatePassword(user.id, newPassword);
            await ctx.flushPublisher.publishUserFlush(user.id, 'password-changed');
            return { ok: true };
        }),
    scheduleDeletion: procedure
        .input(z.object({ sessionToken: zSessionToken, currentCredential: zPasswordEnvelope }))
        .mutation(async ({ ctx, input }) => {
            const user = await requireSessionUser(ctx, input.sessionToken);
            const currentPassword = openPassword(ctx.passwordEnvelope, input.currentCredential);
            if (!(await ctx.users.verifyPassword(user, currentPassword))) {
                throw new TRPCError({ code: 'UNAUTHORIZED', message: '현재 비밀번호가 일치하지 않습니다.' });
            }
            if (user.deleteAfter) {
                throw new TRPCError({ code: 'CONFLICT', message: '이미 탈퇴 처리되어 있습니다.' });
            }
            const now = new Date();
            if (hasActiveSanction(user.sanctions, now)) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '징계가 남아 있어 탈퇴할 수 없습니다.' });
            }
            const deleteAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            await ctx.users.scheduleDeletion(user.id, deleteAfter);
            await ctx.sessions.revokeSession(input.sessionToken, { revokeGames: true });
            await ctx.flushPublisher.publishUserFlush(user.id, 'account-deletion-scheduled');
            return { ok: true, deleteAfter: deleteAfter.toISOString() };
        }),
    disallowThirdPartyUse: procedure
        .input(z.object({ sessionToken: zSessionToken }))
        .mutation(async ({ ctx, input }) => {
            const user = await requireSessionUser(ctx, input.sessionToken);
            await ctx.users.setThirdPartyUse(user.id, false);
            return { ok: true };
        }),
    changeIcon: procedure
        .input(
            z.object({
                sessionToken: zSessionToken,
                imageData: z.string().min(1).max(100_000),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const user = await requireSessionUser(ctx, input.sessionToken);
            const now = new Date();
            assertIconChangeAvailable(user, now);
            const profiles = await listIconSyncProfiles(ctx, user.id);
            const buffer = decodeImage(input.imageData);
            const metadata = await sharp(buffer, { animated: true }).metadata();
            if (!metadata.format || !ALLOWED_ICON_FORMATS.has(metadata.format)) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'avif, webp, jpg, gif, png 아이콘만 사용할 수 있습니다.',
                });
            }
            if (!metadata.width || metadata.width < 64 || metadata.width > 128 || metadata.height !== metadata.width) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: '아이콘은 64x64~128x128 범위의 정사각형이어야 합니다.',
                });
            }
            const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
            const filename = `${randomBytes(8).toString('hex')}.${extension}`;
            if (!ctx.userIconUpload) {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '이미지 저장소가 설정되지 않았습니다.' });
            }
            const uploaded = await ctx.userIconUpload.upload({
                filename,
                contentType: ICON_CONTENT_TYPES[extension]!,
                body: buffer,
            });
            let stored;
            try {
                stored = await ctx.users.addIconForWindow(
                    user.id,
                    uploaded.picture,
                    0,
                    now,
                    new Date(now.getTime() - ICON_UPLOAD_COOLDOWN_MS),
                    MAX_ACTIVE_ICONS
                );
            } catch (error) {
                throw error;
            }
            if (!stored.ok) {
                if (stored.reason === 'LIMIT') {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: '전용 아이콘은 최대 5개까지 등록할 수 있습니다.',
                    });
                }
                throw new TRPCError({
                    code: 'TOO_MANY_REQUESTS',
                    message: '아이콘 업로드는 24시간에 한 번만 가능합니다.',
                });
            }
            const flushPublished = await publishIconFlush(ctx, user.id, 'account-icon-changed');
            return {
                ok: true,
                iconUrl: uploaded.publicUrl,
                revision: stored.revision,
                icon: buildLibraryIcon(ctx, stored.icon),
                profiles,
                flushPublished,
            };
        }),
    setPreferredIcon: procedure
        .input(z.object({ sessionToken: zSessionToken, iconId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const user = await requireSessionUser(ctx, input.sessionToken);
            const revision = await ctx.users.setPreferredIcon(user.id, input.iconId, new Date());
            if (!revision) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '사용 가능한 내 전용 아이콘이 아닙니다.' });
            }
            const updated = await ctx.users.findById(user.id);
            if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });
            const flushPublished = await publishIconFlush(ctx, user.id, 'account-icon-changed');
            return { ok: true, revision, iconUrl: buildIconUrl(ctx, updated), flushPublished };
        }),
    retireIcon: procedure
        .input(z.object({ sessionToken: zSessionToken, iconId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const user = await requireSessionUser(ctx, input.sessionToken);
            const now = new Date();
            const result = await ctx.users.retireIconForWindow(
                user.id,
                input.iconId,
                now,
                new Date(now.getTime() - ICON_RETIRE_COOLDOWN_MS)
            );
            if (!result.ok) {
                if (result.reason === 'COOLDOWN') {
                    throw new TRPCError({
                        code: 'TOO_MANY_REQUESTS',
                        message: '전용 아이콘은 7일에 한 번만 목록에서 내릴 수 있습니다.',
                    });
                }
                throw new TRPCError({ code: 'NOT_FOUND', message: '사용 가능한 내 전용 아이콘이 아닙니다.' });
            }
            const updated = await ctx.users.findById(user.id);
            const flushPublished = await publishIconFlush(ctx, user.id, 'account-icon-changed');
            return {
                ok: true,
                revision: result.revision,
                preferredChanged: result.preferredChanged,
                iconUrl: updated ? buildIconUrl(ctx, updated) : null,
                flushPublished,
            };
        }),
    deleteIcon: procedure.input(z.object({ sessionToken: zSessionToken })).mutation(async ({ ctx, input }) => {
        const user = await requireSessionUser(ctx, input.sessionToken);
        const now = new Date();
        assertIconChangeAvailable(user, now);
        const profiles = await listIconSyncProfiles(ctx, user.id);
        const revision = await ctx.users.updateIconForDay(
            user.id,
            'default.jpg',
            0,
            now,
            new Date(now.getTime() - ICON_UPLOAD_COOLDOWN_MS),
            false,
            true
        );
        if (!revision) {
            throw new TRPCError({
                code: 'TOO_MANY_REQUESTS',
                message: '아이콘 변경은 24시간에 한 번만 가능합니다.',
            });
        }
        const flushPublished = await publishIconFlush(ctx, user.id, 'account-icon-deleted');
        return {
            ok: true,
            iconUrl: null,
            revision,
            profiles,
            flushPublished,
        };
    }),
    prepareIconSync: procedure.input(z.object({ sessionToken: zSessionToken })).query(async ({ ctx, input }) => {
        const user = await requireSessionUser(ctx, input.sessionToken);
        return {
            iconUrl: buildIconUrl(ctx, user),
            projection: resolveEffectiveAccountIcon(user),
            profiles: await listIconSyncProfiles(ctx, user.id),
        };
    }),
});
