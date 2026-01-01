import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { procedure, router } from './trpc.js';
import {
    GATEWAY_BUILD_STATUSES,
    GATEWAY_PROFILE_STATUSES,
} from './orchestrator/profileRepository.js';

const zProfileStatus = z.enum(GATEWAY_PROFILE_STATUSES);
const zBuildStatus = z.enum(GATEWAY_BUILD_STATUSES);

const adminProcedure = procedure.use(({ ctx, next }) => {
    if (!ctx.adminToken) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Admin token is not configured.',
        });
    }
    const provided =
        ctx.requestHeaders['x-admin-token'] ??
        ctx.requestHeaders['authorization'] ??
        '';
    const token =
        Array.isArray(provided) ? provided[0] ?? '' : (provided as string);
    if (!token || token !== ctx.adminToken) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid admin token.',
        });
    }
    return next();
});

export const adminRouter = router({
    profiles: router({
        list: adminProcedure.query(async ({ ctx }) => {
            const profiles = await ctx.profiles.listProfiles();
            const runtimeStates = await ctx.orchestrator.listRuntimeStates(
                profiles.map((profile) => profile.profileName)
            );
            const runtimeMap = new Map(
                runtimeStates.map((state) => [state.profileName, state])
            );
            return profiles.map((profile) => ({
                ...profile,
                runtime: runtimeMap.get(profile.profileName) ?? {
                    profileName: profile.profileName,
                    apiRunning: false,
                    daemonRunning: false,
                },
            }));
        }),
        upsert: adminProcedure
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
                if (input.status === 'RESERVED' && (!input.preopenAt || !input.openAt)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'preopenAt and openAt are required for RESERVED status.',
                    });
                }
                const result = await ctx.profiles.updateStatus(
                    input.profileName,
                    input.status,
                    {
                        preopenAt: input.preopenAt,
                        openAt: input.openAt,
                        scheduledStartAt:
                            input.status === 'RESERVED' ? input.scheduledStartAt : null,
                    }
                );
                if (input.buildCommitSha) {
                    await ctx.profiles.updateBuildStatus(input.profileName, 'IDLE', {
                        commitSha: input.buildCommitSha,
                    });
                }
                await ctx.orchestrator.reconcileNow();
                return result;
            }),
        requestBuild: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    commitSha: z.string().min(7).max(64),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const requestedAt = new Date().toISOString();
                const result = await ctx.profiles.updateBuildStatus(
                    input.profileName,
                    'QUEUED',
                    {
                        requestedAt,
                        error: null,
                        commitSha: input.commitSha,
                    }
                );
                return result;
            }),
        setBuildStatus: adminProcedure
            .input(
                z.object({
                    profileName: z.string().min(1),
                    status: zBuildStatus,
                })
            )
            .mutation(async ({ ctx, input }) =>
                ctx.profiles.updateBuildStatus(input.profileName, input.status)
            ),
        reconcileNow: adminProcedure.mutation(async ({ ctx }) => {
            await ctx.orchestrator.reconcileNow();
            return { ok: true };
        }),
        cleanupWorkspaces: adminProcedure.mutation(async ({ ctx }) => {
            const result = await ctx.orchestrator.cleanupStaleWorkspaces();
            return {
                removed: result.removed,
                skipped: result.skipped,
            };
        }),
    }),
});
