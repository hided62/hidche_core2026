import type { BytesLike } from './BytesLike.js';

export function convertBytesLikeToUint8Array(data: BytesLike, encodeUTF8 = true): Uint8Array<ArrayBuffer> {
    if (data instanceof Uint8Array) {
        if (data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
            return data;
        }
        return new Uint8Array(data) as Uint8Array<ArrayBuffer>;
    }
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    if (data instanceof DataView) {
        return new Uint8Array<ArrayBuffer>(data.buffer, data.byteOffset, data.byteLength);
    }
    if (typeof data === 'string') {
        if (encodeUTF8) {
            return new TextEncoder().encode(data);
        }
        return new Uint8Array(data.split('').map((s) => s.codePointAt(0) as number));
    }
    throw new Error('Unsupported BytesLike');
}
