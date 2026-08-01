import { randomBytes } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { GatewayPrisma } from '@sammo-ts/infra';

import { procedure, router } from './trpc.js';
import { listScenarioPreviews, resolveGitBranchCommitSha, resolveGitCommitSha } from './scenario/scenarioCatalog.js';
import type { UserSanctions, UserServerRestriction } from './auth/userRepository.js';
import { toPublicUser } from './auth/userRepository.js';
import type { AdminAuthContext } from './adminAuth.js';
import type { GatewayApiContext } from './context.js';
import { GATEWAY_BUILD_STATUSES, GATEWAY_PROFILE_STATUSES } from './orchestrator/profileRepository.js';
import { purifyGatewayNoticeHtml } from './security/gatewayNoticeHtml.js';

const zProfileStatus = z.enum(GATEWAY_PROFILE_STATUSES);
const zBuildStatus = z.enum(GATEWAY_BUILD_STATUSES);
const zUserRoleMode = z.enum(['set', 'grant', 'revoke']);
const zJoinMode = z.enum(['full', 'onlyRandom']);
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

const TURN_TERM_MINUTES = [1, 2, 5, 10, 20, 30, 60, 120] as const;
const AUTORUN_USER_OPTIONS = ['develop', 'warp', 'recruit', 'recruit_high', 'train', 'battle', 'chief'] as const;

const ADMIN_ROLE_PREFIX = 'admin.';
const ADMIN_ROLE_SUPERUSER = 'admin.superuser';
const ROLE_SUPERUSER = 'superuser';
const ROLE_ADMIN_USERS = 'admin.users.manage';
const ROLE_ADMIN_USERS_CREATE = 'admin.users.create';
const ROLE_ADMIN_PROFILES = 'admin.profiles.manage';
const ROLE_ADMIN_RELEASES = 'admin.releases.manage';
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

const splitRoleScope = (role: string): { permission: string; scope?: string } => {
    const separator = role.indexOf(':');
    if (separator < 0) {
        return { permission: role };
    }
    return {
        permission: role.slice(0, separator),
        scope: role.slice(separator + 1),
    };
};

const isRootAdminRole = (role: string): boolean =>
    role === ROLE_SUPERUSER || role === 'admin' || role === ADMIN_ROLE_SUPERUSER;

const canManageRole = (adminAuth: AdminAuthContext, role: string): boolean => {
    if (adminAuth.isSuperuser) {
        return true;
    }
    if (isRootAdminRole(role)) {
        return false;
    }
    const target = splitRoleScope(role);
    return adminAuth.roles.some((callerRole) => {
        const caller = splitRoleScope(callerRole);
        if (caller.permission !== target.permission) {
            return false;
        }
        return caller.scope === undefined || caller.scope === '*' || caller.scope === target.scope;
    });
};

const assertRoleChangesAllowed = (
    adminAuth: AdminAuthContext,
    currentRoles: ReadonlySet<string>,
    nextRoles: ReadonlySet<string>
): void => {
    const changedRoles = new Set([...currentRoles, ...nextRoles]);
    for (const role of changedRoles) {
        if (currentRoles.has(role) === nextRoles.has(role)) {
            continue;
        }
        if (!canManageRole(adminAuth, role)) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: `Role change exceeds caller scope: ${role}`,
            });
        }
    }
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

const canCreateLocalUser = (adminAuth: AdminAuthContext): boolean =>
    hasScopedPermission(adminAuth, ROLE_ADMIN_USERS_CREATE) || hasScopedPermission(adminAuth, ROLE_ADMIN_USERS);

// 로컬 계정 임의 생성은 환경 설정이 켜져 있을 때만 허용한다.
const assertLocalAccountEnabled = (ctx: GatewayApiContext): void => {
    if (ctx.adminLocalAccountEnabled) {
        return;
    }
    throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Local account provisioning is disabled.',
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

const userCreateProcedure = adminProcedure.use(({ ctx, next }) => {
    const adminAuth = requireAdminAuth(ctx);
    if (!canCreateLocalUser(adminAuth)) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Permission denied.',
        });
    }
    return next();
});

