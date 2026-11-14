import { gzipSync, gunzipSync } from 'node:zlib';
import type { InputJsonValue } from './turnEngineDb.js';

const ENCODING = 'gzip-json-v1';
const MAX_STEPS = 128;
const MAX_BYTES = 16 * 1024 * 1024;

/** 조회/재실행 hash에 쓰는 원문은 바꾸지 않고 저장할 때만 무손실 압축한다. */
export const encodeAuditDecisionSteps = (steps: readonly InputJsonValue[]): InputJsonValue => {
    if (steps.length > MAX_STEPS) throw new Error('Audit decision chunk exceeds its step limit');
    const json = JSON.stringify(steps);
    // 드문 초대형 기존 payload도 버리거나 자르지 않는다. 압축 reader 상한 밖이면 원래 형식으로 저장한다.
    if (Buffer.byteLength(json) > MAX_BYTES) return steps.slice();
    const encoded = { encoding: ENCODING, data: gzipSync(json, { level: 3 }).toString('base64') };
    return Buffer.byteLength(JSON.stringify(encoded)) < Buffer.byteLength(json) ? encoded : steps.slice();
};

/** 이전 JSONB 배열과 압축 형식을 함께 읽는다. 손상/알 수 없는 버전은 빈 기록으로 숨기지 않는다. */
export const decodeAuditDecisionSteps = (value: unknown): unknown[] => {
    if (Array.isArray(value)) {
        if (value.length > MAX_STEPS) throw new Error('Audit decision chunk exceeds its step limit');
        return value;
    }
    if (!value || typeof value !== 'object' || !('encoding' in value) || !('data' in value))
        throw new Error('Invalid audit decision storage');
    if (
        value.encoding !== ENCODING ||
        typeof value.data !== 'string' ||
        value.data.length > Math.ceil(MAX_BYTES / 3) * 4 + 256 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)
    )
        throw new Error('Invalid audit decision encoding');
    let decoded: unknown;
    try {
        decoded = JSON.parse(
            gunzipSync(Buffer.from(value.data, 'base64'), { maxOutputLength: MAX_BYTES }).toString('utf8')
        );
    } catch {
        // DB 원문이나 압축 payload가 오류 응답/로그에 포함되지 않게 한다.
        throw new Error('Corrupt audit decision storage');
    }
    if (!Array.isArray(decoded) || decoded.length > MAX_STEPS) throw new Error('Invalid audit decision steps');
    return decoded;
};
