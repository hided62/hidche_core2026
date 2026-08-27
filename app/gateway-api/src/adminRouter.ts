import { randomBytes, randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { gatewayProfileCapabilities } from '@sammo-ts/common';
import type { GatewayPrisma } from '@sammo-ts/infra';

import { procedure, router } from './trpc.js';
import {
    listScenarioPreviews,
    resolveGitBranchCommitSha,
    resolveGitCommitSha,
    type ScenarioPreview,
} from './scenario/scenarioCatalog.js';
import type { UserSanctions, UserServerRestriction } from './auth/userRepository.js';
import { toPublicUser } from './auth/userRepository.js';
import type { AdminAuthContext } from './adminAuth.js';
import { buildAdminAuditTarget, newAdminAuditCorrelationId, sanitizeAdminAuditValue } from './adminAudit.js';
import {
    ADMIN_CAPABILITIES,
    getAdminCapability,
    isProfileCapabilityPermission,
    resolveAdminActionCapability,
} from './adminCapabilities.js';
import type { GatewayApiContext } from './context.js';
import { resolveLocalAccountProfilePolicy } from './auth/localAccountPolicy.js';
import { isGatewaySessionCurrent } from './auth/sessionValidity.js';
import {
    GATEWAY_BUILD_STATUSES,
    GATEWAY_PROFILE_STATUSES,
    GatewayProfileOperationConflictError,
} from './orchestrator/profileRepository.js';
import { readProfileReleaseSource } from './orchestrator/profileReleaseSource.js';
import {
    orderGatewayProfiles,
    resolveGatewayProfileDisplayName,
    resolveGatewayProfileKoreanName,
} from './profileOrder.js';
import { purifyGatewayNoticeHtml } from './security/gatewayNoticeHtml.js';
import { zDisplayName, zRegistrationUsername } from './auth/registrationInput.js';

const zProfileStatus = z.enum(GATEWAY_PROFILE_STATUSES);
const zBuildStatus = z.enum(GATEWAY_BUILD_STATUSES);
const zUserRoleMode = z.enum(['set', 'grant', 'revoke']);
const zSpecialAccountAccessKind = z.enum(['TESTER', 'RECOVERY', 'OTHER']);
const zSpecialAccessProfile = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+(?::[a-zA-Z0-9._-]+)?$/);
const zJoinMode = z.enum(['full', 'onlyRandom']);
const zServerAction = z.enum([
    'RESUME',
    'PAUSE',
    'STOP',
    'CLOSE_COMPLETED',
    'ACCELERATE',
    'DELAY',
    'UPDATE_RUNTIME_SETTINGS',
    'RESET_NOW',
    'RESET_SCHEDULED',
    'OPEN_SURVEY',
    'SHUTDOWN',
]);

const AUTORUN_USER_OPTIONS = ['develop', 'warp', 'recruit', 'recruit_high', 'train', 'battle', 'chief'] as const;

