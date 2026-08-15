import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { PasswordEnvelopeInput, PasswordEnvelopeService } from './passwordEnvelope.js';

const utf8Length = (value: string): number => Buffer.byteLength(value, 'utf8');

const isWideCodePoint = (codePoint: number): boolean =>
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
        codePoint === 0x2329 ||
        codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
        (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
        (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
        (codePoint >= 0x20000 && codePoint <= 0x3fffd));

const legacyStringWidth = (value: string): number =>
    Array.from(value).reduce((width, character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return width + (isWideCodePoint(codePoint) ? 2 : 1);
    }, 0);

export const zPasswordEnvelope = z.object({
    keyId: z.string().min(1).max(128),
    ciphertext: z.string().min(1).max(4096),
});

export const zRegistrationUsername = z
    .string()
    .trim()
    .transform((value) => value.toLocaleLowerCase('en-US'))
    .superRefine((value, context) => {
        const length = utf8Length(value);
        if (length < 4 || length > 64) {
            context.addIssue({
                code: 'custom',
                message: '계정명은 UTF-8 기준 4~64바이트여야 합니다.',
            });
        }
    });

export const zDisplayName = z
    .string()
    .trim()
    .superRefine((value, context) => {
        const width = legacyStringWidth(value);
        if (width < 1 || width > 18) {
            context.addIssue({
                code: 'custom',
                message: '닉네임은 영문 기준 1~18자 너비여야 합니다.',
            });
        }
    });

export const openPassword = (service: PasswordEnvelopeService, envelope: PasswordEnvelopeInput): string => {
    let password: string;
    try {
        password = service.open(envelope);
    } catch (error) {
        throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : '비밀번호 봉인을 열 수 없습니다.',
        });
    }
    if (Array.from(password).length < 6 || Buffer.byteLength(password, 'utf8') > 128) {
        throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '비밀번호는 6자 이상, UTF-8 기준 128바이트 이하여야 합니다.',
        });
    }
    return password;
};
