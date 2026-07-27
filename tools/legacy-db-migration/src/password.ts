import { argon2, randomBytes } from 'node:crypto';

const MEMORY_KIB = 19 * 1024;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;
const PREFIX = `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$`;

export const hashPasswordForReset = async (password: string): Promise<{ hash: string; salt: string }> => {
    const salt = randomBytes(16);
    const derived = await new Promise<Buffer>((resolve, reject) => {
        argon2(
            'argon2id',
            {
                message: Buffer.from(password, 'utf8'),
                nonce: salt,
                parallelism: PARALLELISM,
                tagLength: TAG_LENGTH,
                memory: MEMORY_KIB,
                passes: PASSES,
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
    return {
        hash: `${PREFIX}${salt.toString('base64url')}$${derived.toString('base64url')}`,
        salt: '',
    };
};
