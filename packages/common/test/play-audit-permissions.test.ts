import { describe, expect, it } from 'vitest';
import { canReadPlayAudit, canReadPlayAuditAccounts } from '../src/auth/playAudit.js';

describe('play audit capability scope', () => {
    it.each([
        'superuser',
        'admin.superuser',
        'admin.playAudit.read',
        'admin.playAudit.read:*',
        'admin.playAudit.read:che:default',
    ])('accepts explicit capability %s', (role) => expect(canReadPlayAudit([role], 'che:default')).toBe(true));
    it.each([
        'admin',
        'user',
        'admin.audit.read',
        'admin.profiles.runtime:che:default',
        'admin.playAudit.read:che',
        'admin.playAudit.read:hwe:default',
        'admin.playAudit.accounts',
    ])('rejects unrelated role %s', (role) => expect(canReadPlayAudit([role], 'che:default')).toBe(false));
    it('requires both scoped game audit and global account audit', () => {
        expect(canReadPlayAuditAccounts(['admin.playAudit.read:che:default'], 'che:default')).toBe(false);
        expect(
            canReadPlayAuditAccounts(['admin.playAudit.read:che:default', 'admin.playAudit.accounts'], 'che:default')
        ).toBe(true);
        expect(
            canReadPlayAuditAccounts(['admin.playAudit.read:che:default', 'admin.playAudit.accounts'], 'hwe:default')
        ).toBe(false);
    });
});
