import { describe, expect, it } from 'vitest';

import { resolveUpcomingResetAnnouncement, shouldExposeUpcomingReset } from '../src/lobby/profileStatusService.js';
import type { GatewayOperationRecord } from '../src/orchestrator/profileRepository.js';

const buildOperation = (status: GatewayOperationRecord['status'] = 'QUEUED'): GatewayOperationRecord => ({
    id: '11111111-1111-4111-8111-111111111111',
    profileName: 'che:2',
    type: 'RESET',
    status,
    sourceMode: 'BRANCH',
    sourceRef: 'private/source-ref',
    payload: {
        install: { scenarioId: 1010 },
        requestedSource: 'CURRENT',
        publicAnnouncement: {
            enabled: true,
            scenarioId: 1010,
            scenarioTitle: '황건적의 난',
            scheduledAt: '2026-08-27T05:00:00.000Z',
            preopenAt: '2026-08-27T05:30:00.000Z',
            openAt: '2026-08-27T11:00:00.000Z',
            turnTermMinutes: 60,
            fictionMode: '가상',
            npcMode: 1,
            defaultStatTotal: 70,
            otherTextInfo: '랜덤 임관',
            autorunUser: {
                limitMinutes: 1440,
                options: ['develop', 'battle'],
            },
            requestedBy: 'must-not-leak',
            reason: 'must-not-leak',
        },
    },
    reason: 'private reason',
    requestedBy: 'admin-id',
    scheduledAt: '2026-08-27T05:00:00.000Z',
    error: 'private error',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
});

describe('resolveUpcomingResetAnnouncement', () => {
    it('projects only the public snapshot while the delayed build is queued', () => {
        const result = resolveUpcomingResetAnnouncement(buildOperation(), new Date('2026-08-27T04:00:00.000Z'));

        expect(result).toEqual({
            phase: 'SCHEDULED',
            scheduledAt: '2026-08-27T05:00:00.000Z',
            preopenAt: '2026-08-27T05:30:00.000Z',
            openAt: '2026-08-27T11:00:00.000Z',
            scenarioId: 1010,
            scenarioTitle: '황건적의 난',
            turnTermMinutes: 60,
            fictionMode: '가상',
            npcMode: 1,
            defaultStatTotal: 70,
            otherTextInfo: '랜덤 임관',
            autorunUser: {
                limitMinutes: 1440,
                options: ['develop', 'battle'],
            },
        });
        expect(result).not.toHaveProperty('sourceRef');
        expect(result).not.toHaveProperty('requestedBy');
        expect(result).not.toHaveProperty('reason');
        expect(result).not.toHaveProperty('error');
    });

    it('moves from preparation to a truthful delay state without changing the profile lifecycle', () => {
        expect(
            resolveUpcomingResetAnnouncement(buildOperation('RUNNING'), new Date('2026-08-27T05:10:00.000Z'))
        ).toMatchObject({ phase: 'PREPARING' });
        expect(
            resolveUpcomingResetAnnouncement(buildOperation('RUNNING'), new Date('2026-08-27T05:31:00.000Z'))
        ).toMatchObject({ phase: 'DELAYED' });
    });

    it('keeps a completed build ready for RESERVED handoff and removes cancelled or failed announcements', () => {
        const succeeded = buildOperation('SUCCEEDED');
        expect(resolveUpcomingResetAnnouncement(succeeded, new Date('2026-08-27T05:20:00.000Z'))).toMatchObject({
            phase: 'READY',
        });
        expect(shouldExposeUpcomingReset(succeeded, 'RESERVED')).toBe(true);
        expect(shouldExposeUpcomingReset(succeeded, 'PREOPEN')).toBe(false);
        expect(shouldExposeUpcomingReset(succeeded, 'RUNNING')).toBe(false);
        for (const status of ['CANCELLED', 'FAILED'] as const) {
            expect(
                resolveUpcomingResetAnnouncement(buildOperation(status), new Date('2026-08-27T04:00:00.000Z'))
            ).toBeNull();
        }
    });

    it('fails closed for an unpublished or incomplete snapshot', () => {
        const unpublished = buildOperation();
        unpublished.payload = { publicAnnouncement: { enabled: false } };
        expect(resolveUpcomingResetAnnouncement(unpublished, new Date('2026-08-27T04:00:00.000Z'))).toBeNull();

        const incomplete = buildOperation();
        incomplete.payload = { publicAnnouncement: { enabled: true, scenarioTitle: '황건적의 난' } };
        expect(resolveUpcomingResetAnnouncement(incomplete, new Date('2026-08-27T04:00:00.000Z'))).toBeNull();
    });
});
