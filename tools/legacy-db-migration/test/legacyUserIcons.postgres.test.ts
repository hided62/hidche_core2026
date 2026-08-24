import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { legacyUserId } from '../src/identity.js';
import { syncImportedUserIcons, type PreparedLegacyUserIcon } from '../src/legacyUserIcons.js';

const databaseUrl = process.env.LEGACY_ICON_TEST_DATABASE_URL;

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

describe.skipIf(!databaseUrl)('legacy user icon PostgreSQL synchronization', () => {
    it('updates only an unchanged Ref selection and preserves newer Core state', async () => {
        const pool = new Pool({ connectionString: databaseUrl });
        const client = await pool.connect();
        const icons = [
            imported(700_001, 'first.png?=20260809', `users/core2026/${'1'.repeat(32)}.png`),
            imported(700_002, 'second.png?=20260809', `users/core2026/${'2'.repeat(32)}.png`),
            imported(700_003, 'third.png?=20260809', `users/core2026/${'3'.repeat(32)}.png`),
        ];
        try {
            await client.query('BEGIN');
            for (const [index, icon] of icons.entries()) {
                const currentPicture =
                    index === 0
                        ? icon.sourcePicture
                        : index === 1
                          ? `users/core2026/${'8'.repeat(32)}.png`
                          : 'default.jpg';
                await client.query(
                    `INSERT INTO "app_user"
                        ("id", "login_id", "display_name", "password_hash", "password_salt",
                         "updated_at", "picture", "image_server")
                     VALUES ($1, $2, $3, 'hash', 'salt', CURRENT_TIMESTAMP, $4, $5)`,
                    [icon.userId, `icon-test-${index}`, `아이콘테스트-${index}`, currentPicture, index === 0 ? 1 : 0]
                );
            }

            await expect(syncImportedUserIcons(client, icons, new Date('2026-08-24T00:00:00Z'))).resolves.toEqual({
                currentLinked: 1,
                libraryInserted: 3,
                libraryRetired: 1,
                targetPreserved: 2,
            });
            const accounts = await client.query<{ id: string; picture: string; image_server: number }>(
                `SELECT "id", "picture", "image_server" FROM "app_user"
                 WHERE "id" = ANY($1::text[]) ORDER BY "login_id"`,
                [icons.map((icon) => icon.userId)]
            );
            expect(accounts.rows.map(({ picture, image_server: imageServer }) => ({ picture, imageServer }))).toEqual([
                { picture: icons[0]!.picture, imageServer: 0 },
                { picture: `users/core2026/${'8'.repeat(32)}.png`, imageServer: 0 },
                { picture: 'default.jpg', imageServer: 0 },
            ]);
            const library = await client.query<{ picture: string; retired_at: Date | null }>(
                `SELECT "picture", "retired_at" FROM "user_icon"
                 WHERE "user_id" = ANY($1::text[]) ORDER BY "picture"`,
                [icons.map((icon) => icon.userId)]
            );
            expect(library.rows).toHaveLength(3);
            expect(library.rows.filter((row) => row.retired_at !== null)).toHaveLength(1);
        } finally {
            await client.query('ROLLBACK');
            client.release();
            await pool.end();
        }
    });
});
