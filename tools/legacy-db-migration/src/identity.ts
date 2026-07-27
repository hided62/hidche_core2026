import { createHash } from 'node:crypto';

const LEGACY_USER_NAMESPACE = 'sammo-ts:legacy-root-member:v1';

export const legacyUserId = (memberNo: number): string => {
    if (!Number.isSafeInteger(memberNo) || memberNo <= 0) {
        throw new Error(`Legacy member number must be a positive safe integer: ${memberNo}`);
    }

    const bytes = createHash('sha256').update(`${LEGACY_USER_NAMESPACE}:${memberNo}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
