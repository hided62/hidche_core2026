import { isDeepStrictEqual } from 'node:util';
import { TRPCError } from '@trpc/server';
import { isGameAccessBlocked } from '@sammo-ts/common/auth/sanctions';
import type { GatewayPrisma, GatewayPrismaClient } from '@sammo-ts/infra';
import type { GatewayApiContext } from '../context.js';
import type { UserRecord } from '../auth/userRepository.js';
import { resolveLocalAccountProfilePolicy } from '../auth/localAccountPolicy.js';
import { CONTROL_PLANE_OPERATION_CLAIM_LOCK } from '../orchestrator/profileRepository.js';
import { readProfileReleaseSource } from '../orchestrator/profileReleaseSource.js';
import { buildResetOtherTextInfo, zOperationInstallOptions } from '../resetOptions.js';
import {
    listScenarioPreviews,
    resolveGitBranchCommitSha,
    resolveGitCommitSha,
    supportsProfileReleaseBuild,
} from '../scenario/scenarioCatalog.js';
import { canRequestOpening, openingSeasonKey, readOpenRequestPolicy, type OpenRequestPolicy } from './policy.js';
import { z } from 'zod';
import { resolveOpeningCatalogCommit } from './catalogSource.js';

export const zOpeningInstall = zOperationInstallOptions.required({ preopenAt: true, openAt: true }).strict();
export type OpeningInstall = z.infer<typeof zOpeningInstall>;
export interface OpenRequestResult {
    id: string;
    status: string;
}
export interface OpenRequestList {
    policy: OpenRequestPolicy;
    canRequest: boolean;
    requests: Array<{
        id: string;
        status: string;
        requesterName: string;
        isMine: boolean;
        announcement: { scenarioTitle: string; defaultStatTotal: number };
        install: OpeningInstall;
        expiresAt: string;
        createdAt: string;
        endorsementCount: number;
        endorsed: boolean;
        canEndorse: boolean;
        operationStatus: string | null;
    }>;
}
type Profile = NonNullable<Awaited<ReturnType<GatewayPrismaClient['gatewayProfile']['findUnique']>>>;
type Request = NonNullable<Awaited<ReturnType<GatewayPrismaClient['gatewayOpenRequest']['findUnique']>>>;
const fail = (message: string, code: 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND' = 'BAD_REQUEST'): never => {
    throw new TRPCError({ code, message });
};

// Authentication grace is deliberately not full membership. Special grants must apply to this profile.
export const isOpeningMember = async (
    ctx: GatewayApiContext,
    user: UserRecord,
    profile: Profile,
    now: Date
): Promise<boolean> => {
    if (user.deleteAfter || isGameAccessBlocked(user.sanctions, [profile.profile, profile.profileName], now))
        return false;
    if (user.oauthType === 'KAKAO' && user.oauthId?.trim() && user.kakaoVerifiedAt) return true;
    const policy = resolveLocalAccountProfilePolicy({
        profile: profile.profile,
        profileName: profile.profileName,
        profileMeta: profile.meta as Record<string, unknown>,
        defaultGraceDays: ctx.localAccountGraceDays,
        user,
        specialAccessGrants: await ctx.users.listSpecialAccessGrants(user.id),
        now,
    });
    return policy.kakaoVerified || policy.specialAccess !== null;
};

const assertMember = async (ctx: GatewayApiContext, user: UserRecord, profile: Profile, now: Date): Promise<void> => {
    const currentUser = await ctx.users.findById(user.id);
    if (!currentUser || !(await isOpeningMember(ctx, currentUser, profile, now)))
        fail('카카오 인증 또는 이 서버의 정식 접근 허용이 필요합니다.', 'FORBIDDEN');
};

const buildAt = (preopenAt: Date, lead: number): Date => new Date(preopenAt.getTime() - lead * 60_000);
const activeStatus = (request: Request, profile: Profile, now: Date): string => {
    if (request.status !== 'PENDING') return request.status;
    if (!canRequestOpening(profile.status) || request.seasonKey !== openingSeasonKey(profile)) return 'SUPERSEDED';
    const policy = readOpenRequestPolicy(profile.meta as Record<string, unknown>);
    if (request.expiresAt <= now || buildAt(request.preopenAt, policy.buildLeadMinutes) <= now) return 'EXPIRED';
    return request.status;
};