const ADMIN_ROLE_PREFIX = 'admin.';
const ADMIN_ROLE_SUPERUSER = 'admin.superuser';
const ROLE_SUPERUSER = 'superuser';
const ROLE_ADMIN_USERS = 'admin.users.manage';
const ROLE_ADMIN_USERS_CREATE = 'admin.users.create';
const ROLE_ADMIN_PROFILE_RUNTIME = 'admin.profiles.runtime';
const ROLE_ADMIN_PROFILE_SETTINGS = 'admin.profiles.settings';
const ROLE_ADMIN_PROFILE_DEPLOY = 'admin.profiles.deploy';
const ROLE_ADMIN_SCENARIO_RESET = 'admin.scenarios.reset';
const ROLE_ADMIN_GAME_CANCEL = 'admin.games.cancel';
const ROLE_ADMIN_RELEASES = 'admin.releases.manage';
const ROLE_ADMIN_NOTICE = 'admin.notice.manage';
const ROLE_ADMIN_AUDIT = 'admin.audit.read';
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
    if (!user || !isGatewaySessionCurrent(session, user)) {
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
        const parsed = splitRoleScope(role);
        if (parsed.permission.startsWith(ADMIN_ROLE_PREFIX) && parsed.permission !== ADMIN_ROLE_SUPERUSER) {
            const capability = getAdminCapability(parsed.permission);
            if (!capability) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown administrator capability: ${role}` });
            }
            if (capability.scope === 'GLOBAL' && parsed.scope !== undefined) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `Capability does not accept a scope: ${role}` });
            }
            if (capability.scope === 'PROFILE' && parsed.scope === '') {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `Profile scope is empty: ${role}` });
            }
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

const assertAllPermissions = (
    adminAuth: AdminAuthContext,
    permissions: readonly string[],
    profileName?: string
): void => {
    for (const permission of permissions) {
        assertPermission(adminAuth, permission, profileName);
    }
};

const assertTargetUserManageable = (adminAuth: AdminAuthContext, target: { id: string; roles: string[] }): void => {
    if (!adminAuth.isSuperuser && target.roles.some(isRootAdminRole)) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only a superuser can change a root administrator account.',
        });
    }
};

const assertNotSelfDestructiveAction = (adminAuth: AdminAuthContext, targetUserId: string): void => {
    if (adminAuth.user.id === targetUserId) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Use account self-service instead of an administrator destructive action on yourself.',
        });
    }
};

const canCreateLocalUser = (adminAuth: AdminAuthContext): boolean =>
    hasScopedPermission(adminAuth, ROLE_ADMIN_USERS_CREATE) || hasScopedPermission(adminAuth, ROLE_ADMIN_USERS);

const canReadProfile = (adminAuth: AdminAuthContext, profileName: string): boolean => {
    if (adminAuth.isSuperuser) return true;
    return adminAuth.roles.some((role) => {
        const parsed = splitRoleScope(role);
        if (!isProfileCapabilityPermission(parsed.permission)) return false;
        return parsed.scope === undefined || parsed.scope === '*' || parsed.scope === profileName;
    });
};

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

const authenticatedAdminProcedure = procedure.use(async ({ ctx, next }) => {
    const adminAuth = await resolveAdminAuth(ctx as GatewayApiContext);
    return next({
        ctx: {
            ...ctx,
            adminAuth,
        },
    });
});

const adminProcedure = authenticatedAdminProcedure.use(async ({ ctx, type, path, getRawInput, next }) => {
    if (type !== 'mutation') {
        return next();
    }
    const adminAuth = requireAdminAuth(ctx);
    const rawInput = await getRawInput().catch(() => undefined);
    const target = buildAdminAuditTarget(rawInput);
    const correlationId = newAdminAuditCorrelationId();
    const action = path.startsWith('admin.') ? path : `admin.${path}`;
    const capability = resolveAdminActionCapability(action, rawInput);
    const baseEvent = {
        correlationId,
        actorUserId: adminAuth.user.id,
        actorUsername: adminAuth.user.username,
        ...(capability ? { capability } : {}),
        action,
        ...target,
    };
    // STARTED 기록 실패 시 mutation을 시작하지 않는 fail-closed 경계입니다.
    await (ctx as GatewayApiContext).adminAudit.append({ ...baseEvent, outcome: 'STARTED' });
    try {
        const result = await next();
        if (!result.ok) {
            await (ctx as GatewayApiContext).adminAudit
                .append({
                    ...baseEvent,
                    outcome: 'FAILED',
                    errorCode: result.error.code,
                    errorMessage: result.error.message.slice(0, 1000),
                })
                .catch(() => undefined);
            return result;
        }
        // 업무 mutation은 이미 끝났으므로 terminal 기록 장애가 재시도/중복 mutation을
        // 유발하지 않게 STARTED row를 남긴 채 원래 결과를 반환합니다.
        await (ctx as GatewayApiContext).adminAudit
            .append({
                ...baseEvent,
                outcome: 'SUCCEEDED',
                summary: {
                    request: target.summary,
                    result: sanitizeAdminAuditValue(result.data),
                },
            })
            .catch(() => undefined);
        return result;
    } catch (error) {
        await (ctx as GatewayApiContext).adminAudit
            .append({
                ...baseEvent,
                outcome: 'FAILED',
                errorCode: error instanceof TRPCError ? error.code : 'INTERNAL_SERVER_ERROR',
                errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown administrator error',
            })
            .catch(() => undefined);
        throw error;
    }
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

const releaseAdminProcedure = adminProcedure.use(({ ctx, next }) => {
    const adminAuth = requireAdminAuth(ctx);
    assertPermission(adminAuth, ROLE_ADMIN_RELEASES);
    return next();
});

const auditAdminProcedure = adminProcedure.use(({ ctx, next }) => {
    const adminAuth = requireAdminAuth(ctx);
    assertPermission(adminAuth, ROLE_ADMIN_AUDIT);
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

const zUserListInput = z
    .object({
        query: z.string().trim().max(100).optional(),
        limit: z.number().int().min(1).max(100).default(30),
        cursor: z.string().uuid().optional(),
    })
    .optional();

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

// Ref aligns a 12-month game year inside a 24-hour wall-clock day. That makes
// every positive divisor of 120 valid, including 3 and 8 minutes.
const isAllowedTurnTerm = (value: number): boolean => Number.isInteger(value) && value > 0 && 120 % value === 0;

const zRuntimeSettings = z
    .object({
        turnTermMinutes: z
            .number()
            .int()
            .refine((value) => isAllowedTurnTerm(value), {
                message: '턴 시간은 120의 약수여야 합니다.',
            })
            .optional(),
        blockGeneralCreate: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
        autorunUser: z
            .object({
                limitMinutes: z.number().int().min(1).max(43200),
                options: z.array(z.enum(AUTORUN_USER_OPTIONS)).min(1),
            })
            .nullable()
            .optional(),
    })
    .strict()
    .refine((settings) => Object.values(settings).some((value) => value !== undefined), {
        message: 'At least one runtime setting is required.',
    });

const isUniqueConstraintError = (error: unknown): boolean =>
    Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');

const isProfileOperationConflictError = (error: unknown): boolean =>
    error instanceof GatewayProfileOperationConflictError || isUniqueConstraintError(error);

const zInstallOptions = z.object({
    scenarioId: z.number().int().min(0),
    turnTermMinutes: z
        .number()
        .int()
        .refine((value) => isAllowedTurnTerm(value), {
            message: '턴 시간은 120의 약수여야 합니다.',
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
const zProfileResetDefaults = zInstallOptions.omit({
    scenarioId: true,
    openAt: true,
    preopenAt: true,
    gitRef: true,
});
const SYSTEM_PROFILE_RESET_DEFAULTS: z.infer<typeof zProfileResetDefaults> = {
    turnTermMinutes: 60,
    sync: true,
    fiction: 1,
    extend: true,
    blockGeneralCreate: 0,
    npcMode: 0,
    showImgLevel: 3,
    tournamentTrig: true,
    joinMode: 'full',
    autorunUser: null,
};

const buildResetOtherTextInfo = (install: z.infer<typeof zOperationInstallOptions>): string => {
    const settings: string[] = [];
    if (!install.sync) settings.push('시간동기화 없음');
    if (!install.extend) settings.push('확장 NPC 미포함');
    if (install.blockGeneralCreate === 1) settings.push('장수 생성 불가');
    if (install.blockGeneralCreate === 2) settings.push('장수명 무작위');
    if (install.joinMode === 'onlyRandom') settings.push('랜덤 임관');
    if (install.showImgLevel !== SYSTEM_PROFILE_RESET_DEFAULTS.showImgLevel) {
        settings.push(['이미지 표시 안함', '전콘 표시', '전콘/병종 표시'][install.showImgLevel] ?? '이미지 표시');
    }
    if (!install.tournamentTrig) settings.push('토너먼트 수동 시작');
    return settings.join(', ');
};
const zSourceMode = z.enum(['BRANCH', 'COMMIT']);
const zResetSourceMode = z.enum(['CURRENT', 'BRANCH', 'COMMIT']);

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

const readProfileResetDefaults = (
    meta: Record<string, unknown>
): { defaults: z.infer<typeof zProfileResetDefaults>; source: 'SYSTEM' | 'PROFILE' } => {
    const parsed = zProfileResetDefaults.partial().safeParse(meta.resetDefaults);
    if (meta.resetDefaults === undefined || !parsed.success) {
        return { defaults: { ...SYSTEM_PROFILE_RESET_DEFAULTS }, source: 'SYSTEM' };
    }
    return { defaults: { ...SYSTEM_PROFILE_RESET_DEFAULTS, ...parsed.data }, source: 'PROFILE' };
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
    capabilities: router({
        list: adminProcedure.query(({ ctx }) => {
            const adminAuth = requireAdminAuth(ctx);
            return ADMIN_CAPABILITIES.filter(
                (entry) =>
                    adminAuth.isSuperuser ||
                    adminAuth.roles.some((role) => {
                        const parsed = splitRoleScope(role);
                        return parsed.permission === entry.permission;
                    })
            ).map((entry) => {
                if (adminAuth.isSuperuser) return { ...entry, scopes: ['*'] };
                const scopes = adminAuth.roles
                    .map(splitRoleScope)
                    .filter((role) => role.permission === entry.permission)
                    .map((role) => role.scope ?? '*');
                return { ...entry, scopes: Array.from(new Set(scopes)) };
            });
        }),
    }),
    audit: router({
        list: auditAdminProcedure
            .input(
                z
                    .object({
                        actorUserId: z.string().min(1).optional(),
                        targetType: z.string().min(1).max(64).optional(),
                        targetId: z.string().min(1).optional(),
                        profileName: z.string().min(1).max(64).optional(),
                        limit: z.number().int().min(1).max(200).optional(),
                    })
                    .optional()
            )
            .query(async ({ ctx, input }) => {
                const gatewayCtx = ctx as GatewayApiContext;
                const [events, profiles] = await Promise.all([
                    gatewayCtx.adminAudit.list(input),
                    gatewayCtx.profiles.listProfiles(),
                ]);
                const displayNames = new Map(
                    profiles.map((profile) => [
                        profile.profileName,
                        resolveGatewayProfileDisplayName(profile.profile, profile.instanceKey, profile.meta.korName),
                    ])
                );
                return events.map((event) => ({
                    ...event,
                    ...(event.profileName && displayNames.has(event.profileName)
                        ? { profileDisplayName: displayNames.get(event.profileName) }
                        : {}),
                }));
            }),
    }),
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
        list: userAdminProcedure.input(zUserListInput).query(({ ctx, input }) =>
            ctx.users.listForAdmin({
                query: input?.query,
                limit: input?.limit ?? 30,
                cursor: input?.cursor,
            })
        ),
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
                identityRevision: user.identityRevision,
                kakaoReplacementApprovedUntil: user.kakaoReplacementApprovedUntil,
                kakaoVerifiedAt: user.kakaoVerifiedAt,
                kakaoGraceStartedAt: user.kakaoGraceStartedAt,
                kakaoGraceUntil: user.kakaoGraceUntil,
                profileIconResetAt: user.profileIconResetAt,
                deleteAfter: user.deleteAfter,
                createdAt: user.createdAt,
            };
        }),
        getKakaoGracePolicies: userAdminProcedure
            .input(z.object({ userId: z.string().min(1) }))
            .query(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                const profiles = orderGatewayProfiles(await ctx.profiles.listProfiles());
                const specialAccessGrants = await ctx.users.listSpecialAccessGrants(user.id);
                return {
                    kakaoVerified: user.oauthType === 'KAKAO' && Boolean(user.kakaoVerifiedAt),
                    kakaoGraceStartedAt: user.kakaoGraceStartedAt,
                    kakaoGraceUntil: user.kakaoGraceUntil ?? null,
                    specialAccessGrants,
                    profiles: profiles.map((profile) => ({
                        profileName: profile.profileName,
                        profile: profile.profile,
                        instanceKey: profile.instanceKey,
                        displayName: resolveGatewayProfileDisplayName(
                            profile.profile,
                            profile.instanceKey,
                            profile.meta.korName
                        ),
                        ...resolveLocalAccountProfilePolicy({
                            profile: profile.profile,
                            profileName: profile.profileName,
                            profileMeta: readMetaObject(profile.meta),
                            defaultGraceDays: (ctx as GatewayApiContext).localAccountGraceDays,
                            user,
                            specialAccessGrants,
                        }),
                    })),
                };
            }),
        grantSpecialAccess: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    kind: zSpecialAccountAccessKind,
                    profiles: z.array(zSpecialAccessProfile).max(20).default([]),
                    allowsGeneralCreation: z.boolean().default(true),
                    expiresAt: z.string().datetime().nullable(),
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                const adminAuth = requireAdminAuth(ctx);
                assertTargetUserManageable(adminAuth, user);
                const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
                const now = new Date();
                if (expiresAt && expiresAt.getTime() <= now.getTime()) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Special access must end in the future.' });
                }
                if (input.kind === 'RECOVERY') {
                    if (!expiresAt) {
                        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Recovery access must expire.' });
                    }
                    if (expiresAt.getTime() > now.getTime() + 90 * 24 * 60 * 60 * 1000) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Recovery access may last at most 90 days.',
                        });
                    }
                }
                const profiles = [...new Set(input.profiles.map((profile) => profile.toLowerCase()))];
                if (profiles.length > 0) {
                    const knownProfiles = await ctx.profiles.listProfiles();
                    const knownNames = new Set(
                        knownProfiles.flatMap((profile) => [
                            profile.profile.toLowerCase(),
                            profile.profileName.toLowerCase(),
                        ])
                    );
                    const unknown = profiles.find((profile) => !knownNames.has(profile));
                    if (unknown) {
                        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown profile scope: ${unknown}` });
                    }
                }
                const grant = await ctx.users.createSpecialAccessGrant(input.userId, {
                    kind: input.kind,
                    profiles,
                    allowsGeneralCreation: input.allowsGeneralCreation,
                    expiresAt,
                    reason: input.reason,
                    grantedByUserId: adminAuth.user.id,
                });
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-special-access-granted');
                return grant;
            }),
        revokeSpecialAccess: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    grantId: z.string().uuid(),
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                const adminAuth = requireAdminAuth(ctx);
                assertTargetUserManageable(adminAuth, user);
                const grant = await ctx.users.revokeSpecialAccessGrant(input.userId, input.grantId, {
                    revokedAt: new Date(),
                    revokedByUserId: adminAuth.user.id,
                    reason: input.reason,
                });
                if (!grant) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Active special access grant not found.' });
                }
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-special-access-revoked');
                return grant;
            }),
        updateKakaoGrace: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    until: z.string().datetime().nullable(),
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                const adminAuth = requireAdminAuth(ctx);
                assertTargetUserManageable(adminAuth, user);
                const until = input.until ? new Date(input.until) : null;
                if (until && user.oauthType === 'KAKAO' && user.kakaoVerifiedAt) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'A verified Kakao account does not need a grace override.',
                    });
                }
                if (until && until.getTime() <= Date.now()) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Grace extension must end in the future.' });
                }
                await ctx.users.updateKakaoGraceUntil(input.userId, until);
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-kakao-grace-updated');
                return { kakaoGraceUntil: until?.toISOString() ?? null };
            }),
        setKakaoReplacementApproval: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    until: z.string().datetime().nullable(),
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                const adminAuth = requireAdminAuth(ctx);
                assertTargetUserManageable(adminAuth, user);
                const until = input.until ? new Date(input.until) : null;
                const now = new Date();
                if (until) {
                    if (user.oauthType !== 'KAKAO' || !user.oauthId) {
                        throw new TRPCError({
                            code: 'PRECONDITION_FAILED',
                            message: '현재 카카오 계정이 연결된 사용자만 교체를 승인할 수 있습니다.',
                        });
                    }
                    if (until <= now || until.getTime() > now.getTime() + 7 * 24 * 60 * 60 * 1000) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: '교체 승인 만료는 현재부터 7일 이내여야 합니다.',
                        });
                    }
                }
                const updated = await ctx.users.setKakaoReplacementApproval(input.userId, {
                    until,
                    approvedByUserId: adminAuth.user.id,
                    reason: input.reason,
                });
                return { kakaoReplacementApprovedUntil: updated.kakaoReplacementApprovedUntil ?? null };
            }),
        updateIdentity: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    username: zRegistrationUsername,
                    displayName: zDisplayName,
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                assertTargetUserManageable(requireAdminAuth(ctx), user);
                let updated;
                try {
                    updated = await ctx.users.updateIdentity(input.userId, {
                        username: input.username,
                        displayName: input.displayName,
                        changedAt: new Date(),
                    });
                } catch (error) {
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '이미 사용 중인 ID 또는 닉네임입니다.',
                        cause: error,
                    });
                }
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-account-identity-updated', {
                    displayName: updated.displayName,
                    identityRevision: updated.identityRevision,
                });
                return {
                    username: updated.username,
                    displayName: updated.displayName,
                    identityRevision: updated.identityRevision,
                };
            }),
        listHistory: userAdminProcedure
            .input(z.object({ userId: z.string().min(1), limit: z.number().int().min(1).max(200).optional() }))
            .query(({ ctx, input }) =>
                (ctx as GatewayApiContext).adminAudit.list({
                    targetType: 'USER',
                    targetId: input.userId,
                    limit: input.limit,
                })
            ),
        resetPassword: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    newPassword: z.string().min(6).max(128).optional(),
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                assertTargetUserManageable(requireAdminAuth(ctx), user);
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
                    reason: z.string().trim().min(3).max(200),
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
                assertTargetUserManageable(adminAuth, user);
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
                    reason: z.string().trim().min(3).max(200),
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
                assertTargetUserManageable(requireAdminAuth(ctx), user);
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
                    reason: z.string().trim().min(3).max(200),
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
                assertTargetUserManageable(requireAdminAuth(ctx), user);
                const next = applySanctionsPatch(user.sanctions, patch);
                await ctx.users.updateSanctions(input.userId, next);
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-server-restriction');
                return { sanctions: next };
            }),
        resetProfileIcon: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    reason: z.string().trim().min(3).max(200),
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
                assertTargetUserManageable(requireAdminAuth(ctx), user);
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
        scheduleDeletion: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    retentionDays: z.number().int().min(1).max(90).default(30),
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                const adminAuth = requireAdminAuth(ctx);
                assertTargetUserManageable(adminAuth, user);
                assertNotSelfDestructiveAction(adminAuth, input.userId);
                const deleteAfter = new Date(Date.now() + input.retentionDays * 24 * 60 * 60 * 1000);
                await ctx.users.scheduleDeletion(input.userId, deleteAfter);
                await ctx.flushPublisher.publishUserFlush(input.userId, 'admin-scheduled-withdrawal');
                return { ok: true, deleteAfter: deleteAfter.toISOString() };
            }),
        forceDelete: userAdminProcedure
            .input(
                z.object({
                    userId: z.string().min(1),
                    confirmUsername: z.string().min(1),
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                if (!adminAuth.isSuperuser) {
                    throw new TRPCError({ code: 'FORBIDDEN', message: 'Superuser permission is required.' });
                }
                assertNotSelfDestructiveAction(adminAuth, input.userId);
                const user = await ctx.users.findById(input.userId);
                if (!user) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
                }
                if (input.confirmUsername !== user.username) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Username confirmation does not match.' });
                }
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
                    if (!canReadProfile(adminAuth, input.profileName)) {
                        throw new TRPCError({ code: 'FORBIDDEN', message: 'Permission denied.' });
                    }
                    return ctx.profiles.listOperations({
                        profileName: input.profileName,
                        limit: input.limit,
                    });
                }
                if (adminAuth.isSuperuser || adminAuth.roles.some((role) => role.endsWith(':*'))) {
                    return ctx.profiles.listOperations({ limit: input?.limit });
                }
                const profiles = await ctx.profiles.listProfiles();
                const allowed = profiles.filter((profile) => canReadProfile(adminAuth, profile.profileName));
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
        logs: adminProcedure
            .input(
                z.object({
                    id: z.string().uuid(),
                    afterCursor: z.string().regex(/^\d+$/u).optional(),
                    limit: z.number().int().min(1).max(500).default(200),
                    timeoutMs: z.number().int().min(0).max(25_000).default(20_000),
                })
            )
            .query(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                const initialOperation = await ctx.profiles.getOperation(input.id);
                if (!initialOperation) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile operation not found.' });
                }
                if (!canReadProfile(adminAuth, initialOperation.profileName)) {
                    throw new TRPCError({ code: 'FORBIDDEN', message: 'Permission denied.' });
                }
                const deadline = Date.now() + input.timeoutMs;
                while (true) {
                    const [operation, entries] = await Promise.all([
                        ctx.profiles.getOperation(input.id),
                        ctx.profiles.listOperationLogs(input.id, input.afterCursor, input.limit),
                    ]);
                    if (!operation) {
                        throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile operation not found.' });
                    }
                    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(operation.status);
                    if (entries.length || terminal || Date.now() >= deadline) {
                        return {
                            operation,
                            entries,
                            nextCursor: entries.at(-1)?.cursor ?? input.afterCursor,
                        };
                    }
                    await new Promise<void>((resolve) => setTimeout(resolve, 250));
                }
            }),
        requestReset: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    sourceMode: zResetSourceMode,
                    sourceRef: z.string().min(1).max(128).optional(),
                    install: zOperationInstallOptions,
                    scheduledAt: z.string().datetime().optional(),
                    publishSchedule: z.boolean().optional().default(false),
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                assertPermission(adminAuth, ROLE_ADMIN_SCENARIO_RESET, input.profileName);
                if (input.sourceMode !== 'CURRENT') {
                    assertPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY, input.profileName);
                }
                if (input.scheduledAt) {
                    assertPermission(adminAuth, ROLE_RESET_SCHEDULE, input.profileName);
                }
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
                if (
                    input.publishSchedule &&
                    (!input.scheduledAt || !input.install.preopenAt || !input.install.openAt)
                ) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '로비 일정 공개에는 초기화 시작, 가오픈 시작과 정식 오픈이 모두 필요합니다.',
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

                const configuredSource = input.sourceMode === 'CURRENT' ? readProfileReleaseSource(profile) : null;
                const sourceMode: 'BRANCH' | 'COMMIT' =
                    input.sourceMode === 'CURRENT' ? (configuredSource?.mode ?? 'COMMIT') : input.sourceMode;
                let sourceRef = configuredSource?.ref ?? input.sourceRef?.trim();
                if (!sourceRef) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message:
                            input.sourceMode === 'CURRENT'
                                ? 'The profile has no active build commit to reset from.'
                                : 'sourceRef is required.',
                    });
                }
                let selectedScenario: ScenarioPreview | undefined;
                try {
                    const resolved =
                        sourceMode === 'BRANCH'
                            ? await resolveGitBranchCommitSha(sourceRef)
                            : await resolveGitCommitSha(sourceRef);
                    if (sourceMode === 'COMMIT') {
                        sourceRef = resolved;
                    }
                    const scenarios = await listScenarioPreviews({ gitRef: resolved });
                    selectedScenario = scenarios.find((scenario) => scenario.id === input.install.scenarioId);
                    if (!selectedScenario) {
                        throw new Error('Scenario not found at source.');
                    }
                } catch (error) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message:
                            sourceMode === 'BRANCH'
                                ? 'Branch is invalid or does not contain the scenario.'
                                : 'Commit is invalid or does not contain the scenario.',
                    });
                }

                try {
                    const operation = await ctx.profiles.createOperation({
                        profileName: input.profileName,
                        type: 'RESET',
                        sourceMode,
                        sourceRef,
                        payload: {
                            install: input.install,
                            requestedSource: input.sourceMode,
                            releaseSource: { mode: sourceMode, ref: sourceRef },
                            ...(selectedScenario && input.install.preopenAt && input.install.openAt
                                ? {
                                      publicAnnouncement: {
                                          enabled: input.publishSchedule,
                                          scenarioId: selectedScenario.id,
                                          scenarioTitle: selectedScenario.title,
                                          scheduledAt: input.scheduledAt ?? null,
                                          preopenAt: input.install.preopenAt,
                                          openAt: input.install.openAt,
                                          turnTermMinutes: input.install.turnTermMinutes,
                                          fictionMode: input.install.fiction === 1 ? '가상' : '사실',
                                          npcMode: input.install.npcMode,
                                          defaultStatTotal: selectedScenario.defaultStatTotal,
                                          otherTextInfo: buildResetOtherTextInfo(input.install),
                                          autorunUser: input.install.autorunUser ?? null,
                                      },
                                  }
                                : {}),
                        } as GatewayPrisma.JsonObject,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                        scheduledAt: input.scheduledAt,
                    });
                    return operation;
                } catch (error) {
                    if (!isProfileOperationConflictError(error)) {
                        throw error;
                    }
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'This profile already has a queued or running operation.',
                    });
                }
            }),
        requestGameCancellation: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    historyMode: z.enum(['RETAIN_ABANDONED', 'DELETE']),
                    generalMode: z.enum(['RETAIN', 'DELETE']),
                    earnedPointRetentionPercent: z.number().int().min(0).max(100),
                    reason: z.string().trim().min(5).max(500),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                assertPermission(adminAuth, ROLE_ADMIN_GAME_CANCEL, input.profileName);
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile not found.' });
                }
                if (!['PREOPEN', 'RUNNING', 'PAUSED'].includes(profile.status)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Only a PREOPEN, RUNNING, or PAUSED game can be cancelled.',
                    });
                }
                const releaseState = await ctx.releases.getState();
                const sourceRef = releaseState.activeCommitSha?.trim();
                if (!sourceRef) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'The Gateway has no active release commit for the cancellation migration boundary.',
                    });
                }
                try {
                    const resolvedCommitSha = await resolveGitCommitSha(sourceRef);
                    return await ctx.profiles.createOperation({
                        profileName: input.profileName,
                        type: 'CANCEL_GAME',
                        sourceMode: 'COMMIT',
                        sourceRef: resolvedCommitSha,
                        payload: {
                            historyMode: input.historyMode,
                            generalMode: input.generalMode,
                            earnedPointRetentionPercent: input.earnedPointRetentionPercent,
                        } as GatewayPrisma.JsonObject,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                    });
                } catch (error) {
                    if (!isProfileOperationConflictError(error)) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'The active Gateway release commit cannot be resolved for game cancellation.',
                        });
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
                assertPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY, input.profileName);
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
                    if (
                        profile.currentScenario === null ||
                        !scenarios.some((scenario) => String(scenario.id) === profile.currentScenario)
                    ) {
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
                        payload: { releaseSource: { mode: input.sourceMode, ref: sourceRef } },
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                    });
                } catch (error) {
                    if (!isProfileOperationConflictError(error)) {
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
                assertPermission(adminAuth, ROLE_ADMIN_PROFILE_RUNTIME, input.profileName);
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile not found.' });
                }
                if (input.action === 'START' && !gatewayProfileCapabilities(profile.status).operatorResumable) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'This profile must be reset before it can be started.',
                    });
                }
                if (input.action === 'STOP' && !gatewayProfileCapabilities(profile.status).runtimeExpected) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Only a running profile can be stopped.',
                    });
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
                    if (!isProfileOperationConflictError(error)) {
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
            const permission =
                previous.type === 'RESET'
                    ? ROLE_ADMIN_SCENARIO_RESET
                    : previous.type === 'CANCEL_GAME'
                      ? ROLE_ADMIN_GAME_CANCEL
                      : previous.type === 'DEPLOY'
                        ? ROLE_ADMIN_PROFILE_DEPLOY
                        : ROLE_ADMIN_PROFILE_RUNTIME;
            assertPermission(adminAuth, permission, previous.profileName);
            const cancelled = await ctx.profiles.cancelOperation(input.id);
            if (!cancelled) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'Only queued operations or a DEPLOY that is still building can be cancelled.',
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
            const permission =
                previous.type === 'RESET'
                    ? ROLE_ADMIN_SCENARIO_RESET
                    : previous.type === 'CANCEL_GAME'
                      ? ROLE_ADMIN_GAME_CANCEL
                      : previous.type === 'DEPLOY'
                        ? ROLE_ADMIN_PROFILE_DEPLOY
                        : ROLE_ADMIN_PROFILE_RUNTIME;
            assertPermission(adminAuth, permission, previous.profileName);
            if (previous.type === 'RESET') {
                const payload = readMetaObject(previous.payload);
                if (payload.requestedSource !== 'CURRENT') {
                    assertPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY, previous.profileName);
                }
                if (previous.scheduledAt) {
                    assertPermission(adminAuth, ROLE_RESET_SCHEDULE, previous.profileName);
                }
            }
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
                if (!isProfileOperationConflictError(error)) {
                    throw error;
                }
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'This profile already has a queued or running operation.',
                });
            }
        }),
    }),
    bulkReleases: router({
        targets: adminProcedure.query(async ({ ctx }) => {
            const adminAuth = requireAdminAuth(ctx);
            const profiles = orderGatewayProfiles(await ctx.profiles.listProfiles()).filter((profile) =>
                hasScopedPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY, profile.profileName)
            );
            const activeOperations = await ctx.profiles.listOperations({
                statuses: ['QUEUED', 'RUNNING'],
                limit: 200,
            });
            const now = Date.now();
            const futureResetByProfile = new Map(
                activeOperations
                    .filter(
                        (operation) =>
                            operation.type === 'RESET' &&
                            operation.status === 'QUEUED' &&
                            Boolean(operation.scheduledAt) &&
                            new Date(operation.scheduledAt ?? '').getTime() > now
                    )
                    .map((operation) => [operation.profileName, operation])
            );
            const activeByProfile = new Map(
                activeOperations
                    .filter((operation) => operation.id !== futureResetByProfile.get(operation.profileName)?.id)
                    .map((operation) => [operation.profileName, operation])
            );
            return {
                gateway: hasScopedPermission(adminAuth, ROLE_ADMIN_RELEASES),
                profiles: profiles.map((profile) => ({
                    profileName: profile.profileName,
                    displayName: resolveGatewayProfileDisplayName(
                        profile.profile,
                        profile.instanceKey,
                        profile.meta.korName
                    ),
                    status: profile.status,
                    currentScenario: profile.currentScenario,
                    buildCommitSha: profile.buildCommitSha,
                    activeOperation: activeByProfile.get(profile.profileName) ?? null,
                    scheduledResetAt: futureResetByProfile.get(profile.profileName)?.scheduledAt,
                })),
            };
        }),
        list: adminProcedure
            .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
            .query(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                const profileRecords = await ctx.profiles.listProfiles();
                const profileLabels = new Map(
                    profileRecords.map((profile) => [
                        profile.profileName,
                        resolveGatewayProfileDisplayName(profile.profile, profile.instanceKey, profile.meta.korName),
                    ])
                );
                const batches = await ctx.prisma.gatewayBulkRelease.findMany({
                    orderBy: { createdAt: 'desc' },
                    take: input?.limit ?? 20,
                    include: {
                        gatewayOperations: true,
                        profileOperations: true,
                    },
                });
                return batches.flatMap((batch) => {
                    const targets = [
                        ...batch.gatewayOperations
                            .filter(() => hasScopedPermission(adminAuth, ROLE_ADMIN_RELEASES))
                            .map((operation) => ({
                                kind: 'GATEWAY' as const,
                                order: operation.bulkOrder ?? 0,
                                label: 'Gateway',
                                operationId: operation.id,
                                status: operation.status,
                                error: operation.error ?? undefined,
                                startedAt: operation.startedAt?.toISOString(),
                                completedAt: operation.completedAt?.toISOString(),
                            })),
                        ...batch.profileOperations
                            .filter((operation) =>
                                hasScopedPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY, operation.profileName)
                            )
                            .map((operation) => ({
                                kind: 'PROFILE' as const,
                                order: operation.bulkOrder ?? 0,
                                profileName: operation.profileName,
                                label: profileLabels.get(operation.profileName) ?? '삭제되었거나 접근할 수 없는 서버',
                                operationId: operation.id,
                                status: operation.status,
                                error: operation.error ?? undefined,
                                startedAt: operation.startedAt?.toISOString(),
                                completedAt: operation.completedAt?.toISOString(),
                            })),
                    ].sort((left, right) => left.order - right.order);
                    if (!targets.length) return [];
                    const statuses = targets.map((target) => target.status);
                    const status = statuses.every((value) => value === 'SUCCEEDED')
                        ? 'SUCCEEDED'
                        : statuses.some((value) => value === 'FAILED')
                          ? 'FAILED'
                          : statuses.some((value) => value === 'CANCELLED')
                            ? 'CANCELLED'
                            : statuses.some((value) => value === 'RUNNING')
                              ? 'RUNNING'
                              : 'QUEUED';
                    return [
                        {
                            id: batch.id,
                            sourceMode: batch.sourceMode,
                            sourceRef: batch.sourceRef,
                            resolvedCommitSha: batch.resolvedCommitSha,
                            reason: batch.reason ?? undefined,
                            requestedBy: batch.requestedBy,
                            createdAt: batch.createdAt.toISOString(),
                            status,
                            targets,
                        },
                    ];
                });
            }),
        request: adminProcedure
            .input(
                z
                    .object({
                        includeGateway: z.boolean(),
                        profileNames: z.array(z.string().min(1).max(64)).max(50),
                        sourceMode: zSourceMode,
                        sourceRef: z.string().trim().min(1).max(128),
                        reason: z.string().trim().max(200).optional(),
                    })
                    .refine((input) => input.includeGateway || input.profileNames.length > 0, {
                        message: 'At least one update target is required.',
                    })
                    .refine((input) => new Set(input.profileNames).size === input.profileNames.length, {
                        message: 'Duplicate profile targets are not allowed.',
                    })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                if (input.includeGateway) assertPermission(adminAuth, ROLE_ADMIN_RELEASES);
                input.profileNames.forEach((profileName) =>
                    assertPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY, profileName)
                );

                const profiles = orderGatewayProfiles(
                    (
                        await Promise.all(input.profileNames.map((profileName) => ctx.profiles.getProfile(profileName)))
                    ).filter((profile): profile is NonNullable<typeof profile> => profile !== null)
                );
                if (profiles.length !== input.profileNames.length) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: '선택한 서버를 찾을 수 없습니다.' });
                }

                let resolvedCommitSha: string;
                try {
                    resolvedCommitSha =
                        input.sourceMode === 'BRANCH'
                            ? await resolveGitBranchCommitSha(input.sourceRef)
                            : await resolveGitCommitSha(input.sourceRef);
                    if (profiles.length) {
                        const scenarios = await listScenarioPreviews({ gitRef: resolvedCommitSha });
                        const incompatibleProfile = profiles.find(
                            (profile) =>
                                profile.currentScenario === null ||
                                !scenarios.some((scenario) => String(scenario.id) === profile.currentScenario)
                        );
                        if (incompatibleProfile) {
                            throw new TRPCError({
                                code: 'BAD_REQUEST',
                                message: `${resolveGatewayProfileDisplayName(incompatibleProfile.profile, incompatibleProfile.instanceKey, incompatibleProfile.meta.korName)}의 현재 시나리오가 대상 버전에 없습니다.`,
                            });
                        }
                    }
                } catch (error) {
                    if (error instanceof TRPCError) throw error;
                    throw new TRPCError({ code: 'BAD_REQUEST', message: '일괄 업데이트 소스가 올바르지 않습니다.' });
                }

                try {
                    return await ctx.prisma.$transaction(async (tx) => {
                        const batchId = randomUUID();
                        const batch = await tx.gatewayBulkRelease.create({
                            data: {
                                id: batchId,
                                sourceMode: input.sourceMode,
                                sourceRef: input.sourceRef,
                                resolvedCommitSha,
                                reason: input.reason,
                                requestedBy: adminAuth.user.id,
                            },
                        });
                        let order = 0;
                        if (input.includeGateway) {
                            const operation = await tx.gatewayReleaseOperation.create({
                                data: {
                                    type: 'DEPLOY',
                                    sourceMode: 'COMMIT',
                                    sourceRef: resolvedCommitSha,
                                    payload: { bulkReleaseId: batchId },
                                    reason: input.reason,
                                    requestedBy: adminAuth.user.id,
                                    bulkReleaseId: batchId,
                                    bulkOrder: order++,
                                },
                            });
                            await tx.gatewayReleaseLog.create({
                                data: {
                                    operationId: operation.id,
                                    level: 'INFO',
                                    phase: 'queue',
                                    message: '일괄 업데이트의 Gateway 작업이 등록되었습니다.',
                                },
                            });
                        }
                        for (const profile of profiles) {
                            const operation = await tx.gatewayOperation.create({
                                data: {
                                    profileName: profile.profileName,
                                    type: 'DEPLOY',
                                    sourceMode: 'COMMIT',
                                    sourceRef: resolvedCommitSha,
                                    payload: {
                                        bulkReleaseId: batchId,
                                        releaseSource: { mode: 'COMMIT', ref: resolvedCommitSha },
                                    },
                                    reason: input.reason,
                                    requestedBy: adminAuth.user.id,
                                    bulkReleaseId: batchId,
                                    bulkOrder: order++,
                                },
                            });
                            await tx.gatewayOperationLog.create({
                                data: {
                                    operationId: operation.id,
                                    level: 'INFO',
                                    phase: 'queue',
                                    message: '일괄 업데이트의 DB 보존 버전 업데이트가 등록되었습니다.',
                                },
                            });
                        }
                        return {
                            id: batch.id,
                            resolvedCommitSha,
                            targetCount: order,
                        };
                    });
                } catch (error) {
                    if (!isUniqueConstraintError(error)) throw error;
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: '선택한 대상 중 이미 대기 또는 실행 중인 릴리스 작업이 있습니다.',
                    });
                }
            }),
    }),
    releases: router({
        gatewayState: releaseAdminProcedure.query(({ ctx }) => ctx.releases.getState()),
        list: releaseAdminProcedure
            .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
            .query(({ ctx, input }) => ctx.releases.listOperations(input?.limit)),
        logs: releaseAdminProcedure
            .input(
                z.object({
                    id: z.string().uuid(),
                    afterCursor: z.string().regex(/^\d+$/u).optional(),
                    limit: z.number().int().min(1).max(500).default(200),
                    timeoutMs: z.number().int().min(0).max(25_000).default(20_000),
                })
            )
            .query(async ({ ctx, input }) => {
                const deadline = Date.now() + input.timeoutMs;
                while (true) {
                    const [operation, entries] = await Promise.all([
                        ctx.releases.getOperation(input.id),
                        ctx.releases.listOperationLogs(input.id, input.afterCursor, input.limit),
                    ]);
                    if (!operation) {
                        throw new TRPCError({ code: 'NOT_FOUND', message: 'Gateway release operation not found.' });
                    }
                    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(operation.status);
                    if (entries.length || terminal || Date.now() >= deadline) {
                        return {
                            operation,
                            entries,
                            nextCursor: entries.at(-1)?.cursor ?? input.afterCursor,
                        };
                    }
                    await new Promise<void>((resolve) => setTimeout(resolve, 250));
                }
            }),
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
                    const operation = await ctx.releases.createOperation({
                        type: 'DEPLOY',
                        sourceMode: input.sourceMode,
                        sourceRef,
                        reason: input.reason,
                        requestedBy: adminAuth.user.id,
                    });
                    try {
                        await ctx.releases.appendOperationLog(operation.id, {
                            level: 'INFO',
                            phase: 'queue',
                            message: 'Gateway 배포 작업을 controller queue에 등록했습니다.',
                        });
                    } catch {
                        // The API that first creates GatewayReleaseLog must still be able to queue its own release.
                    }
                    return operation;
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
                    const operation = await ctx.releases.createOperation({
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
                    try {
                        await ctx.releases.appendOperationLog(operation.id, {
                            level: 'INFO',
                            phase: 'queue',
                            message: 'Gateway rollback 작업을 controller queue에 등록했습니다.',
                        });
                    } catch {
                        // Preserve the bootstrap release when the log table does not exist yet.
                    }
                    return operation;
                } catch (error) {
                    if (!isUniqueConstraintError(error)) {
                        throw error;
                    }
                    throw new TRPCError({ code: 'CONFLICT', message: 'A gateway release is already active.' });
                }
            }),
        cancel: releaseAdminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
            if (!(await ctx.releases.cancelOperation(input.id))) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'Only queued releases or a release that is still building can be cancelled.',
                });
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
        getResetDefaults: adminProcedure
            .input(z.object({ profileName: z.string().min(1) }))
            .query(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                assertPermission(adminAuth, ROLE_ADMIN_SCENARIO_RESET, input.profileName);
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile not found.' });
                }
                const meta = readMetaObject(profile.meta);
                return readProfileResetDefaults(meta);
            }),
        listNavigation: adminProcedure.query(async ({ ctx }) => {
            const adminAuth = requireAdminAuth(ctx);
            return orderGatewayProfiles(await ctx.profiles.listProfiles())
                .filter((profile) => canReadProfile(adminAuth, profile.profileName))
                .map((profile) => ({
                    profileName: profile.profileName,
                    profile: profile.profile,
                    instanceKey: profile.instanceKey,
                    displayName: resolveGatewayProfileDisplayName(
                        profile.profile,
                        profile.instanceKey,
                        profile.meta.korName
                    ),
                    currentScenario: profile.currentScenario,
                    meta: {
                        korName: resolveGatewayProfileKoreanName(profile.profile, profile.meta.korName),
                    },
                }));
        }),
        list: adminProcedure.query(async ({ ctx }) => {
            const adminAuth = requireAdminAuth(ctx);
            const profiles = orderGatewayProfiles(await ctx.profiles.listProfiles()).filter((profile) =>
                canReadProfile(adminAuth, profile.profileName)
            );
            const profileNames = profiles.map((profile) => profile.profileName);
            const [runtimeActions, activeOperations, runtimeSettings] = await Promise.all([
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
                ctx.orchestrator.listRuntimeSettings?.(profileNames) ?? Promise.resolve([]),
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
            const runtimeSettingsMap = new Map(runtimeSettings.map((settings) => [settings.profileName, settings]));
            return profiles.map((profile) => ({
                ...profile,
                displayName: resolveGatewayProfileDisplayName(
                    profile.profile,
                    profile.instanceKey,
                    profile.meta.korName
                ),
                runtimeActions: runtimeActionsByProfile.get(profile.profileName) ?? [],
                runtimeSettings: runtimeSettingsMap.get(profile.profileName) ?? null,
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
        listScenarios: adminProcedure
            .input(
                z
                    .object({
                        profileName: z.string().min(1).max(64).optional(),
                        gitRef: z.string().min(1).max(128).optional(),
                        sourceMode: zResetSourceMode.optional(),
                    })
                    .optional()
            )
            .query(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                const sourceMode = input?.sourceMode ?? 'CURRENT';
                let resolvedSourceMode: 'BRANCH' | 'COMMIT' | undefined =
                    sourceMode === 'CURRENT' ? undefined : sourceMode;
                let gitRef = input?.gitRef?.trim();
                let currentScenarioId: number | null = null;
                if (sourceMode === 'CURRENT') {
                    if (!input?.profileName) {
                        if (!adminAuth.isSuperuser) {
                            throw new TRPCError({ code: 'BAD_REQUEST', message: '대상 서버를 선택해야 합니다.' });
                        }
                    } else {
                        assertPermission(adminAuth, ROLE_ADMIN_SCENARIO_RESET, input.profileName);
                        const profile = await ctx.profiles.getProfile(input.profileName);
                        if (!profile) throw new TRPCError({ code: 'NOT_FOUND', message: 'Profile not found.' });
                        const parsedScenarioId =
                            profile.currentScenario === null ? Number.NaN : Number(profile.currentScenario);
                        currentScenarioId = Number.isInteger(parsedScenarioId) ? parsedScenarioId : null;
                        const configuredSource = readProfileReleaseSource(profile);
                        gitRef = configuredSource?.ref;
                        resolvedSourceMode = configuredSource?.mode;
                        if (!configuredSource || !gitRef) {
                            throw new TRPCError({
                                code: 'BAD_REQUEST',
                                message: 'The profile has no active build commit.',
                            });
                        }
                    }
                } else if (input?.profileName) {
                    assertPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY, input.profileName);
                } else {
                    assertPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY);
                }
                const scenarios = !gitRef
                    ? await listScenarioPreviews()
                    : await listScenarioPreviews({
                          gitRef:
                              resolvedSourceMode === 'BRANCH'
                                  ? await resolveGitBranchCommitSha(gitRef)
                                  : await resolveGitCommitSha(gitRef),
                      });
                return scenarios.map((scenario) => ({
                    ...scenario,
                    isCurrent: currentScenarioId === scenario.id,
                }));
            }),
        upsert: adminProcedure
            .input(
                z.object({
                    profile: z.string().regex(/^[a-z0-9-]{1,32}$/),
                    instanceKey: z
                        .string()
                        .regex(/^[a-z0-9-]{1,64}$/)
                        .optional(),
                    currentScenario: z.string().min(1).max(64).nullable().optional(),
                    scenario: z.string().min(1).max(64).optional(),
                    apiPort: z.number().int().min(1).max(65535),
                    status: zProfileStatus.optional(),
                    preopenAt: z.string().datetime().optional(),
                    openAt: z.string().datetime().optional(),
                    scheduledStartAt: z.string().datetime().optional(),
                    buildCommitSha: z.string().min(7).max(64).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                assertAllPermissions(requireAdminAuth(ctx), [
                    ROLE_ADMIN_PROFILE_RUNTIME,
                    ROLE_ADMIN_PROFILE_SETTINGS,
                    ROLE_ADMIN_PROFILE_DEPLOY,
                    ROLE_ADMIN_SCENARIO_RESET,
                ]);
                const status = input.status ?? 'STOPPED';
                return ctx.profiles.upsertProfile({
                    profile: input.profile,
                    instanceKey: input.instanceKey,
                    currentScenario: input.currentScenario,
                    scenario: input.scenario,
                    apiPort: input.apiPort,
                    status,
                    preopenAt: input.preopenAt,
                    openAt: input.openAt,
                    scheduledStartAt: input.scheduledStartAt,
                    buildCommitSha: input.buildCommitSha,
                });
            }),
        setStatus: adminProcedure
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
                const adminAuth = requireAdminAuth(ctx);
                assertPermission(adminAuth, ROLE_ADMIN_PROFILE_RUNTIME);
                if (input.buildCommitSha) {
                    assertPermission(adminAuth, ROLE_ADMIN_PROFILE_DEPLOY);
                }
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
        updateMeta: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    patch: z.object({
                        korName: z.string().min(1).max(64).nullable().optional(),
                        color: z.string().min(1).max(32).nullable().optional(),
                        inGameNotice: z.string().max(4000).nullable().optional(),
                        profileImageUrl: z.string().max(2048).nullable().optional(),
                        nextSeasonIdx: z.number().int().min(0).nullable().optional(),
                        firstGameIdx: z.number().int().min(0).nullable().optional(),
                        localAccountAccessGraceDays: z.number().int().min(0).max(365).nullable().optional(),
                        localAccountGeneralCreationGraceDays: z.number().int().min(0).max(365).nullable().optional(),
                        resetDefaults: zProfileResetDefaults.nullable().optional(),
                    }),
                    reason: z.string().trim().min(3).max(200),
                })
            )
            .mutation(async ({ ctx, input }) => {
                assertPermission(requireAdminAuth(ctx), ROLE_ADMIN_PROFILE_SETTINGS, input.profileName);
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
        install: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    install: zInstallOptions,
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                assertAllPermissions(adminAuth, [ROLE_ADMIN_SCENARIO_RESET, ROLE_ADMIN_PROFILE_DEPLOY]);
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
                if (scheduledAt) {
                    assertPermission(adminAuth, ROLE_RESET_SCHEDULE);
                }
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
                    if (!isProfileOperationConflictError(error)) {
                        throw error;
                    }
                    throw new TRPCError({
                        code: 'CONFLICT',
                        message: 'This profile already has a queued or running operation.',
                    });
                }
            }),
        installNow: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    install: zInstallOptions,
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                assertAllPermissions(adminAuth, [ROLE_ADMIN_SCENARIO_RESET, ROLE_ADMIN_PROFILE_DEPLOY]);
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
                    if (!isProfileOperationConflictError(error)) {
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
                    runtimeSettings: zRuntimeSettings.optional(),
                    scheduledAt: z.string().datetime().optional(),
                    reason: z.string().max(200).optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const adminAuth = requireAdminAuth(ctx);
                if (input.action === 'RESET_NOW' || input.action === 'RESET_SCHEDULED') {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '시나리오 초기화는 operations.requestReset을 사용해 주세요.',
                    });
                }
                if ((input.action === 'ACCELERATE' || input.action === 'DELAY') && !input.durationMinutes) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'durationMinutes is required for acceleration or delay.',
                    });
                }
                if (input.action === 'UPDATE_RUNTIME_SETTINGS') {
                    if (!input.runtimeSettings) {
                        throw new TRPCError({ code: 'BAD_REQUEST', message: 'runtimeSettings is required.' });
                    }
                    if (!input.reason || input.reason.trim().length < 3) {
                        throw new TRPCError({ code: 'BAD_REQUEST', message: '변경 사유를 입력해 주세요.' });
                    }
                } else if (input.runtimeSettings) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'runtimeSettings is not valid for this action.',
                    });
                }
                if (input.scheduledAt) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'scheduledAt is supported only by operations.requestReset.',
                    });
                }
                const profile = await ctx.profiles.getProfile(input.profileName);
                if (!profile) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'Profile not found.',
                    });
                }

                const canManageProfiles = hasScopedPermission(
                    adminAuth,
                    ROLE_ADMIN_PROFILE_RUNTIME,
                    profile.profileName
                );
                const canResume =
                    canManageProfiles || hasScopedPermission(adminAuth, ROLE_RESUME_WHEN_STOPPED, profile.profileName);
                const canOpenSurvey =
                    canManageProfiles || hasScopedPermission(adminAuth, ROLE_SURVEY_OPEN, profile.profileName);
                const canResetScenario = hasScopedPermission(adminAuth, ROLE_ADMIN_SCENARIO_RESET, profile.profileName);

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
                    if (profile.currentScenario === null) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'An uninitialized profile must be reset before it can be resumed.',
                        });
                    }
                } else if (input.action === 'PAUSE' && profile.status !== 'RUNNING') {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Pause is allowed only for RUNNING profiles.',
                    });
                } else if (input.action === 'STOP' && !gatewayProfileCapabilities(profile.status).runtimeExpected) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'Stop is allowed only while the profile runtime is available.',
                    });
                } else if (input.action === 'CLOSE_COMPLETED') {
                    if (!canResetScenario) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Scenario reset permission is required.',
                        });
                    }
                    if (!gatewayProfileCapabilities(profile.status).runtimeExpected) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Completed cleanup is allowed only while the profile runtime is available.',
                        });
                    }
                    const [runtimeSettings] =
                        (await ctx.orchestrator.listRuntimeSettings?.([profile.profileName])) ?? [];
                    const isUnited = profile.status === 'COMPLETED' || Number(runtimeSettings?.isUnited ?? 0) !== 0;
                    if (!isUnited) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Only a unified game can be closed by a scenario opener.',
                        });
                    }
                } else if (input.action === 'OPEN_SURVEY') {
                    if (!canOpenSurvey) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Survey permission is required.',
                        });
                    }
                } else if (input.action === 'UPDATE_RUNTIME_SETTINGS') {
                    if (!gatewayProfileCapabilities(profile.status).runtimeExpected) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: '실행 중인 프로필에서만 현재 기수 설정을 바꿀 수 있습니다.',
                        });
                    }
                    if (!canManageProfiles) {
                        throw new TRPCError({
                            code: 'FORBIDDEN',
                            message: 'Profile management permission is required.',
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

                if (
                    input.action === 'ACCELERATE' ||
                    input.action === 'DELAY' ||
                    input.action === 'UPDATE_RUNTIME_SETTINGS'
                ) {
                    try {
                        const runtimeAction = await ctx.prisma.gatewayRuntimeAction.create({
                            data: {
                                profileName: input.profileName,
                                action: input.action,
                                payload: input.runtimeSettings ? { settings: input.runtimeSettings } : {},
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
                            message: '이 프로필의 이전 런타임 변경 요청이 아직 처리 중입니다.',
                        });
                    }
                }

                const statusMap = {
                    RESUME: 'RUNNING',
                    PAUSE: 'PAUSED',
                    STOP: 'STOPPED',
                    CLOSE_COMPLETED: 'STOPPED',
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
        requestBuild: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    commitSha: z.string().min(7).max(64),
                })
            )
            .mutation(async ({ ctx, input }) => {
                assertPermission(requireAdminAuth(ctx), ROLE_ADMIN_PROFILE_DEPLOY);
                const requestedAt = new Date().toISOString();
                const result = await ctx.profiles.updateBuildStatus(input.profileName, 'QUEUED', {
                    requestedAt,
                    error: null,
                    commitSha: input.commitSha,
                });
                return result;
            }),
        setBuildStatus: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    status: zBuildStatus,
                })
            )
            .mutation(async ({ ctx, input }) => {
                assertPermission(requireAdminAuth(ctx), ROLE_ADMIN_PROFILE_DEPLOY);
                return ctx.profiles.updateBuildStatus(input.profileName, input.status);
            }),
        reconcileNow: adminProcedure.mutation(async ({ ctx }) => {
            assertPermission(requireAdminAuth(ctx), ROLE_ADMIN_PROFILE_RUNTIME);
            await ctx.orchestrator.reconcileNow();
            return { ok: true };
        }),
        cleanupWorkspaces: adminProcedure.mutation(async ({ ctx }) => {
            assertPermission(requireAdminAuth(ctx), ROLE_ADMIN_PROFILE_DEPLOY);
            const result = await ctx.orchestrator.cleanupStaleWorkspaces();
            return {
                removed: result.removed,
                skipped: result.skipped,
            };
        }),
    }),
});
