import { z } from 'zod';

// PHP trim() removes only this default ASCII character list. JavaScript
// String#trim also removes Unicode spaces such as U+3000 and would reject a
// value that Ref accepts.
const hasLegacyTrimmedContent = (value: string): boolean => /[^ \t\n\r\0\v]/u.test(value);

export const legacyRequiredText = (maximumCodePoints: number) =>
    z
        .string()
        .refine(hasLegacyTrimmedContent, '필수 입력입니다.')
        .refine((value) => Array.from(value).length <= maximumCodePoints, `최대 ${maximumCodePoints}자까지 입력할 수 있습니다.`);
