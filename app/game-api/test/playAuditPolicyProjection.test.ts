import { describe, expect, it } from 'vitest';
import { projectPolicyConfiguration } from '../src/router/playAudit/policies.js';

const row = {
    id: 'policy',
    schemaVersion: 1,
    nationId: 2,
    area: 'DEFENCE',
    revision: 2,
    previousId: 'baseline',
    source: 'CHANGE',
    year: 190,
    month: 2,
    tick: 99,
    ordinal: 18,
    actor: {
        userId: 'private-account',
        generalId: 3,
        name: '당시군주',
        nationId: 2,
        officerLevel: 12,
        npcState: 0,
        permission: 4,
        debug: 'internal',
    },
    createdAt: new Date('2026-09-16T00:00:00Z'),
    before: { scout: 0 },
    after: { scout: 1 },
    requestId: 'internal-request',
    inputSequence: 123n,
};

describe('policy public configuration boundary', () => {
    it('retains historical office and values while excluding account and admin diagnostics', () => {
        const projection = projectPolicyConfiguration(row);
        expect(projection).toMatchObject({
            nationId: 2,
            revision: 2,
            actor: { generalId: 3, officerLevel: 12 },
            fields: [{ key: 'scout', beforeJson: '0', afterJson: '1', changed: true }],
        });
        const serialized = JSON.stringify(projection);
        for (const excluded of [
            'private-account',
            'permission',
            'debug',
            'internal-request',
            'inputSequence',
            'tick',
            'ordinal',
        ])
            expect(serialized).not.toContain(excluded);
    });
    it('refuses an unsupported record schema rather than guessing its meaning', () => {
        expect(() => projectPolicyConfiguration({ ...row, schemaVersion: 2 })).toThrow('지원하지 않는 정책 기록 버전');
    });
    it('distinguishes unobserved baseline from a recorded inherited setting', () => {
        expect(
            projectPolicyConfiguration({
                ...row,
                source: 'BASELINE',
                actor: null,
                before: null,
                after: { scout: null },
            }).fields
        ).toEqual([{ key: 'scout', beforeJson: null, afterJson: 'null', changed: false }]);
    });
});
