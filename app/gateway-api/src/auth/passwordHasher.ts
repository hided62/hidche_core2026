import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface PasswordHasher {
    createSalt(): string;
    hash(password: string): Promise<{ hash: string; salt: string }>;
    verify(password: string, hash: string, salt: string): Promise<{ ok: boolean; needsUpgrade: boolean }>;
}

const ARGON2_MEMORY_KIB = 19 * 1024;
const ARGON2_PASSES = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_TAG_LENGTH = 32;
const ARGON2_PREFIX = `$argon2id$v=19$m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}$`;

const deriveArgon2id = (password: string, salt: Buffer): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        argon2(
            'argon2id',
            {
                message: Buffer.from(password, 'utf8'),
                nonce: salt,
                parallelism: ARGON2_PARALLELISM,
                tagLength: ARGON2_TAG_LENGTH,
                memory: ARGON2_MEMORY_KIB,
                passes: ARGON2_PASSES,
            },
            (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(result);
            }
        );
    });

const safeEqualHex = (left: string, right: string): boolean => {
    if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

const parseArgon2Hash = (hash: string): { salt: Buffer; expected: Buffer } | null => {
    if (!hash.startsWith(ARGON2_PREFIX)) {
        return null;
    }
    const encoded = hash.slice(ARGON2_PREFIX.length).split('$');
    if (encoded.length !== 2 || !encoded[0] || !encoded[1]) {
        return null;
    }
    try {
        const salt = Buffer.from(encoded[0], 'base64url');
        const expected = Buffer.from(encoded[1], 'base64url');
        if (salt.length < 16 || expected.length !== ARGON2_TAG_LENGTH) {
            return null;
        }
        return { salt, expected };
    } catch {
        return null;
    }
};

export const createPasswordHasher = (options: { legacyGlobalSalt?: string } = {}): PasswordHasher => ({
    createSalt: () => randomBytes(16).toString('hex'),
    hash: async (password) => {
        const salt = randomBytes(16);
        const derived = await deriveArgon2id(password, salt);
        return {
            hash: `${ARGON2_PREFIX}${salt.toString('base64url')}$${derived.toString('base64url')}`,
            salt: '',
        };
    },
    verify: async (password, hash, salt) => {
        const modern = parseArgon2Hash(hash);
        if (modern) {
            const actual = await deriveArgon2id(password, modern.salt);
            return {
                ok: timingSafeEqual(actual, modern.expected),
                needsUpgrade: false,
            };
        }

        if (/^[a-f0-9]{64}$/i.test(hash)) {
            const actual = createHash('sha256').update(`${salt}:${password}`).digest('hex');
            return { ok: safeEqualHex(actual, hash), needsUpgrade: true };
        }

        if (/^[a-f0-9]{128}$/i.test(hash) && options.legacyGlobalSalt) {
            const browserHash = createHash('sha512')
                .update(`${options.legacyGlobalSalt}${password}${options.legacyGlobalSalt}`)
                .digest('hex');
            const actual = createHash('sha512').update(`${salt}${browserHash}${salt}`).digest('hex');
            return { ok: safeEqualHex(actual, hash), needsUpgrade: true };
        }

        return { ok: false, needsUpgrade: false };
    },
});

// 기존 import 지점을 깨지 않되 새 계정은 Argon2id를 사용한다.
export const createSimplePasswordHasher = createPasswordHasher;
