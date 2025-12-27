import type { BytesLike } from './BytesLike';

export function convertBytesLikeToArrayBuffer(data: BytesLike, encodeUTF8 = true): ArrayBuffer {
    if (data instanceof ArrayBuffer) {
        return data;
    }
    if (data instanceof Uint8Array) {
        return data.buffer;
    }
    if (typeof (data) === 'string') {
        if (encodeUTF8) {
            return (new TextEncoder()).encode(data).buffer;
        }
        return new Uint8Array(data.split('').map((s) => s.codePointAt(0) as number)).buffer;
    }
    return data.buffer;
}
