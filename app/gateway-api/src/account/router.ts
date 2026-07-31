import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

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
const ALLOWED_ICON_FORMATS = new Set(['avif', 'webp', 'jpeg', 'png', 'gif']);

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
    if (user.picture !== 'default.jpg' && user.iconUpdatedAt && new Date(user.iconUpdatedAt) >= kstDayStart(now)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '아이콘은 하루에 한 번만 변경할 수 있습니다.' });
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

const buildIconUrl = (ctx: GatewayApiContext, user: UserRecord): string | null => {
    const icon = resolveEffectiveAccountIcon(user);
    if (icon.imageServer !== 1 || icon.picture === 'default.jpg') return null;
    return `${ctx.userIconPublicUrl.replace(/\/$/, '')}/${encodeURIComponent(icon.picture)}`;
};

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
        return {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            roles: user.roles,
            oauthType: user.oauthType,
            createdAt: user.createdAt,
            iconUrl: buildIconUrl(ctx, user),
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
            await fs.mkdir(ctx.userIconDir, { recursive: true });
            await fs.writeFile(path.join(ctx.userIconDir, filename), buffer, { flag: 'wx' });
            let revision: string | null;
            try {
                revision = await ctx.users.updateIconForDay(user.id, filename, 1, now, kstDayStart(now), true);
            } catch (error) {
                await fs.rm(path.join(ctx.userIconDir, filename), { force: true });
                throw error;
            }
            if (!revision) {
                await fs.rm(path.join(ctx.userIconDir, filename), { force: true });
                throw new TRPCError({
                    code: 'TOO_MANY_REQUESTS',
                    message: '아이콘은 하루에 한 번만 변경할 수 있습니다.',
                });
            }
            const flushPublished = await publishIconFlush(ctx, user.id, 'account-icon-changed');
            return {
                ok: true,
                iconUrl: `${ctx.userIconPublicUrl.replace(/\/$/, '')}/${filename}`,
                revision,
                profiles,
                flushPublished,
            };
        }),
    deleteIcon: procedure.input(z.object({ sessionToken: zSessionToken })).mutation(async ({ ctx, input }) => {
        const user = await requireSessionUser(ctx, input.sessionToken);
        const now = new Date();
        assertIconChangeAvailable(user, now);
        const profiles = await listIconSyncProfiles(ctx, user.id);
        const revision = await ctx.users.updateIconForDay(user.id, 'default.jpg', 0, now, kstDayStart(now), false);
        if (!revision) {
            throw new TRPCError({
                code: 'TOO_MANY_REQUESTS',
                message: '아이콘은 하루에 한 번만 변경할 수 있습니다.',
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