export const listOpenRequests = async (
    ctx: GatewayApiContext,
    user: UserRecord,
    profileName: string
): Promise<OpenRequestList> => {
    const profile = await ctx.prisma.gatewayProfile.findUnique({ where: { profileName } });
    if (!profile) return fail('서버를 찾을 수 없습니다.', 'NOT_FOUND');
    const now = new Date();
    const policy = readOpenRequestPolicy(profile.meta as Record<string, unknown>);
    const member = await isOpeningMember(ctx, user, profile, now);
    const requests = await ctx.prisma.gatewayOpenRequest.findMany({
        where: {
            profileName,
            OR: [
                { status: 'PENDING', expiresAt: { gt: now } },
                { status: 'RESERVED', openAt: { gt: now } },
            ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 100,
        include: {
            requester: { select: { displayName: true } },
            endorsements: { select: { userId: true } },
            operation: { select: { status: true } },
        },
    });
    const voters = await ctx.users.findByIds([
        ...new Set(requests.flatMap((request) => request.endorsements.map((vote) => vote.userId))),
    ]);
    const qualifiedVoters = new Set<string>();
    for (const voter of voters) {
        if (await isOpeningMember(ctx, voter, profile, now)) qualifiedVoters.add(voter.id);
    }
    const activeOperation = await ctx.prisma.gatewayOperation.findFirst({
        where: { profileName, status: { in: ['QUEUED', 'RUNNING'] } },
        select: { id: true },
    });
    return {
        policy,
        canRequest: member && policy.enabled && canRequestOpening(profile.status) && !activeOperation,
        requests: requests
            .filter((request) => ['PENDING', 'RESERVED'].includes(activeStatus(request, profile, now)))
            .map((request) => ({
                id: request.id,
                status: request.status,
                requesterName: request.requester.displayName,
                isMine: request.requestedBy === user.id,
                announcement: z
                    .object({ scenarioTitle: z.string(), defaultStatTotal: z.number() })
                    .parse(request.announcement),
                install: zOpeningInstall.parse(request.install),
                expiresAt: request.expiresAt.toISOString(),
                createdAt: request.createdAt.toISOString(),
                endorsementCount: request.endorsements.filter((vote) => qualifiedVoters.has(vote.userId)).length,
                endorsed: request.endorsements.some((vote) => vote.userId === user.id),
                canEndorse:
                    member &&
                    policy.enabled &&
                    policy.endorsementThreshold !== null &&
                    request.requestedBy !== user.id &&
                    request.status === 'PENDING',
                operationStatus: request.operation?.status ?? null,
            })),
    };
};

const inProfileTransaction = async <T>(
    ctx: GatewayApiContext,
    profileName: string,
    run: (tx: GatewayPrisma.TransactionClient, profile: Profile, now: Date) => Promise<T>
): Promise<T> =>
    ctx.prisma.$transaction(
        async (tx) => {
            // Same ordering as RESET admission/claim. This serializes consensus with operator operations.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${CONTROL_PLANE_OPERATION_CLAIM_LOCK}, 0))::text`;
            await tx.$queryRaw`SELECT "profile_name" FROM "gateway_profile" WHERE "profile_name" = ${profileName} FOR UPDATE`;
            const profile = await tx.gatewayProfile.findUnique({ where: { profileName } });
            if (!profile) return fail('서버를 찾을 수 없습니다.', 'NOT_FOUND');
            const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
            return run(tx, profile, now!);
        },
        { timeout: 60_000 }
    );

export const createOpenRequest = async (
    ctx: GatewayApiContext,
    user: UserRecord,
    profileName: string,
    install: OpeningInstall
): Promise<OpenRequestResult> =>
    inProfileTransaction(ctx, profileName, async (tx, profile, now) => {
        await assertMember(ctx, user, profile, now);
        const policy = readOpenRequestPolicy(profile.meta as Record<string, unknown>);
        if (!policy.enabled || !canRequestOpening(profile.status))
            return fail('통일되었거나 닫힌 서버에만 오픈 요청을 할 수 있습니다.', 'CONFLICT');
        const preopenAt = new Date(install.preopenAt),
            openAt = new Date(install.openAt);
        const deadline = buildAt(preopenAt, policy.buildLeadMinutes);
        if (deadline <= now || preopenAt >= openAt)
            return fail('가오픈은 빌드 선행 시간 이후, 정식 오픈은 가오픈 이후여야 합니다.');
        if (install.autorunUser && install.autorunUser.limitMinutes > 0 !== install.autorunUser.options.length > 0)
            return fail('자율행동 시간과 항목을 함께 지정해 주세요.');
        if (await tx.gatewayOperation.findFirst({ where: { profileName, status: { in: ['QUEUED', 'RUNNING'] } } }))
            return fail('진행 중이거나 예약된 서버 작업이 있습니다.', 'CONFLICT');
        const old = await tx.gatewayOpenRequest.findMany({ where: { profileName, status: 'PENDING' } });
        for (const request of old) {
            const status = activeStatus(request, profile, now);
            if (status !== 'PENDING')
                await tx.gatewayOpenRequest.update({ where: { id: request.id }, data: { status } });
            else if (request.requestedBy === user.id) {
                if (isDeepStrictEqual(request.install, install)) return { id: request.id, status: request.status };
                return fail('기존 요청을 철회한 뒤 새 요청을 등록해 주세요.', 'CONFLICT');
            }
        }
        if (old.filter((request) => activeStatus(request, profile, now) === 'PENDING').length >= 100)
            return fail('이 서버의 대기 요청이 너무 많습니다.', 'CONFLICT');
        const catalogCommit = await resolveOpeningCatalogCommit({
            meta: profile.meta as GatewayPrisma.JsonObject,
            buildCommitSha: profile.buildCommitSha ?? undefined,
        });
        const scenario = (await listScenarioPreviews({ gitRef: catalogCommit })).find(
            (entry) => entry.id === install.scenarioId
        );
        if (!scenario) return fail('현재 서버에 없는 시나리오입니다.');
        const expiresAt = new Date(Math.min(now.getTime() + policy.lifetimeDays * 86_400_000, deadline.getTime()));
        const request = await tx.gatewayOpenRequest.create({
            data: {
                profileName,
                requestedBy: user.id,
                install,
                preopenAt,
                openAt,
                expiresAt,
                seasonKey: openingSeasonKey(profile),
                announcement: { scenarioTitle: scenario.title, defaultStatTotal: scenario.defaultStatTotal },
            },
        });
        return { id: request.id, status: request.status };
    });

// Called only while holding the shared admission lock. All mutations, including the winning
// endorsement, sibling supersession, operation, and log either commit together or roll back.
const reserve = async (
    ctx: GatewayApiContext,
    tx: GatewayPrisma.TransactionClient,
    profile: Profile,
    request: Request,
    actorId: string,
    now: Date
) => {
    const requester = await ctx.users.findById(request.requestedBy);
    if (!requester || !(await isOpeningMember(ctx, requester, profile, now)))
        return fail('요청자의 정식 참여 자격을 확인해 주세요.', 'CONFLICT');
    if (
        await tx.gatewayOperation.findFirst({
            where: { profileName: profile.profileName, status: { in: ['QUEUED', 'RUNNING'] } },
        })
    )
        return fail('진행 중이거나 예약된 서버 작업이 있습니다.', 'CONFLICT');
    const policy = readOpenRequestPolicy(profile.meta as Record<string, unknown>);
    const install = zOpeningInstall.parse(request.install);
    const source = readProfileReleaseSource({
        meta: profile.meta as GatewayPrisma.JsonObject,
        buildCommitSha: profile.buildCommitSha ?? undefined,
    });
    if (!source) return fail('서버 패치 정책이 준비되지 않았습니다.');
    const commit =
        source.mode === 'BRANCH' ? await resolveGitBranchCommitSha(source.ref) : await resolveGitCommitSha(source.ref);
    const scenario = (await listScenarioPreviews({ gitRef: commit })).find((entry) => entry.id === install.scenarioId);
    if (!scenario || !(await supportsProfileReleaseBuild(commit)))
        return fail('패치 정책의 버전에서 시나리오 또는 배포 빌드를 사용할 수 없습니다.');
    const scheduledAt = buildAt(request.preopenAt, policy.buildLeadMinutes);
    const [{ now: admissionNow }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (scheduledAt <= admissionNow! || request.expiresAt <= admissionNow!)
        return fail('빌드 시작 시각이 지나 요청을 수락할 수 없습니다.', 'CONFLICT');
    const operation = await tx.gatewayOperation.create({
        data: {
            profileName: profile.profileName,
            type: 'RESET',
            sourceMode: source.mode,
            sourceRef: source.mode === 'COMMIT' ? commit : source.ref,
            requestedBy: actorId,
            scheduledAt,
            payload: {
                install,
                requestedSource: 'CURRENT',
                releaseSource: { ...source },
                openRequestId: request.id,
                openRequestSeasonKey: request.seasonKey,
                publicAnnouncement: {
                    enabled: true,
                    scenarioId: scenario.id,
                    scenarioTitle: scenario.title,
                    defaultStatTotal: scenario.defaultStatTotal,
                    scheduledAt: scheduledAt.toISOString(),
                    preopenAt: install.preopenAt,
                    openAt: install.openAt,
                    turnTermMinutes: install.turnTermMinutes,
                    fictionMode: install.fiction === 1 ? '가상' : '사실',
                    npcMode: install.npcMode,
                    otherTextInfo: buildResetOtherTextInfo(install),
                    autorunUser: install.autorunUser ?? null,
                },
            },
            reason: '사용자 오픈 요청 수락',
        },
    });
    await tx.gatewayOperationLog.create({
        data: {
            operationId: operation.id,
            level: 'INFO',
            phase: 'queue',
            message: '오픈 요청이 서버 패치 정책을 따르는 초기화 예약으로 전환되었습니다.',
        },
    });
    await tx.gatewayOpenRequest.update({
        where: { id: request.id },
        data: { status: 'RESERVED', operationId: operation.id, decidedBy: actorId, decidedAt: now },
    });
    await tx.gatewayOpenRequest.updateMany({
        where: { profileName: profile.profileName, status: 'PENDING', id: { not: request.id } },
        data: { status: 'SUPERSEDED', decidedAt: now },
    });
    return { id: request.id, status: 'RESERVED' };
};

export const actOnOpenRequest = async (
    ctx: GatewayApiContext,
    user: UserRecord,
    id: string,
    action: 'ENDORSE' | 'WITHDRAW' | 'ACCEPT' | 'REJECT'
): Promise<OpenRequestResult> => {
    const initial = await ctx.prisma.gatewayOpenRequest.findUnique({ where: { id } });
    if (!initial) return fail('오픈 요청을 찾을 수 없습니다.', 'NOT_FOUND');
    return inProfileTransaction(ctx, initial.profileName, async (tx, profile, now) => {
        const request = await tx.gatewayOpenRequest.findUniqueOrThrow({ where: { id } });
        if (action === 'ENDORSE') await assertMember(ctx, user, profile, now);
        if (action === 'WITHDRAW' && request.requestedBy !== user.id)
            return fail('자신의 요청만 철회할 수 있습니다.', 'FORBIDDEN');
        if (request.status === 'RESERVED' && ['ACCEPT', 'ENDORSE'].includes(action))
            return { id, status: request.status };
        if (action === 'WITHDRAW' && request.status === 'WITHDRAWN') return { id, status: request.status };
        if (activeStatus(request, profile, now) !== 'PENDING')
            return fail('만료되었거나 이미 처리된 요청입니다.', 'CONFLICT');
        if (action === 'WITHDRAW' || action === 'REJECT') {
            const status = action === 'WITHDRAW' ? 'WITHDRAWN' : 'REJECTED';
            await tx.gatewayOpenRequest.update({ where: { id }, data: { status, decidedBy: user.id, decidedAt: now } });
            return { id, status };
        }
        const policy = readOpenRequestPolicy(profile.meta as Record<string, unknown>);
        if (!policy.enabled) return fail('이 서버는 오픈 요청을 받지 않습니다.', 'CONFLICT');
        if (action === 'ACCEPT') return reserve(ctx, tx, profile, request, user.id, now);
        if (request.requestedBy === user.id) return fail('요청자는 자신의 요청에 동의할 수 없습니다.');
        if (policy.endorsementThreshold === null) return fail('이 서버는 오프너 수락으로만 예약할 수 있습니다.');
        await tx.gatewayOpenEndorsement.upsert({
            where: { requestId_userId: { requestId: id, userId: user.id } },
            create: { requestId: id, userId: user.id },
            update: {},
        });
        const votes = await tx.gatewayOpenEndorsement.findMany({ where: { requestId: id } });
        if (votes.length >= policy.endorsementThreshold) {
            // Revoked, banned, deleted or unverified voters no longer contribute to automatic approval.
            let valid = 0;
            for (const voter of await ctx.users.findByIds(votes.map((vote) => vote.userId))) {
                if (await isOpeningMember(ctx, voter, profile, now)) valid++;
            }
            if (valid >= policy.endorsementThreshold) return reserve(ctx, tx, profile, request, user.id, now);
        }
        return { id, status: 'PENDING' };
    });
};

// Lowering the threshold also evaluates accumulated agreements immediately. Older eligible
// proposals win deterministically; the same admission lock prevents a parallel endorsement winner.
export const updateOpenRequestPolicy = async (
    ctx: GatewayApiContext,
    profileName: string,
    policy: OpenRequestPolicy,
    actorId: string
): Promise<OpenRequestPolicy> =>
    inProfileTransaction(ctx, profileName, async (tx, profile, now) => {
        const updated = await tx.gatewayProfile.update({
            where: { profileName },
            data: { meta: { ...(profile.meta as GatewayPrisma.JsonObject), openRequestPolicy: { ...policy } } },
        });
        if (policy.enabled && policy.endorsementThreshold !== null && canRequestOpening(updated.status)) {
            const pending = await tx.gatewayOpenRequest.findMany({
                where: { profileName, status: 'PENDING' },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                include: { endorsements: { select: { userId: true } } },
            });
            for (const request of pending) {
                if (
                    activeStatus(request, updated, now) !== 'PENDING' ||
                    request.endorsements.length < policy.endorsementThreshold
                )
                    continue;
                let valid = 0;
                for (const voter of await ctx.users.findByIds(request.endorsements.map((vote) => vote.userId))) {
                    if (await isOpeningMember(ctx, voter, updated, now)) valid++;
                }
                if (valid >= policy.endorsementThreshold) {
                    await reserve(ctx, tx, updated, request, actorId, now);
                    break;
                }
            }
        }
        return policy;
    });
