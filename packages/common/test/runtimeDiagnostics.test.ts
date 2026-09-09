import { describe, expect, it } from 'vitest';
import { describeRuntimeError } from '../src/gateway/runtimeDiagnostics.js';

describe('runtime failure records', () => {
    it('keeps the cause and frames while removing connection and authentication values', () => {
        const error = new Error(
            'database failed postgresql://admin:private@host/db password="hidden value" token=abc Bearer xyz'
        );
        error.stack = `${error.message}\n    at flush (/srv/app/flush.ts:42:7)`;
        const record = describeRuntimeError(error);
        expect(record.code).toBe('Error');
        expect(record.message).toContain('database failed');
        for (const secret of ['private', 'hidden value', 'abc', 'xyz'])
            expect(JSON.stringify(record)).not.toContain(secret);
        expect(record.frames).toEqual(['    at flush (/srv/app/flush.ts:42:7)']);
    });
    it('bounds untrusted messages and stack depth', () => {
        const error = new Error('x'.repeat(4000));
        error.stack = Array.from({ length: 30 }, () => ' at run (/app/run.ts:1:1)').join('\n');
        expect(describeRuntimeError(error).message).toHaveLength(2000);
        expect(describeRuntimeError(error).frames).toHaveLength(8);
    });
});
