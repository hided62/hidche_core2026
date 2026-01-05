import type { BytesLike } from './BytesLike.js';

export function convertBytesLikeToArrayBuffer(data: BytesLike, encodeUTF8 = true): ArrayBuffer {
    if (data instanceof ArrayBuffer) {
        return data;
    }
    if (data instanceof Uint8Array) {
        if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer) {
            return data.buffer;
        }
        return data.slice().buffer;
    }
    if (data instanceof DataView) {
        const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return view.slice().buffer;
    }
    if (typeof data === 'string') {
        if (encodeUTF8) {
            return new TextEncoder().encode(data).buffer;
        }
        return new Uint8Array(data.split('').map((s) => s.codePointAt(0) as number)).buffer;
    }
    throw new Error('Unsupported BytesLike');
}
