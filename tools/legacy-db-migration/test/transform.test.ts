import { describe, expect, it } from 'vitest';

import { legacyUserId } from '../src/identity.js';
import { classifyGameStorage, mapLegacyRoles, parseInheritanceValue, parseStorageUserId } from '../src/transform.js';

describe('legacy database transforms', () => {
    it('creates stable UUID-shaped user IDs without exposing the legacy sequence', () => {
        expect(legacyUserId(42)).toBe(legacyUserId(42));
        expect(legacyUserId(42)).not.toBe(legacyUserId(43));
        expect(legacyUserId(42)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('maps legacy grades and scoped ACL without granting a scoped operator superuser', () => {
        expect(mapLegacyRoles(7, {})).toContain('superuser');
        expect(mapLegacyRoles(5, {})).toEqual(['admin.users.create', 'admin.users.manage', 'user']);
        expect(mapLegacyRoles(1, { che: ['reset', 'notice'] })).toEqual([
            'admin.notice.manage:che:default',
            'admin.reset.schedule:che:default',
            'user',
        ]);
    });

    it('separates persistent storage projections from current-season state', () => {
        expect(classifyGameStorage('inheritance_42', 'previous')).toBe('persistent-projected');
        expect(classifyGameStorage('user_42', 'last_stat_reset')).toBe('persistent-projected');
        expect(classifyGameStorage('game_env', 'year')).toBe('season-state');
        expect(parseStorageUserId('inheritance_42', 'inheritance')).toBe(legacyUserId(42));
        expect(parseInheritanceValue('123.5', 'fixture')).toBe(123.5);
        expect(parseInheritanceValue([123.5, null], 'fixture')).toBe(123.5);
    });
});
