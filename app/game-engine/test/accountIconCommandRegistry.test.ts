import { describe, expect, it } from 'vitest';

import type { TurnDaemonCommand } from '@sammo-ts/common';

import { normalizeTurnDaemonCommand } from '../src/turn/commandRegistry.js';

const normalize = (command: Record<string, unknown>) =>
    normalizeTurnDaemonCommand({
        requestId: 'icon-request',
        sentAt: '2026-07-31T09:00:00.000Z',
        command: command as unknown as TurnDaemonCommand,
    });

describe('adjustGeneralIcon command registry', () => {
    it('accepts only a canonical authenticated icon projection', () => {
        expect(
            normalize({
                type: 'adjustGeneralIcon',
                userId: 'user-1',
                picture: 'owner.png',
                imageServer: 1,
                iconRevision: '2026-07-31T09:00:00.000Z',
            })
        ).toEqual({
            type: 'adjustGeneralIcon',
            requestId: 'icon-request',
            userId: 'user-1',
            picture: 'owner.png',
            imageServer: 1,
            iconRevision: '2026-07-31T09:00:00.000Z',
        });
        expect(
            normalize({
                type: 'adjustGeneralIcon',
                requestId: 'icon-request',
                userId: 'user-1',
                picture: 'owner.png',
                imageServer: 1,
                iconRevision: '2026-07-31T09:00:00.000Z',
            })
        ).toEqual({
            type: 'adjustGeneralIcon',
            requestId: 'icon-request',
            userId: 'user-1',
            picture: 'owner.png',
            imageServer: 1,
            iconRevision: '2026-07-31T09:00:00.000Z',
        });
    });

    it.each([
        ['empty owner', { userId: '' }],
        ['empty picture', { picture: '' }],
        ['negative image server', { imageServer: -1 }],
        ['fractional image server', { imageServer: 1.5 }],
        ['noncanonical revision', { iconRevision: '2026-07-31T09:00:00Z' }],
        ['mismatched durable request ID', { requestId: 'different-request' }],
        ['unknown field', { generalId: 1 }],
    ])('rejects %s', (_label, override) => {
        expect(
            normalize({
                type: 'adjustGeneralIcon',
                userId: 'user-1',
                picture: 'owner.png',
                imageServer: 1,
                iconRevision: '2026-07-31T09:00:00.000Z',
                ...override,
            })
        ).toBeNull();
    });
});
