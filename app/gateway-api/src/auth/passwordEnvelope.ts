import {
    createHash,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    privateDecrypt,
    type KeyObject,
    constants,
} from 'node:crypto';

export interface PasswordEnvelopeInput {
    keyId: string;
    ciphertext: string;
}

export interface PasswordPublicKey {
    keyId: string;
    algorithm: 'RSA-OAEP-256';
    publicKeyPem: string;
}

export interface PasswordEnvelopeService {
    getPublicKey(): PasswordPublicKey;
    open(input: PasswordEnvelopeInput): string;
}

const MAX_PASSWORD_BYTES = 128;

const buildKeyId = (publicKey: KeyObject): string =>
    createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('base64url').slice(0, 22);

const decodeUtf8 = (value: Buffer): string => {
    if (value.length === 0 || value.length > MAX_PASSWORD_BYTES) {
        throw new Error('Password envelope has an invalid length.');
    }
    const decoded = value.toString('utf8');
    if (!Buffer.from(decoded, 'utf8').equals(value)) {
        throw new Error('Password envelope is not valid UTF-8.');
    }
    return decoded;
};

export const createPasswordEnvelopeService = (privateKeyPem?: string): PasswordEnvelopeService => {
    const privateKey = privateKeyPem
        ? createPrivateKey(privateKeyPem)
        : generateKeyPairSync('rsa', {
              modulusLength: 3072,
              publicExponent: 0x10001,
          }).privateKey;
    const publicKey = createPublicKey(privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const keyId = buildKeyId(publicKey);
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

    return {
        getPublicKey: () => ({
            keyId,
            algorithm: 'RSA-OAEP-256',
            publicKeyPem,
        }),
        open: (input) => {
            if (input.keyId !== keyId) {
                throw new Error('Password encryption key has changed.');
            }
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.ciphertext)) {
                throw new Error('Password envelope is not valid base64.');
            }
            let ciphertext: Buffer;
            try {
                ciphertext = Buffer.from(input.ciphertext, 'base64');
            } catch {
                throw new Error('Password envelope is not valid base64.');
            }
            if (!ciphertext.length) {
                throw new Error('Password envelope is empty.');
            }
            const plaintext = privateDecrypt(
                {
                    key: privateKey,
                    padding: constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256',
                },
                ciphertext
            );
            return decodeUtf8(plaintext);
        },
    };
};
