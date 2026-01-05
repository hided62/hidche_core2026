import { createHash, randomBytes } from 'node:crypto';

export interface PasswordHasher {
    createSalt(): string;
    hash(password: string, salt: string): string;
}

// 비밀번호 해싱은 임시 구현이므로 이후 안전한 KDF로 교체한다.
export const createSimplePasswordHasher = (): PasswordHasher => ({
    createSalt: () => randomBytes(16).toString('hex'),
    hash: (password: string, salt: string) => createHash('sha256').update(`${salt}:${password}`).digest('hex'),
});
