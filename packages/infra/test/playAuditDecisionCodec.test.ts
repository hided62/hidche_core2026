import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeAuditDecisionSteps, encodeAuditDecisionSteps } from '../src/playAuditDecisionCodec.js';

describe('lossless audit decision storage', () => {
    it('compresses repeated context while preserving every value and its order', () => {
        const steps = Array.from({ length: 128 }, (_, sequence) => ({
            sequence,
            phase: 'general',
            generalId: 51,
            nationId: 3,
            cityId: 12,
            year: 190,
            month: 7,
            kind: 'RNG',
            value: sequence / 128,
            text: '판단·줄바꿈\n따옴표 " 그대로',
            empty: null,
        }));
        const stored = encodeAuditDecisionSteps(steps);
        expect(Array.isArray(stored)).toBe(false);
        expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(Buffer.byteLength(JSON.stringify(steps)) / 3);
        expect(decodeAuditDecisionSteps(stored)).toEqual(steps);
    });
    it('keeps tiny and historical uncompressed arrays readable', () => {
        expect(encodeAuditDecisionSteps([])).toEqual([]);
        expect(decodeAuditDecisionSteps([{ marker: 'legacy', sequence: 0 }])).toEqual([
            { marker: 'legacy', sequence: 0 },
        ]);
    });
    it('rejects unknown versions, bad base64, truncated gzip and invalid contents', () => {
        for (const value of [
            null,
            {},
            { encoding: 'gzip-json-v2', data: '' },
            { encoding: 'gzip-json-v1', data: '%%%' },
            { encoding: 'gzip-json-v1', data: 'YQ==' },
            { encoding: 'gzip-json-v1', data: gzipSync('{}').toString('base64') },
            { encoding: 'gzip-json-v1', data: gzipSync(JSON.stringify(Array(129).fill(null))).toString('base64') },
        ])
            expect(() => decodeAuditDecisionSteps(value)).toThrow();
        expect(() => encodeAuditDecisionSteps(Array(129).fill(null))).toThrow();
    });
    it('bounds decompression and preserves oversized raw records rather than truncating them', () => {
        const steps = [{ text: 'x'.repeat(16 * 1024 * 1024) }];
        expect(encodeAuditDecisionSteps(steps)).toEqual(steps);
        expect(() =>
            decodeAuditDecisionSteps({
                encoding: 'gzip-json-v1',
                data: gzipSync(JSON.stringify(steps)).toString('base64'),
            })
        ).toThrow('Corrupt');
    });
});
