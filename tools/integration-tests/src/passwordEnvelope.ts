import { constants, publicEncrypt } from 'node:crypto';

export interface GatewayPasswordPublicKey {
    keyId: string;
    algorithm: 'RSA-OAEP-256';
    publicKeyPem: string;
}

export const sealGatewayPassword = (password: string, key: GatewayPasswordPublicKey) => ({
    keyId: key.keyId,
    ciphertext: publicEncrypt(
        {
            key: key.publicKeyPem,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        },
        Buffer.from(password, 'utf8')
    ).toString('base64'),
});
