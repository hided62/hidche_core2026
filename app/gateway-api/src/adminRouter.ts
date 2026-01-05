import { randomBytes } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { procedure, router } from './trpc.js';
import type { UserSanctions, UserServerRestriction } from './auth/userRepository.js';
import type { AdminAuthContext } from './adminAuth.js';
import type { GatewayApiContext } from './context.js';
import { GATEWAY_BUILD_STATUSES, GATEWAY_PROFILE_STATUSES } from './orchestrator/profileRepository.js';

const zProfileStatus = z.enum(GATEWAY_PROFILE_STATUSES);
const zBuildStatus = z.enum(GATEWAY_BUILD_STATUSES);
const zUserRoleMode = z.enum(['set', 'grant', 'revoke']);
const zServerAction = z.enum([
    'RESUME',
    'PAUSE',
    'STOP',
    'ACCELERATE',
    'DELAY',
    'RESET_NOW',
    'RESET_SCHEDULED',
    'OPEN_SURVEY',
    'SHUTDOWN',
]);

const ADMIN_ROLE_PREFIX = 'admin.';
const ADMIN_ROLE_SUPERUSER = 'admin.superuser';
const ROLE_SUPERUSER = 'superuser';
const ROLE_ADMIN_USERS = 'admin.users.manage';
const ROLE_ADMIN_PROFILES = 'admin.profiles.manage';
const ROLE_ADMIN_NOTICE = 'admin.notice.manage';
const ROLE_RESET_SCHEDULE = 'admin.reset.schedule';
const ROLE_RESUME_WHEN_STOPPED = 'admin.resume.when-stopped';
const ROLE_SURVEY_OPEN = 'admin.survey.open';

const readSessionToken = (headers: Record<string, string | string[] | undefined>): string | null => {
    const provided = headers['x-session-token'] ?? headers['authorization'] ?? '';
    const raw = Array.isArray(provided) ? (provided[0] ?? '') : (provided as string);
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    const trimmed = token.trim();
    return trimmed ? trimmed : null;
};

const isFirstUser = async (ctx: GatewayApiContext, userId: string): Promise<boolean> => {
    const first = await ctx.prisma.appUser.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    });
    return first?.id === userId;
};

const resolveAdminAuth = async (ctx: GatewayApiContext): Promise<AdminAuthContext> => {
    const token = readSessionToken(ctx.requestHeaders);
    if (!token) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Session token is required.',
        });
    }
    const session = await ctx.sessions.getSession(token);
    if (!session) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Session is not valid.',
        });
    }
    const user = await ctx.users.findById(session.userId);
    if (!user) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'User not found.',
        });
    }
    const roles = user.roles;
    const isSuperuser =
        roles.includes(ROLE_SUPERUSER) ||
        roles.includes(ADMIN_ROLE_SUPERUSER) ||
        (await isFirstUser(ctx, session.userId));
    const hasAdminRole = isSuperuser || roles.some((role) => role === 'admin' || role.startsWith(ADMIN_ROLE_PREFIX));
    if (!hasAdminRole) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Admin permission is required.',
        });
    }
    return {
        session,
        user,
        roles,
        isSuperuser,
    };
};

const requireAdminAuth = (ctx: { adminAuth?: AdminAuthContext }): AdminAuthContext => {
    if (!ctx.adminAuth) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Admin session is not available.',
        });
    }
    return ctx.adminAuth;
};

const roleMatchesScope = (role: string, permission: string, profileName?: string): boolean => {
    if (role === permission || role === `${permission}:*`) {
        return true;
    }
    if (profileName && role === `${permission}:${profileName}`) {
        return true;
    }
    return false;
};

const hasScopedPermission = (adminAuth: AdminAuthContext, permission: string, profileName?: string): boolean => {
    if (adminAuth.isSuperuser) {
        return true;
    }
    return adminAuth.roles.some((role: string) => roleMatchesScope(role, permission, profileName));
};

const assertPermission = (adminAuth: AdminAuthContext, permission: string, profileName?: string): void => {
    if (hasScopedPermission(adminAuth, permission, profileName)) {
        return;
    }
    throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Permission denied.',
    });
};

const adminProcedure = procedure.use(async ({ ctx, next }) => {
    const adminAuth = await resolveAdminAuth(ctx as GatewayApiContext);
    return next({
        ctx: {
            ...ctx,
            adminAuth,
        },
    });
});

const noticeAdminProcedure = adminProcedure.use(({ ctx, next }) => {
    const adminAuth = requireAdminAuth(ctx);
    assertPermission(adminAuth, ROLE_ADMIN_NOTICE);
    return next();
});

const userAdminProcedure = adminProcedure.use(({ ctx, next }) => {
    const adminAuth = requireAdminAuth(ctx);
    assertPermission(adminAuth, ROLE_ADMIN_USERS);
    return next();
});

