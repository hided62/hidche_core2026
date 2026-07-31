import { constants, createHash, publicEncrypt } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';
import { createPasswordHasher } from '../src/auth/passwordHasher.js';

describe('password credential compatibility', () => {
    it('seals browser passwords with RSA-OAEP before opening them at the gateway', () => {
        const service = createPasswordEnvelopeService();
        const publicKey = service.getPublicKey();
        const ciphertext = publicEncrypt(
            {
                key: publicKey.publicKeyPem,
                padding: constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256',
            },
            Buffer.from('터널에-보이지-않는-비밀번호', 'utf8')
        ).toString('base64');

        expect(ciphertext).not.toContain('비밀번호');
        expect(service.open({ keyId: publicKey.keyId, ciphertext })).toBe('터널에-보이지-않는-비밀번호');
        expect(() => service.open({ keyId: 'stale-key', ciphertext })).toThrow(/key has changed/i);
        expect(() => service.open({ keyId: publicKey.keyId, ciphertext: '*not-base64*' })).toThrow(/base64/i);
    });

    it('upgrades the former core SHA-256 credential after a successful login', async () => {
        const hasher = createPasswordHasher();
        const users = createInMemoryUserRepository(hasher);
        const user = await users.createUser({
            username: 'core-legacy',
            password: 'current-password',
        });
        user.passwordSalt = 'core-salt';
        user.passwordHash = createHash('sha256').update('core-salt:current-password').digest('hex');

        expect(await users.verifyPassword(user, 'current-password')).toBe(true);
        expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
        expect(user.passwordSalt).toBe('');
    });

    it('upgrades an imported ref double-SHA-512 credential after a successful login', async () => {
        const globalSalt = 'ref-global-salt';
        const hasher = createPasswordHasher({ legacyGlobalSalt: globalSalt });
        const users = createInMemoryUserRepository(hasher);
        const user = await users.createUser({
            username: 'ref-legacy',
            password: 'current-password',
        });
        const userSalt = 'ref-user-salt';
        const browserHash = createHash('sha512').update(`${globalSalt}current-password${globalSalt}`).digest('hex');
        user.passwordSalt = userSalt;
        user.passwordHash = createHash('sha512').update(`${userSalt}${browserHash}${userSalt}`).digest('hex');

        expect(await users.verifyPassword(user, 'current-password')).toBe(true);
        expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
        expect(user.passwordSalt).toBe('');
    });

    it('does not accept an imported ref credential without the matching global salt', async () => {
        const users = createInMemoryUserRepository(createPasswordHasher());
        const user = await users.createUser({
            username: 'ref-no-salt',
            password: 'current-password',
        });
        user.passwordSalt = 'ref-user-salt';
        user.passwordHash = 'a'.repeat(128);

        expect(await users.verifyPassword(user, 'current-password')).toBe(false);
        expect(user.passwordHash).toBe('a'.repeat(128));
    });
});
