import { z } from 'zod';

export const zOpenRequestPolicy = z
    .object({
        enabled: z.boolean().default(true),
        lifetimeDays: z.number().int().min(1).max(365).default(7),
        buildLeadMinutes: z.number().int().min(1).max(10080).default(10),
        // null means opener approval only, including CHE by default.
        endorsementThreshold: z.number().int().min(1).max(10000).nullable().default(null),
    })
    .strict();

export interface OpenRequestPolicy {
    enabled: boolean;
    lifetimeDays: number;
    buildLeadMinutes: number;
    endorsementThreshold: number | null;
}

export const readOpenRequestPolicy = (meta: Record<string, unknown>): OpenRequestPolicy =>
    zOpenRequestPolicy.parse(meta.openRequestPolicy ?? {});

export const canRequestOpening = (status: string): boolean => ['COMPLETED', 'STOPPED', 'CANCELLED'].includes(status);

export const openingSeasonKey = (profile: { currentScenario: string | null; openAt?: string | Date | null }): string =>
    JSON.stringify([profile.currentScenario, profile.openAt ? new Date(profile.openAt).toISOString() : null]);

export const canExecuteOpeningReservation = (
    profile: { status: string; currentScenario: string | null; openAt?: string | Date | null },
    seasonKey: unknown,
    openAt: unknown,
    now: Date
): boolean =>
    canRequestOpening(profile.status) &&
    openingSeasonKey(profile) === seasonKey &&
    typeof openAt === 'string' &&
    Number.isFinite(Date.parse(openAt)) &&
    Date.parse(openAt) > now.getTime();
