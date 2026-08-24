import type { Pool as MariaPool } from 'mariadb';
import type { Pool as PgPool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { upsertRows } from '../src/db.js';
import {
    mapMember,
    MEMBER_PRESERVED_COLUMNS,
    migrateGateway,
    normalizeLegacyIconPicture,
    preflightMemberConflicts,
} from '../src/gateway.js';

const memberRow = (overrides: Record<string, unknown> = {}) => ({
    NO: 7,
    GRADE: 1,
    acl: '{}',
    penalty: '{}',
    oauth_info: '{}',
    oauth_type: 'KAKAO',
    oauth_id: null,
    PW: 'a'.repeat(128),
    salt: 'member-salt',
    ID: 'LegacyUser',
    NAME: '레거시유저',
    EMAIL: 'USER@EXAMPLE.TEST',
    PICTURE: 'default.jpg',
    IMGSVR: 0,
    third_use: 0,
    token_valid_until: null,
    delete_after: null,
    REG_DATE: '2020-01-01 00:00:00',
    REG_NUM: 0,
    BLOCK_NUM: 0,
    BLOCK_DATE: null,
    ...overrides,
});

describe('legacy gateway member migration', () => {
    it('marks imported SHA-512 credentials for reset without trusting a missing Kakao ID', () => {
        const mapped = mapMember(memberRow(), new Date('2026-08-17T00:00:00.000Z'), null);

        expect(mapped).toMatchObject({
            login_id: 'legacyuser',
            email: 'user@example.test',
            password_reset_required: true,
            oauth_type: 'KAKAO',
            oauth_id: null,
            kakao_verified_at: null,
        });
    });

    it('removes only the Ref cache marker while preserving the original icon metadata', () => {
        const mapped = mapMember(
            memberRow({ PICTURE: 'users/core/' + 'a'.repeat(32) + '.png?=20260809', IMGSVR: 0 }),
            new Date('2026-08-17T00:00:00.000Z'),
            null
        );

        expect(normalizeLegacyIconPicture('legacy.png?=20260809')).toBe('legacy.png');
        expect(normalizeLegacyIconPicture('literal.png?other')).toBe('literal.png?other');
        expect(mapped).toMatchObject({
            picture: 'users/core/' + 'a'.repeat(32) + '.png',
            image_server: 0,
        });
        expect((mapped.legacy_data as { value: unknown }).value).toMatchObject({
            picture: 'users/core/' + 'a'.repeat(32) + '.png?=20260809',
            imageServer: 0,
        });
    });

    it('preserves target-owned credentials and OAuth state on a repeated member upsert', async () => {
        const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 0 }));
        const client = { query } as unknown as PoolClient;

        await upsertRows(
            client,
            'app_user',
            [
                {
                    id: 'legacy-id',
                    login_id: 'legacy-user',
                    password_hash: 'legacy-hash',
                    oauth_info: '{}',
                    legacy_data: '{}',
                },
            ],
            ['id'],
            { preserveOnConflict: ['password_hash', 'oauth_info'] }
        );

        const sql = String(query.mock.calls[0]?.[0]);
        expect(sql).toContain('"login_id" = EXCLUDED."login_id"');
        expect(sql).toContain('"legacy_data" = EXCLUDED."legacy_data"');
        expect(sql).not.toContain('"password_hash" = EXCLUDED."password_hash"');
        expect(sql).not.toContain('"oauth_info" = EXCLUDED."oauth_info"');
    });

    it('preserves renamed login and display identities along with every live credential field', () => {
        expect(MEMBER_PRESERVED_COLUMNS).toEqual(
            expect.arrayContaining([
                'login_id',
                'display_name',
                'password_hash',
                'password_salt',
                'password_reset_required',
                'roles',
                'sanctions',
                'oauth_id',
                'email',
                'updated_at',
                'last_login_at',
                'created_at',
            ])
        );
        expect(MEMBER_PRESERVED_COLUMNS).not.toContain('legacy_data');
    });

    it('rejects a source member when another target account already owns its identity', async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({
            rows: [
                {
                    id: 'another-target-id',
                    login_id: 'legacyuser',
                    display_name: '다른사용자',
                    email: 'other@example.test',
                },
            ],
            rowCount: 1,
        }));
        const client = { query } as unknown as PoolClient;
        const mapped = mapMember(memberRow({ oauth_id: 'stable-kakao-id' }), new Date('2026-08-17T00:00:00Z'), null);

        await expect(preflightMemberConflicts(client, [mapped])).rejects.toThrow(
            'Target account identity collision in legacy member batch'
        );
        expect(String(query.mock.calls[0]?.[0])).toContain('FROM "app_user"');
    });

    it('reads only new immutable member logs during an incremental dry-run', async () => {
        const fingerprint = 'a'.repeat(64);
        const seen = new Set<string>();
        const source = {
            query: vi.fn(async (sql: string, values: readonly unknown[] = []) => {
                if (sql.includes('MAX(`id`)') && sql.includes('member_log')) return [{ max_id: 2 }];
                if (sql.includes('MAX(`date`)')) return [];
                if (sql.includes('FROM `member`')) return [];
                if (sql.includes('FROM `member_log`')) {
                    if (seen.has('member_log')) return [];
                    seen.add('member_log');
                    return Number(values[0]) < 2
                        ? [
                              {
                                  id: 2,
                                  member_no: 7,
                                  date: new Date('2026-08-18T00:00:00.000Z'),
                                  action_type: 'login',
                                  action: null,
                              },
                          ]
                        : [];
                }
                return [];
            }),
        } as unknown as MariaPool;
        const query = vi.fn(async (sql: string) => {
            if (sql.includes('FROM "legacy_import_checkpoint"')) {
                return {
                    rows: [{ source_fingerprint: fingerprint, last_legacy_id: '1' }],
                    rowCount: 1,
                } as QueryResult;
            }
            return { rows: [], rowCount: 0 } as unknown as QueryResult;
        });
        const client = { query, release: vi.fn() } as unknown as PoolClient;
        const target = { connect: vi.fn(async () => client) } as unknown as PgPool;

        const summary = await migrateGateway(source, target, false, new Date('2026-08-18T00:00:00.000Z'), {
            mode: 'incremental',
            source: { key: 'fixture:gateway', fingerprint },
        });

        expect(summary.counts.member_log).toBe(1);
        expect(summary.progress?.member_log).toMatchObject({
            strategy: 'append',
            startAfterId: '1',
            endAtId: '2',
            processed: 1,
        });
        expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO "legacy_member_log"'))).toBe(false);
    });
});
