import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';

import type { PoolClient, QueryResult } from 'pg';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { legacyUserId } from '../src/identity.js';
import {
    prepareLegacyUserIcons,
    syncImportedUserIcons,
    syncRejectedUserIcons,
    type LegacyUserIconTransferConfig,
    type PreparedLegacyUserIcon,
} from '../src/legacyUserIcons.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
});

const createFixture = async (): Promise<{ config: LegacyUserIconTransferConfig; png: Buffer }> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sammo-user-icons-'));
    temporaryDirectories.push(directory);
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#336699ff' } })
        .png()
        .toBuffer();
    await writeFile(path.join(directory, 'legacy.png'), png);
    return {
        config: {
            sourceDirectory: directory,
            uploadBaseUrl: 'https://upload.test',
            publicBaseUrl: 'https://public.test/icons',
            uploadSecret: 's'.repeat(32),
            excludedMemberNumbers: [],
        },
        png,
    };
};

const sourceRow = (overrides: Record<string, unknown> = {}) => ({
    NO: 7,
    PICTURE: 'legacy.png?=20260809',
    IMGSVR: 1,
    REG_DATE: '2020-01-01 00:00:00',
    ...overrides,
});

describe('legacy user icon transfer', () => {
    it('validates a Ref file and derives a deterministic API path without writing during dry-run', async () => {
        const { config } = await createFixture();
        const fetchImpl = vi.fn<typeof fetch>();

        const first = await prepareLegacyUserIcons([sourceRow()], config, false, { fetchImpl });
        const second = await prepareLegacyUserIcons([sourceRow()], config, false, { fetchImpl });

        expect(first.counts).toEqual({
            custom: 1,
            legacyFiles: 1,
            existingUploads: 0,
            uploaded: 0,
            rejected: 0,
        });
        expect(first.icons.get(7)?.picture).toMatch(/^users\/core2026\/[a-f0-9]{32}\.png$/u);
        expect(second.icons.get(7)?.picture).toBe(first.icons.get(7)?.picture);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('uploads through the signed API and accepts only the exact returned path', async () => {
        const { config, png } = await createFixture();
        const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
            const pathname = new URL(String(input)).pathname;
            const headers = new Headers(init?.headers);
            const expires = headers.get('x-image-expires')!;
            const requestId = headers.get('x-image-request-id')!;
            const contentType = headers.get('content-type')!;
            const expectedSignature = createHmac('sha256', config.uploadSecret)
                .update(
                    `${expires}.${requestId}.${pathname}.${contentType}.${createHash('sha256').update(png).digest('hex')}`
                )
                .digest('hex');
            expect(init?.method).toBe('PUT');
            expect(Buffer.from(init?.body as Uint8Array)).toEqual(png);
            expect(headers.get('x-image-client')).toBe('core2026');
            expect(headers.get('x-image-signature')).toBe(expectedSignature);
            return new Response(JSON.stringify({ path: pathname.replace('/v1/uploads/user-icons/', 'icons/users/') }), {
                status: 201,
                headers: { 'content-type': 'application/json' },
            });
        });

        const result = await prepareLegacyUserIcons([sourceRow()], config, true, {
            fetchImpl,
            now: () => Date.parse('2026-08-24T00:00:00.000Z'),
        });

        expect(result.counts.uploaded).toBe(1);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(result.icons.get(7)?.picture).toMatch(/^users\/core2026\/[a-f0-9]{32}\.png$/u);
    });

    it('validates all source files before starting any permanent upload', async () => {
        const { config } = await createFixture();
        const fetchImpl = vi.fn<typeof fetch>();

        await expect(
            prepareLegacyUserIcons(
                [sourceRow(), sourceRow({ NO: 8, PICTURE: 'missing.png?=20260809' })],
                config,
                true,
                { fetchImpl }
            )
        ).rejects.toThrow();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('verifies an existing sam-image object without uploading it again', async () => {
        const { config, png } = await createFixture();
        const picture = `users/core/${'a'.repeat(32)}.png`;
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(png, { status: 200 }));

        const result = await prepareLegacyUserIcons(
            [sourceRow({ PICTURE: `${picture}?=20260809`, IMGSVR: 0 })],
            config,
            true,
            { fetchImpl }
        );

        expect(result.counts).toEqual({
            custom: 1,
            legacyFiles: 0,
            existingUploads: 1,
            uploaded: 0,
            rejected: 0,
        });
        expect(result.icons.get(7)?.picture).toBe(picture);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`https://public.test/icons/${picture}`);
    });

    it('fails closed when custom icons exist without an API transfer configuration', async () => {
        await expect(prepareLegacyUserIcons([sourceRow()], undefined, false)).rejects.toThrow(
            'gateway.userIcons is not configured'
        );
    });

    it('permits only an explicitly reviewed member exclusion whose bytes remain invalid', async () => {
        const { config } = await createFixture();
        const invalidGif = await sharp({
            create: { width: 64, height: 65, channels: 4, background: '#336699ff' },
        })
            .gif()
            .toBuffer();
        await writeFile(path.join(config.sourceDirectory, 'invalid.gif'), invalidGif);
        config.excludedMemberNumbers = [7];

        const result = await prepareLegacyUserIcons([sourceRow({ PICTURE: 'invalid.gif?=20260809' })], config, true, {
            fetchImpl: vi.fn<typeof fetch>(),
        });

        expect(result.counts).toEqual({
            custom: 1,
            legacyFiles: 0,
            existingUploads: 0,
            uploaded: 0,
            rejected: 1,
        });
        expect(result.rejected.get(7)?.reason).toContain('square image');
        expect(result.icons.size).toBe(0);
    });

    it('rejects a stale exclusion when the configured member icon is valid', async () => {
        const { config } = await createFixture();
        config.excludedMemberNumbers = [7];

        await expect(prepareLegacyUserIcons([sourceRow()], config, false)).rejects.toThrow(
            'configured as excluded but its icon is valid'
        );
    });

    it('links an unchanged Ref selection while preserving newer Core selections', async () => {
        const imported = (memberNo: number, sourcePicture: string, picture: string): PreparedLegacyUserIcon => ({
            memberNo,
            userId: legacyUserId(memberNo),
            sourcePicture,
            normalizedSourcePicture: sourcePicture.replace(/\?=[0-9]{8}$/u, ''),
            sourceImageServer: 1,
            picture,
            imageServer: 0,
            createdAt: new Date('2026-08-09T00:00:00.000Z'),
            source: 'legacy-file',
            sha256: 'a'.repeat(64),
        });
        const icons = [
            imported(7, 'first.png?=20260809', `users/core2026/${'1'.repeat(32)}.png`),
            imported(8, 'second.png?=20260809', `users/core2026/${'2'.repeat(32)}.png`),
            imported(9, 'third.png?=20260809', `users/core2026/${'3'.repeat(32)}.png`),
        ];
        const query = vi.fn(async (sql: string, _parameters?: readonly unknown[]) => {
            if (sql.includes('FROM "app_user"')) {
                return {
                    rows: [
                        { id: legacyUserId(7), picture: 'first.png?=20260809', image_server: 1 },
                        { id: legacyUserId(8), picture: `users/core2026/${'8'.repeat(32)}.png`, image_server: 0 },
                        { id: legacyUserId(9), picture: 'default.jpg', image_server: 0 },
                    ],
                    rowCount: 3,
                } as QueryResult;
            }
            if (sql.includes('JOIN unnest')) return { rows: [], rowCount: 0 } as unknown as QueryResult;
            return { rows: [], rowCount: 1 } as unknown as QueryResult;
        });
        const target = { query } as unknown as PoolClient;

        await expect(syncImportedUserIcons(target, icons, new Date('2026-08-24T00:00:00Z'))).resolves.toEqual({
            currentLinked: 1,
            libraryInserted: 3,
            libraryRetired: 1,
            targetPreserved: 2,
        });
        const inserts = query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO "user_icon"'));
        expect(inserts).toHaveLength(3);
        expect(inserts[2]?.[1]?.[3]).toEqual(new Date('2026-08-24T00:00:00Z'));
    });

    it('resets only the still-selected invalid Ref icon', async () => {
        const userId = legacyUserId(7);
        const rejected = {
            memberNo: 7,
            userId,
            sourcePicture: 'invalid.gif?=20260809',
            normalizedSourcePicture: 'invalid.gif',
            sourceImageServer: 1,
            reason: 'not square',
        };
        const query = vi.fn(async (sql: string, _parameters?: readonly unknown[]) => {
            if (sql.includes('FROM "app_user"')) {
                return {
                    rows: [{ id: userId, picture: rejected.sourcePicture, image_server: 1 }],
                    rowCount: 1,
                } as QueryResult;
            }
            return { rows: [], rowCount: 1 } as unknown as QueryResult;
        });

        await expect(
            syncRejectedUserIcons({ query } as unknown as PoolClient, [rejected], new Date('2026-08-24T00:00:00Z'))
        ).resolves.toEqual({ currentReset: 1, targetPreserved: 0 });
        expect(String(query.mock.calls[1]?.[0])).toContain(`SET "picture" = 'default.jpg'`);
    });
});
