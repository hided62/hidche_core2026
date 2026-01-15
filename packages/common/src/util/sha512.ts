import { sha512 as sha512Noble } from '@noble/hashes/sha2.js';

import type { createHash } from 'node:crypto';
import type { BytesLike } from './BytesLike.js';
import { convertBytesLikeToUint8Array } from './convertBytesLikeToUint8Array.js';

type NodeCreateHash = typeof createHash;

const isNode = typeof process !== 'undefined' && typeof process.versions?.node === 'string';

const nodeCryptoSpecifier = 'node:crypto';

let nodeCreateHash: NodeCreateHash | null = null;

if (isNode) {
    const nodeCrypto = await import(nodeCryptoSpecifier);
    nodeCreateHash = nodeCrypto.createHash as NodeCreateHash;
}

function normalizeUint8Array(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes as Uint8Array<ArrayBuffer>;
    }
    const out = new Uint8Array(bytes.byteLength);
    out.set(bytes);
    return out as Uint8Array<ArrayBuffer>;
}

export function sha512Bytes(data: BytesLike): Uint8Array<ArrayBuffer> {
    const input = convertBytesLikeToUint8Array(data);
    if (nodeCreateHash) {
        const digest = nodeCreateHash('sha512').update(input).digest();
        return normalizeUint8Array(digest);
    }
    return normalizeUint8Array(sha512Noble(input));
}

export function sha512ArrayBuffer(data: BytesLike): ArrayBuffer {
    return sha512Bytes(data).buffer;
}