const profileAdminProcedure = adminProcedure.use(({ ctx, next }) => {
    const adminAuth = requireAdminAuth(ctx);
    assertPermission(adminAuth, ROLE_ADMIN_PROFILES);
    return next();
});

const releaseAdminProcedure = adminProcedure.use(({ ctx, next }) => {
    const adminAuth = requireAdminAuth(ctx);
    assertPermission(adminAuth, ROLE_ADMIN_RELEASES);
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

const zSanctionsPatch = z
    .object({
        bannedUntil: z.string().datetime().nullable().optional(),
        mutedUntil: z.string().datetime().nullable().optional(),
        suspendedUntil: z.string().datetime().nullable().optional(),
        warningCount: z.number().int().min(0).nullable().optional(),
        flags: z.array(z.string().min(1)).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        serverRestrictions: z.record(z.string(), zServerRestriction.nullable()).nullable().optional(),
    })
    .strict();

const zLocalAccountInput = z.object({
    username: z.string().min(2).max(32),
    password: z.string().min(6).max(128),
    displayName: z.string().min(2).max(40).optional(),
});

const zInstallAutorun = z.object({
    limitMinutes: z.number().int().min(0).max(43200),
    options: z.array(z.enum(AUTORUN_USER_OPTIONS)),
});

const isAllowedTurnTerm = (value: number): boolean => TURN_TERM_MINUTES.some((term) => term === value);
const isUniqueConstraintError = (error: unknown): boolean =>
    Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');

const zInstallOptions = z.object({
    scenarioId: z.number().int().min(0),
    turnTermMinutes: z
        .number()
        .int()
        .refine((value) => isAllowedTurnTerm(value), {
            message: 'turnTermMinutes must divide 120.',
        }),
    sync: z.boolean(),
    fiction: z.number().int().min(0).max(1),
    extend: z.boolean(),
    blockGeneralCreate: z.number().int().min(0).max(2),
    npcMode: z.number().int().min(0).max(2),
    showImgLevel: z.number().int().min(0).max(3),
    tournamentTrig: z.boolean(),
    joinMode: zJoinMode,
    autorunUser: zInstallAutorun.nullable().optional(),
    openAt: z.string().datetime().optional(),
    preopenAt: z.string().datetime().optional(),
    gitRef: z.string().min(1).max(128).optional(),
});
const zOperationInstallOptions = zInstallOptions.omit({ gitRef: true });
const zSourceMode = z.enum(['BRANCH', 'COMMIT']);

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
            return { notice: purifyGatewayNoticeHtml(setting?.notice) };
        }),
        setNotice: noticeAdminProcedure
            .input(
                z.object({
                    notice: z.string().max(4000),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const notice = purifyGatewayNoticeHtml(input.notice);
                const setting = await ctx.prisma.systemSetting.upsert({
                    where: { id: 1 },
                    create: {
                        id: 1,
                        notice,
                    },
                    update: {
                        notice,
                    },
                });
                return { notice: purifyGatewayNoticeHtml(setting.notice) };
            }),
    }),
    users: router({
        getLocalAccountStatus: adminProcedure.query(({ ctx }) => ({
            enabled: (ctx as GatewayApiContext).adminLocalAccountEnabled,
        })),
        createLocal: userCreateProcedure.input(zLocalAccountInput).mutation(async ({ ctx, input }) => {
            const gatewayCtx = ctx as GatewayApiContext;
            assertLocalAccountEnabled(gatewayCtx);
            const existing = await gatewayCtx.users.findByUsername(input.username);
            if (existing) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'Username already exists.',
                });
            }
            try {
                const created = await gatewayCtx.users.createUser({
                    username: input.username,
                    password: input.password,
                    displayName: input.displayName,
                });
                return { user: toPublicUser(created) };
            } catch (error) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'Username already exists.',
                    cause: error,
                });
            }
        }),
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
                profileIconResetAt: user.profileIconResetAt,
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
                    roles: z.array(z.string().trim().min(1).max(128)).min(1),
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
                const currentRoles = new Set(user.roles);
                const roles = new Set(currentRoles);
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
                const adminAuth = requireAdminAuth(ctx);
                assertRoleChangesAllowed(adminAuth, currentRoles, roles);
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
                const profileIconResetAt = await ctx.users.resetProfileIcon(input.userId, new Date());
                if (!profileIconResetAt) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'User not found.',
                    });
                }
                let flushPublished = true;
                try {
                    await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-profile-icon-reset', {
                        iconRevision: profileIconResetAt,
                    });
                } catch {
                    flushPublished = false;
                }
                return { profileIconResetAt, flushPublished };
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
    operations: router({
        list: adminProcedure
            .input(
                z
                    .object({
                        profileName: z.string().min(1).optional(),
                        limit: z.number().int().min(1).max(200).optional(),
                    })
                    .optional()
            )
            .query(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                if (input?.profileName) {
                    assertPermission(adminAuth, ROLE_ADMIN_PROFILES, input.profileName);
                    return ctx.profiles.listOperations({
                        profileName: input.profileName,
                        limit: input.limit,
                    });
                }
                if (hasScopedPermission(adminAuth, ROLE_ADMIN_PROFILES)) {
                    return ctx.profiles.listOperations({ limit: input?.limit });
                }
                const profiles = await ctx.profiles.listProfiles();
                const allowed = profiles.filter((profile) =>
                    hasScopedPermission(adminAuth, ROLE_ADMIN_PROFILES, profile.profileName)
                );
                const operations = (
                    await Promise.all(
                        allowed.map((profile) =>
                            ctx.profiles.listOperations({
                                profileName: profile.profileName,
                                limit: input?.limit,
                            })
                        )
                    )
                )
                    .flat()
                    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
                return operations.slice(0, input?.limit ?? 50);
            }),
        requestReset: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    sourceMode: zSourceMode,
                    sourceRef: z.string().min(1).max(128),
                    install: zOperationInstallOptions,
                    scheduledAt: z.string().datetime().optional(),
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                assertPermission(adminAuth, ROLE_ADMIN_PROFILES, input.profileName);
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile not found.' });
                }
                if (input.scheduledAt && new Date(input.scheduledAt).getTime() <= Date.now()) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'scheduledAt must be in the future.',
                    });
                }
                const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
                const openAt = input.install.openAt ? new Date(input.install.openAt) : null;
                const preopenAt = input.install.preopenAt ? new Date(input.install.preopenAt) : null;
                if (preopenAt && !openAt) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'openAt is required when preopenAt is set.',
                    });
                }
                if (preopenAt && openAt && preopenAt.getTime() >= openAt.getTime()) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'preopenAt must be earlier than openAt.',
                    });
                }
                if (openAt && openAt.getTime() <= (scheduledAt?.getTime() ?? Date.now())) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'openAt must be later than the reset start.',
                    });
                }
                if (preopenAt && scheduledAt && preopenAt.getTime() < scheduledAt.getTime()) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'preopenAt cannot be earlier than scheduledAt.',
                    });
                }
                const autorunUser = input.install.autorunUser;
                if (
                    autorunUser &&
                    ((autorunUser.limitMinutes <= 0 && autorunUser.options.length > 0) ||
                        (autorunUser.limitMinutes > 0 && autorunUser.options.length === 0))
                ) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'autorunUser minutes and options must be configured together.',
                    });
                }

                let sourceRef = input.sourceRef.trim();
                try {
                    const resolved =
                        input.sourceMode === 'BRANCH'
                            ? await resolveGitBranchCommitSha(sourceRef)
                            : await resolveGitCommitSha(sourceRef);
                    if (input.sourceMode === 'COMMIT') {
                        sourceRef = resolved;
                    }
                    const scenarios = await listScenarioPreviews({ gitRef: resolved });
                    if (!scenarios.some((scenario) => scenario.id === input.install.scenarioId)) {
                        throw new Error('Scenario not found at source.');
                    }
                } catch (error) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message:
                            input.sourceMode === 'BRANCH'
                                ? 'Branch is invalid or does not contain the scenario.'
                                : 'Commit is invalid or does not contain the scenario.',
                    });
                }

                try {
                    const operation = await ctx.profiles.createOperation({
                        profileName: input.profileName,
                        type: 'RESET',
                        sourceMode: input.sourceMode,
                        sourceRef,
                        payload: { install: input.install } as GatewayPrisma.JsonObject,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                        scheduledAt: input.scheduledAt,
                    });
                    return operation;
                } catch (error) {
                    if (!isUniqueConstraintError(error)) {
                        throw error;
                    }
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'This profile already has a queued or running operation.',
                    });
                }
            }),
        requestDeploy: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    sourceMode: zSourceMode,
                    sourceRef: z.string().min(1).max(128),
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                assertPermission(adminAuth, ROLE_ADMIN_PROFILES, input.profileName);
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile not found.' });
                }
                let sourceRef = input.sourceRef.trim();
                try {
                    const resolved =
                        input.sourceMode === 'BRANCH'
                            ? await resolveGitBranchCommitSha(sourceRef)
                            : await resolveGitCommitSha(sourceRef);
                    if (input.sourceMode === 'COMMIT') {
                        sourceRef = resolved;
                    }
                    const scenarios = await listScenarioPreviews({ gitRef: resolved });
                    if (!scenarios.some((scenario) => String(scenario.id) === profile.scenario)) {
                        throw new Error('Current scenario is not available at source.');
                    }
                } catch {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Source is invalid or does not contain the current scenario.',
                    });
                }
                try {
                    return await ctx.profiles.createOperation({
                        profileName: input.profileName,
                        type: 'DEPLOY',
                        sourceMode: input.sourceMode,
                        sourceRef,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                    });
                } catch (error) {
                    if (!isUniqueConstraintError(error)) {
                        throw error;
                    }
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'This profile already has a queued or running operation.',
                    });
                }
            }),
        requestRuntime: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    action: z.enum(['START', 'STOP']),
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                assertPermission(adminAuth, ROLE_ADMIN_PROFILES, input.profileName);
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile not found.' });
                }
                try {
                    const operation = await ctx.profiles.createOperation({
                        profileName: input.profileName,
                        type: input.action,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                    });
                    return operation;
                } catch (error) {
                    if (!isUniqueConstraintError(error)) {
                        throw error;
                    }
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'This profile already has a queued or running operation.',
                    });
                }
            }),
        cancel: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
            const adminAuth = requireAdminAuth(ctx);
            const previous = await ctx.profiles.getOperation(input.id);
            if (!previous) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Operation not found.' });
            }
            assertPermission(adminAuth, ROLE_ADMIN_PROFILES, previous.profileName);
            const cancelled = await ctx.profiles.cancelOperation(input.id);
            if (!cancelled) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'Only queued operations can be cancelled.',
                });
            }
            return { ok: true };
        }),
        retry: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
            const adminAuth = requireAdminAuth(ctx);
            const previous = await ctx.profiles.getOperation(input.id);
            if (!previous) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Operation not found.' });
            }
            assertPermission(adminAuth, ROLE_ADMIN_PROFILES, previous.profileName);
            try {
                const operation = await ctx.profiles.retryOperation(input.id, adminAuth.user.id);
                if (!operation) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'Only failed or cancelled operations can be retried.',
                    });
                }
                return operation;
            } catch (error) {
                if (error instanceof TRPCError) {
                    throw error;
                }
                if (!isUniqueConstraintError(error)) {
                    throw error;
                }
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'This profile already has a queued or running operation.',
                });
            }
        }),
    }),
    releases: router({
        gatewayState: releaseAdminProcedure.query(({ ctx }) => ctx.releases.getState()),
        list: releaseAdminProcedure
            .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
            .query(({ ctx, input }) => ctx.releases.listOperations(input?.limit)),
        requestGatewayDeploy: releaseAdminProcedure
            .input(
                z.object({
                    sourceMode: zSourceMode,
                    sourceRef: z.string().min(1).max(128),
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                let sourceRef = input.sourceRef.trim();
                try {
                    const resolved =
                        input.sourceMode === 'BRANCH'
                            ? await resolveGitBranchCommitSha(sourceRef)
                            : await resolveGitCommitSha(sourceRef);
                    if (input.sourceMode === 'COMMIT') {
                        sourceRef = resolved;
                    }
                } catch {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Gateway release source is invalid.' });
                }
                try {
                    return await ctx.releases.createOperation({
                        type: 'DEPLOY',
                        sourceMode: input.sourceMode,
                        sourceRef,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                    });
                } catch (error) {
                    if (!isUniqueConstraintError(error)) {
                        throw error;
                    }
                    throw new TRPCError({ code: 'CONFLICT', message: 'A gateway release is already active.' });
                }
            }),
        requestGatewayRollback: releaseAdminProcedure
            .input(z.object({ reason: z.string().max(200).optional() }).optional())
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                const state = await ctx.releases.getState();
                if (!state.previousCommitSha || !state.previousWorkspace) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'No previous gateway release is available.' });
                }
                try {
                    return await ctx.releases.createOperation({
                        type: 'ROLLBACK',
                        sourceMode: 'COMMIT',
                        sourceRef: state.previousCommitSha,
                        payload: {
                            expectedWorkspace: state.previousWorkspace,
                            replacedCommitSha: state.activeCommitSha ?? null,
                        },
                        reason: input?.reason,
                        requestedBy: adminAuth.user.id,
                    });
                } catch (error) {
                    if (!isUniqueConstraintError(error)) {
                        throw error;
                    }
                    throw new TRPCError({ code: 'CONFLICT', message: 'A gateway release is already active.' });
                }
            }),
        cancel: releaseAdminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
            if (!(await ctx.releases.cancelOperation(input.id))) {
                throw new TRPCError({ code: 'CONFLICT', message: 'Only queued releases can be cancelled.' });
            }
            return { ok: true };
        }),
        retry: releaseAdminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
            const adminAuth = requireAdminAuth(ctx);
            try {
                const operation = await ctx.releases.retryOperation(input.id, adminAuth.user.id);
                if (!operation) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'Only failed or cancelled releases can be retried.',
                    });
                }
                return operation;
            } catch (error) {
                if (error instanceof TRPCError) {
                    throw error;
                }
                if (!isUniqueConstraintError(error)) {
                    throw error;
                }
                throw new TRPCError({ code: 'CONFLICT', message: 'A gateway release is already active.' });
            }
        }),
    }),
    profiles: router({
        list: adminProcedure.query(async ({ ctx }) => {
            const profiles = await ctx.profiles.listProfiles();
            const profileNames = profiles.map((profile) => profile.profileName);
            const [runtimeActions, activeOperations] = await Promise.all([
                ctx.prisma.gatewayRuntimeAction.findMany({
                    where: { profileName: { in: profileNames } },
                    orderBy: { createdAt: 'desc' },
                }),
                ctx.prisma.gatewayOperation.findMany({
                    where: {
                        profileName: { in: profileNames },
                        status: { in: ['QUEUED', 'RUNNING'] },
                    },
                    select: { id: true, profileName: true, status: true },
                }),
            ]);
            const activeOperationByProfile = new Map(
                activeOperations.map((operation) => [operation.profileName, operation])
            );
            const runtimeActionsByProfile = new Map<string, typeof runtimeActions>();
            for (const action of runtimeActions) {
                const bucket = runtimeActionsByProfile.get(action.profileName) ?? [];
                if (bucket.length < 10) {
                    bucket.push(action);
                    runtimeActionsByProfile.set(action.profileName, bucket);
                }
            }
            const runtimeStates = await ctx.orchestrator.listRuntimeStates(
                profiles.map((profile) => profile.profileName)
            );
            const runtimeMap = new Map(runtimeStates.map((state) => [state.profileName, state]));
            return profiles.map((profile) => ({
                ...profile,
                runtimeActions: runtimeActionsByProfile.get(profile.profileName) ?? [],
                activeOperation: activeOperationByProfile.get(profile.profileName) ?? null,
                runtime: runtimeMap.get(profile.profileName) ?? {
                    profileName: profile.profileName,
                    frontendRunning: false,
                    apiRunning: false,
                    daemonRunning: false,
                    auctionRunning: false,
                    battleSimRunning: false,
                    tournamentRunning: false,
                },
            }));
        }),
        listScenarios: profileAdminProcedure
            .input(
                z
                    .object({
                        gitRef: z.string().min(1).max(128).optional(),
                        sourceMode: zSourceMode.optional(),
                    })
                    .optional()
            )
            .query(async ({ input }) => {
                const gitRef = input?.gitRef?.trim();
                if (!gitRef) {
                    return listScenarioPreviews();
                }
                const resolved =
                    input?.sourceMode === 'BRANCH'
                        ? await resolveGitBranchCommitSha(gitRef)
                        : await resolveGitCommitSha(gitRef);
                return listScenarioPreviews({ gitRef: resolved });
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
                        nextSeasonIdx: z.number().int().min(0).nullable().optional(),
                        localAccountAccessGraceDays: z.number().int().min(0).max(365).nullable().optional(),
                        localAccountGeneralCreationGraceDays: z.number().int().min(0).max(365).nullable().optional(),
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
        install: profileAdminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    install: zInstallOptions,
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'Profile not found.',
                    });
                }

                const now = new Date();
                const openAt = input.install.openAt ? new Date(input.install.openAt) : null;
                const preopenAt = input.install.preopenAt ? new Date(input.install.preopenAt) : null;
                if (openAt && Number.isNaN(openAt.getTime())) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'openAt is invalid.',
                    });
                }
                if (preopenAt && Number.isNaN(preopenAt.getTime())) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'preopenAt is invalid.',
                    });
                }
                if (openAt && openAt.getTime() < now.getTime()) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'openAt must be in the future.',
                    });
                }
                if (preopenAt && !openAt) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'openAt is required when preopenAt is set.',
                    });
                }
                if (preopenAt && openAt && preopenAt.getTime() >= openAt.getTime()) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'preopenAt must be earlier than openAt.',
                    });
                }

                const autorunUser = input.install.autorunUser ?? null;
                if (autorunUser) {
                    if (autorunUser.limitMinutes <= 0 && autorunUser.options.length > 0) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'autorunUser limitMinutes must be positive when options are provided.',
                        });
                    }
                    if (autorunUser.limitMinutes > 0 && autorunUser.options.length === 0) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'autorunUser options must be provided when limitMinutes is set.',
                        });
                    }
                }

                const gitRef = input.install.gitRef?.trim();
                const requestedRef = gitRef || profile.buildCommitSha || 'HEAD';
                let resolvedCommitSha: string;
                try {
                    resolvedCommitSha = await resolveGitCommitSha(requestedRef);
                    const scenarios = await listScenarioPreviews({ gitRef: resolvedCommitSha });
                    if (!scenarios.some((scenario) => scenario.id === input.install.scenarioId)) {
                        throw new Error('Scenario not found at source.');
                    }
                } catch {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'git ref is invalid or does not contain the scenario.',
                    });
                }

                const scheduledAt = openAt ? (preopenAt ?? openAt).toISOString() : null;
                const action = scheduledAt ? 'RESET_SCHEDULED' : 'RESET_NOW';
                const actionRecord = {
                    action,
                    requestedAt: now.toISOString(),
                    scheduledAt,
                    reason: input.reason ?? null,
                    status: 'REQUESTED',
                    install: {
                        ...input.install,
                        openAt: input.install.openAt ?? null,
                        preopenAt: input.install.preopenAt ?? null,
                        gitRef: resolvedCommitSha,
                        autorunUser: autorunUser
                            ? {
                                  limitMinutes: autorunUser.limitMinutes,
                                  options: autorunUser.options,
                              }
                            : null,
                        adminUser: {
                            id: adminAuth.user.id,
                            username: adminAuth.user.username,
                            displayName: adminAuth.user.displayName,
                        },
                    },
                };
                try {
                    const operation = await ctx.profiles.createOperation({
                        profileName: input.profileName,
                        type: 'RESET',
                        sourceMode: 'COMMIT',
                        sourceRef: resolvedCommitSha,
                        payload: { install: actionRecord.install } as GatewayPrisma.JsonObject,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                        scheduledAt: scheduledAt ?? undefined,
                    });
                    return { ok: true, operationId: operation.id, action: actionRecord };
                } catch (error) {
                    if (!isUniqueConstraintError(error)) {
                        throw error;
                    }
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'This profile already has a queued or running operation.',
                    });
                }
            }),
        installNow: profileAdminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    install: zInstallOptions,
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'Profile not found.',
                    });
                }

                const requestedRef = input.install.gitRef?.trim() || profile.buildCommitSha || 'HEAD';
                let resolvedCommitSha: string;
                try {
                    resolvedCommitSha = await resolveGitCommitSha(requestedRef);
                    const scenarios = await listScenarioPreviews({ gitRef: resolvedCommitSha });
                    if (!scenarios.some((scenario) => scenario.id === input.install.scenarioId)) {
                        throw new Error('Scenario not found at source.');
                    }
                } catch {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'git ref is invalid or does not contain the scenario.',
                    });
                }

                try {
                    const operation = await ctx.profiles.createOperation({
                        profileName: input.profileName,
                        type: 'RESET',
                        sourceMode: 'COMMIT',
                        sourceRef: resolvedCommitSha,
                        payload: {
                            install: {
                                ...input.install,
                                gitRef: resolvedCommitSha,
                                adminUser: {
                                    id: adminAuth.user.id,
                                    username: adminAuth.user.username,
                                    displayName: adminAuth.user.displayName,
                                },
                            },
                        } as GatewayPrisma.JsonObject,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                    });
                    const deadline = Date.now() + 10 * 60_000;
                    while (Date.now() < deadline) {
                        await ctx.orchestrator.runOperationsNow();
                        const current = await ctx.profiles.getOperation(operation.id);
                        if (current?.status === 'SUCCEEDED') {
                            return { ok: true, operationId: operation.id };
                        }
                        if (current?.status === 'FAILED' || current?.status === 'CANCELLED') {
                            throw new TRPCError({
                                code: 'INTERNAL_SERVER_ERROR',
                                message: current.error ?? 'Profile install operation failed.',
                            });
                        }
                        await new Promise<void>((resolve) => setTimeout(resolve, 250));
                    }
                    throw new TRPCError({
                        code: 'TIMEOUT',
                        message: 'Profile install operation did not complete in time.',
                    });
                } catch (error) {
                    if (!isUniqueConstraintError(error)) {
                        throw error;
                    }
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'This profile already has a queued or running operation.',
                    });
                }
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
                if (input.action !== 'RESET_SCHEDULED' && input.scheduledAt) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'scheduledAt is supported only for scheduled reset.',
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
                    if (profile.status !== 'STOPPED' && profile.status !== 'PAUSED') {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Resume is allowed only for STOPPED or PAUSED profiles.',
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

                if (input.action === 'OPEN_SURVEY') {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '설문은 게임 내 설문 관리 화면에서 생성해 주세요.',
                    });
                }

                if (input.action === 'ACCELERATE' || input.action === 'DELAY') {
                    try {
                        const runtimeAction = await ctx.prisma.gatewayRuntimeAction.create({
                            data: {
                                profileName: input.profileName,
                                action: input.action,
                                durationMinutes: input.durationMinutes,
                                reason: input.reason,
                                requestedBy: adminAuth.user.id,
                            },
                        });
                        return { ok: true, action: runtimeAction };
                    } catch (error) {
                        if (!isUniqueConstraintError(error)) {
                            throw error;
                        }
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: '이 프로필의 이전 시간 조정 요청이 아직 처리 중입니다.',
                        });
                    }
                }

                const statusMap = {
                    RESUME: 'RUNNING',
                    PAUSE: 'PAUSED',
                    STOP: 'STOPPED',
                    SHUTDOWN: 'DISABLED',
                } as const;
                const mappedStatus = statusMap[input.action as keyof typeof statusMap];
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
                if (mappedStatus) {
                    await ctx.profiles.updateStatus(input.profileName, mappedStatus);
                    await ctx.orchestrator.reconcileNow();
                    const appliedActionRecord = {
                        ...actionRecord,
                        status: 'APPLIED',
                        handledAt: new Date().toISOString(),
                        handler: 'gateway-api',
                        detail: `profile status reconciled as ${mappedStatus}`,
                    };
                    await ctx.profiles.updateMeta(input.profileName, {
                        ...nextMeta,
                        adminActions: [...actionLog, appliedActionRecord],
                        adminActionsUpdatedAt: appliedActionRecord.handledAt,
                    });
                    return { ok: true, action: appliedActionRecord };
                }
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
