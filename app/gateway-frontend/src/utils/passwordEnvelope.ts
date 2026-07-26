import { trpc } from './trpc';

const pemToBuffer = (pem: string): ArrayBuffer => {
    const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
    const binary = window.atob(encoded);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return buffer;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return window.btoa(binary);
};

export const sealPassword = async (password: string): Promise<{ keyId: string; ciphertext: string }> => {
    const encoded = new TextEncoder().encode(password);
    if (Array.from(password).length < 6 || encoded.byteLength > 128) {
        throw new Error('비밀번호는 6자 이상, UTF-8 기준 128바이트 이하여야 합니다.');
    }
    if (!window.crypto?.subtle) {
        throw new Error('이 브라우저에서는 안전한 비밀번호 전송을 사용할 수 없습니다.');
    }
    const keyInfo = await trpc.auth.passwordKey.query();
    const publicKey = await window.crypto.subtle.importKey(
        'spki',
        pemToBuffer(keyInfo.publicKeyPem),
        {
            name: 'RSA-OAEP',
            hash: 'SHA-256',
        },
        false,
        ['encrypt']
    );
    const ciphertext = await window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, encoded);
    return {
        keyId: keyInfo.keyId,
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
};
