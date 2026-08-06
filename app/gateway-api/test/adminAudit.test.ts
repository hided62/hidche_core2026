import { describe, expect, it } from 'vitest';

import { buildAdminAuditTarget, sanitizeAdminAuditValue } from '../src/adminAudit.js';

describe('administrator audit sanitization', () => {
    it('redacts credentials recursively while preserving operational context', () => {
        expect(
            sanitizeAdminAuditValue({
                username: 'target',
                password: 'secret',
                nested: { authorization: 'Bearer token', notes: 'approved' },
            })
        ).toEqual({
            username: 'target',
            password: '[REDACTED]',
            nested: { authorization: '[REDACTED]', notes: 'approved' },
        });
    });

    it('extracts a user target and reason without retaining the supplied password', () => {
        expect(
            buildAdminAuditTarget({
                userId: 'user-1',
                reason: 'account recovery',
                newPassword: 'replacement-secret',
            })
        ).toMatchObject({
            targetType: 'USER',
            targetId: 'user-1',
            reason: 'account recovery',
            summary: { newPassword: '[REDACTED]' },
        });
    });
});