const profileAdminProcedure = adminProcedure.use(({ ctx, next }) => {
    const adminAuth = requireAdminAuth(ctx);
    assertPermission(adminAuth, ROLE_ADMIN_PROFILES);
    return next();
});

const zUserLookupInput = z
    .object({
        id: z.string().min(1).optional(),
        username: z.string().min(1).optional(),
        email: z.string().min(3).optional(),
    })
    .refine((value) => Boolean(value.id || value.username || value.email), {
        message: 'id, username, or email must be provided.',
    });

const zServerRestriction = z.object({
    blockedFeatures: z.array(z.string().min(1)).optional(),
    until: z.string().datetime().nullable().optional(),
    reason: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
});

const zSanctionsPatch = z.object({
    bannedUntil: z.string().datetime().nullable().optional(),
    mutedUntil: z.string().datetime().nullable().optional(),
    suspendedUntil: z.string().datetime().nullable().optional(),
    warningCount: z.number().int().min(0).nullable().optional(),
    flags: z.array(z.string().min(1)).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    profileIconResetAt: z.string().datetime().nullable().optional(),
    serverRestrictions: z.record(z.string(), zServerRestriction.nullable()).nullable().optional(),
});

type SanctionsPatch = z.infer<typeof zSanctionsPatch>;

// 제재 패치 입력을 현재 제재 상태에 병합한다.
const applySanctionsPatch = (current: UserSanctions, patch: SanctionsPatch): UserSanctions => {
    const next: UserSanctions = { ...current };
    const applyField = <K extends keyof UserSanctions>(key: K, value: UserSanctions[K] | null | undefined): void => {
        if (value === undefined) {
            return;
        }
        if (value === null) {
            delete next[key];
            return;
        }
        next[key] = value;
    };

    applyField('bannedUntil', patch.bannedUntil);
    applyField('mutedUntil', patch.mutedUntil);
    applyField('suspendedUntil', patch.suspendedUntil);
    applyField('warningCount', patch.warningCount);
    applyField('flags', patch.flags);
    applyField('notes', patch.notes);
    applyField('profileIconResetAt', patch.profileIconResetAt);

    if (patch.serverRestrictions !== undefined) {
        if (patch.serverRestrictions === null) {
            delete next.serverRestrictions;
        } else {
            const existing = { ...(next.serverRestrictions ?? {}) };
            for (const [profile, restriction] of Object.entries(patch.serverRestrictions)) {
                if (!restriction) {
                    delete existing[profile];
                } else {
                    const merged: UserServerRestriction = {
                        ...(existing[profile] ?? {}),
                    };
                    if (restriction.blockedFeatures !== undefined) {
                        merged.blockedFeatures = restriction.blockedFeatures ?? undefined;
                    }
                    if (restriction.until !== undefined) {
                        merged.until = restriction.until ?? undefined;
                    }
                    if (restriction.reason !== undefined) {
                        merged.reason = restriction.reason ?? undefined;
                    }
                    if (restriction.notes !== undefined) {
                        merged.notes = restriction.notes ?? undefined;
                    }
                    existing[profile] = merged;
                }
            }
            next.serverRestrictions = existing;
        }
    }

    return next;
};

const buildAdminPassword = (): string => randomBytes(6).toString('hex');

// 프로필 메타를 안전하게 읽고, 패치를 병합한다.
const readMetaObject = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return value as Record<string, unknown>;
};

const applyMetaPatch = (
    meta: Record<string, unknown>,
    patch: Record<string, unknown | null | undefined>
): Record<string, unknown> => {
    const next = { ...meta };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            continue;
        }
        if (value === null) {
            delete next[key];
            continue;
        }
        next[key] = value;
    }
    return next;
};

