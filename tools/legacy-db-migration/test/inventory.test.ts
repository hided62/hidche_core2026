import { describe, expect, it } from 'vitest';

import type { ResolvedMigrationStage } from '../src/config.js';
import { migrationInventoryForStage } from '../src/inventory.js';

const gameStage = (withBattleResults: boolean): ResolvedMigrationStage => ({
    kind: 'game',
    name: 'che',
    profile: 'che',
    sourceUrl: 'mariadb://source.invalid/che',
    targetUrl: 'postgresql://target.invalid/game',
    sourceIdentity: { key: 'fixture:che', fingerprint: 'a'.repeat(64) },
    ...(withBattleResults
        ? {
              battleResults: {
                  kind: 'ssh' as const,
                  directory: '/srv/sammo/che/logs/preserved',
                  sshHost: 'serv',
                  identity: { key: 'fixture:che:battle-results', fingerprint: 'b'.repeat(64) },
              },
          }
        : {}),
});

describe('migration plan inventory', () => {
    it('lists each gateway item with its transferred information', () => {
        const inventory = migrationInventoryForStage({
            kind: 'gateway',
            name: 'gateway',
            sourceUrl: 'mariadb://source.invalid/root',
            targetUrl: 'postgresql://target.invalid/gateway',
            sourceIdentity: { key: 'fixture:gateway', fingerprint: 'a'.repeat(64) },
        });

        expect(inventory.map((item) => item.source)).toEqual([
            'member',
            'member_log',
            'banned_member',
            'storage',
            'system',
        ]);
        expect(inventory.every((item) => item.contents.length > 0)).toBe(true);
    });

    it('lists batres only when that filesystem source is configured', () => {
        expect(migrationInventoryForStage(gameStage(false)).some((item) => item.strategy === 'filesystem-season')).toBe(
            false
        );
        expect(migrationInventoryForStage(gameStage(true))).toContainEqual(
            expect.objectContaining({
                source: 'logs/preserved/<server_id>/batres<general_no>.txt',
                strategy: 'filesystem-season',
                contents: expect.stringContaining('batlog 페이즈 상세는 제외'),
            })
        );
    });
});