export const adminRouter = router({
    system: router({
        getNotice: adminProcedure.query(async ({ ctx }) => {
            const setting = await ctx.prisma.systemSetting.findUnique({
                where: { id: 1 },
            });
            return { notice: setting?.notice ?? '' };
        }),
        setNotice: noticeAdminProcedure
            .input(
                z.object({
                    notice: z.string().max(4000),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const setting = await ctx.prisma.systemSetting.upsert({
                    where: { id: 1 },
                    create: {
                        id: 1,
                        notice: input.notice,
                    },
                    update: {
                        notice: input.notice,
                    },
                });
                return { notice: setting.notice };
            }),
    }),
    users: router({
        lookup: userAdminProcedure.input(zUserLookupInput).query(async ({ ctx, input }) => {
            const user = input.id
                ? await ctx.users.findById(input.id)
                : input.username
                  ? await ctx.users.findByUsername(input.username)
                  : input.email
                    ? await ctx.users.findByEmail(input.email)
                    : null;
            if (!user) {
                return null;
            }
            return {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                roles: user.roles,
                sanctions: user.sanctions,
                oauthType: user.oauthType,
                oauthId: user.oauthId,
                email: user.email,
                createdAt: user.createdAt,
            };
        }),
        resetPassword: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    newPassword: z.string().min(6).max(128).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const password = input.newPassword ?? buildAdminPassword();
                await ctx.users.updatePassword(input.userId, password);
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-password-reset');
                return { password };
            }),
        updateRoles: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    roles: z.array(z.string().min(1)).min(1),
                    mode: zUserRoleMode.optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'User not found.',
                    });
                }
                const mode = input.mode ?? 'set';
                const roles = new Set(user.roles);
                if (mode === 'set') {
                    roles.clear();
                    for (const role of input.roles) {
                        roles.add(role);
                    }
                } else if (mode === 'grant') {
                    for (const role of input.roles) {
                        roles.add(role);
                    }
                } else {
                    for (const role of input.roles) {
                        roles.delete(role);
                    }
                }
                const nextRoles = Array.from(roles);
                await ctx.users.updateRoles(input.userId, nextRoles);
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-roles-updated');
                return { roles: nextRoles };
            }),
        updateSanctions: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    patch: zSanctionsPatch,
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'User not found.',
                    });
                }
                const next = applySanctionsPatch(user.sanctions, input.patch);
                await ctx.users.updateSanctions(input.userId, next);
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-sanctions-updated');
                return { sanctions: next };
            }),
        setServerRestriction: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    profile: z.string().min(1).max(64),
                    restriction: zServerRestriction.nullable(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'User not found.',
                    });
                }
                const patch: SanctionsPatch = {
                    serverRestrictions: {
                        [input.profile]: input.restriction ?? null,
                    },
                };
                const next = applySanctionsPatch(user.sanctions, patch);
                await ctx.users.updateSanctions(input.userId, next);
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-server-restriction');
                return { sanctions: next };
            }),
        resetProfileIcon: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'User not found.',
                    });
                }
                const next = applySanctionsPatch(user.sanctions, {
                    profileIconResetAt: new Date().toISOString(),
                });
                await ctx.users.updateSanctions(input.userId, next);
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-profile-icon-reset');
                return { profileIconResetAt: next.profileIconResetAt };
            }),
        forceDelete: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                })
            )
            .mutation(async ({ ctx, input }) => {
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-force-withdraw');
                await ctx.users.deleteUser(input.userId);
                return { ok: true };
            }),
    }),
    profiles: router({
        list: adminProcedure.query(async ({ ctx }) => {
            const profiles = await ctx.profiles.listProfiles();
            const runtimeStates = await ctx.orchestrator.listRuntimeStates(
                profiles.map((profile) => profile.profileName)
            );
            const runtimeMap = new Map(runtimeStates.map((state) => [state.profileName, state]));
            return profiles.map((profile) => ({
                ...profile,
                runtime: runtimeMap.get(profile.profileName) ?? {
                    profileName: profile.profileName,
                    apiRunning: false,
                    daemonRunning: false,
                },
            }));
        }),
        upsert: profileAdminProcedure
            .input(
                z.object({
                    profile: z.string().min(1).max(32),
                    scenario: z.string().min(1).max(64),
                    apiPort: z.number().int().min(1).max(65535),
                    status: zProfileStatus.optional(),
                    preopenAt: z.string().datetime().optional(),
                    openAt: z.string().datetime().optional(),
                    scheduledStartAt: z.string().datetime().optional(),
                    buildCommitSha: z.string().min(7).max(64).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const status = input.status ?? 'STOPPED';
                return ctx.profiles.upsertProfile({
                    profile: input.profile,
                    scenario: input.scenario,
                    apiPort: input.apiPort,
                    status,
                    preopenAt: input.preopenAt,
                    openAt: input.openAt,
                    scheduledStartAt: input.scheduledStartAt,
                    buildCommitSha: input.buildCommitSha,
                });
            }),
        setStatus: profileAdminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    status: zProfileStatus,
                    preopenAt: z.string().datetime().optional(),
                    openAt: z.string().datetime().optional(),
                    scheduledStartAt: z.string().datetime().optional(),
                    buildCommitSha: z.string().min(7).max(64).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                if (input.status === 'RESERVED' && (!input.preopenAt || !input.openAt)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'preopenAt and openAt are required for RESERVED status.',
                    });
                }
                const result = await ctx.profiles.updateStatus(input.profileName, input.status, {
                    preopenAt: input.preopenAt,
                    openAt: input.openAt,
                    scheduledStartAt: input.status === 'RESERVED' ? input.scheduledStartAt : null,
                });
                if (input.buildCommitSha) {
                    await ctx.profiles.updateBuildStatus(input.profileName, 'IDLE', {
                        commitSha: input.buildCommitSha,
                    });
                }
                await ctx.orchestrator.reconcileNow();
                return result;
            }),
        updateMeta: profileAdminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    patch: z.object({
                        korName: z.string().min(1).max(64).nullable().optional(),
                        color: z.string().min(1).max(32).nullable().optional(),
                        inGameNotice: z.string().max(4000).nullable().optional(),
                        profileImageUrl: z.string().max(2048).nullable().optional(),
                    }),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'Profile not found.',
                    });
                }
                const meta = readMetaObject(profile.meta);
                const nextMeta = applyMetaPatch(meta, input.patch);
                return ctx.profiles.updateMeta(input.profileName, nextMeta);
            }),
        requestAction: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    action: zServerAction,
                    durationMinutes: z.number().int().min(1).max(1440).optional(),
                    scheduledAt: z.string().datetime().optional(),
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                if ((input.action === 'ACCELERATE' || input.action === 'DELAY') && !input.durationMinutes) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'durationMinutes is required for acceleration or delay.',
                    });
                }
                if (input.action === 'RESET_SCHEDULED' && !input.scheduledAt) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'scheduledAt is required for scheduled reset.',
                    });
                }
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'Profile not found.',
                    });
                }

                const canManageProfiles = hasScopedPermission(adminAuth, ROLE_ADMIN_PROFILES, profile.profileName);
                const canResume =
                    canManageProfiles || hasScopedPermission(adminAuth, ROLE_RESUME_WHEN_STOPPED, profile.profileName);
                const canResetSchedule =
                    canManageProfiles || hasScopedPermission(adminAuth, ROLE_RESET_SCHEDULE, profile.profileName);
                const canOpenSurvey =
                    canManageProfiles || hasScopedPermission(adminAuth, ROLE_SURVEY_OPEN, profile.profileName);

                if (input.action === 'RESUME') {
                    if (profile.status !== 'STOPPED') {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Resume is allowed only for STOPPED profiles.',
                        });
                    }
                    if (!canResume) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Resume permission is required.',
                        });
                    }
                } else if (input.action === 'RESET_SCHEDULED') {
                    if (profile.status !== 'COMPLETED') {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Reset scheduling is allowed only for COMPLETED profiles.',
                        });
                    }
                    if (!canResetSchedule) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Reset scheduling permission is required.',
                        });
                    }
                } else if (input.action === 'OPEN_SURVEY') {
                    if (!canOpenSurvey) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Survey permission is required.',
                        });
                    }
                } else if (!canManageProfiles) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'Profile management permission is required.',
                    });
                }

                const statusMap = {
                    RESUME: 'RUNNING',
                    PAUSE: 'PAUSED',
                    STOP: 'STOPPED',
                    SHUTDOWN: 'DISABLED',
                } as const;
                const mappedStatus = statusMap[input.action as keyof typeof statusMap];
                if (mappedStatus) {
                    await ctx.profiles.updateStatus(input.profileName, mappedStatus);
                    await ctx.orchestrator.reconcileNow();
                }

                const meta = readMetaObject(profile.meta);
                const actionLog = Array.isArray(meta.adminActions)
                    ? meta.adminActions.filter((entry) => entry && typeof entry === 'object')
                    : [];
                const actionRecord = {
                    action: input.action,
                    requestedAt: new Date().toISOString(),
                    durationMinutes: input.durationMinutes ?? null,
                    scheduledAt: input.scheduledAt ?? null,
                    reason: input.reason ?? null,
                    status: 'REQUESTED',
                };
                const nextMeta = {
                    ...meta,
                    adminActions: [...actionLog, actionRecord],
                };
                await ctx.profiles.updateMeta(input.profileName, nextMeta);
                return { ok: true, action: actionRecord };
            }),
        requestBuild: profileAdminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    commitSha: z.string().min(7).max(64),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const requestedAt = new Date().toISOString();
                const result = await ctx.profiles.updateBuildStatus(input.profileName, 'QUEUED', {
                    requestedAt,
                    error: null,
                    commitSha: input.commitSha,
                });
                return result;
            }),
        setBuildStatus: profileAdminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    status: zBuildStatus,
                })
            )
            .mutation(async ({ ctx, input }) => ctx.profiles.updateBuildStatus(input.profileName, input.status)),
        reconcileNow: profileAdminProcedure.mutation(async ({ ctx }) => {
            await ctx.orchestrator.reconcileNow();
            return { ok: true };
        }),
        cleanupWorkspaces: profileAdminProcedure.mutation(async ({ ctx }) => {
            const result = await ctx.orchestrator.cleanupStaleWorkspaces();
            return {
                removed: result.removed,
                skipped: result.skipped,
            };
        }),
    }),
});
