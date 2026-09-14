// Ref convertSearch초성: 원문, 두벌식 초성, 한글 초성, 두 단계 IME 겹자음 인덱스.
const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const keyboard = 'rRseEfaqQtTdwWczxvg';
const compoundPairs: Record<string, string> = {
    ㄱㅅ: 'ㄳ',
    ㄴㅈ: 'ㄵ',
    ㄴㅎ: 'ㄶ',
    ㄹㅂ: 'ㄼ',
    ㄹㄱ: 'ㄺ',
    ㄹㅅ: 'ㄽ',
    ㄹㅁ: 'ㄻ',
    ㄹㅎ: 'ㅀ',
    ㄹㅌ: 'ㄾ',
    ㄹㅍ: 'ㄿ',
    ㅂㅅ: 'ㅄ',
};
const doublePairs: Record<string, string> = { ㄱㄱ: 'ㄲ', ㄷㄷ: 'ㄸ', ㅂㅂ: 'ㅃ', ㅅㅅ: 'ㅆ', ㅈㅈ: 'ㅉ' };
const normalize = (text: string): string => text.normalize('NFC').toLowerCase().replace(/\s+/gu, '');
const combine = (text: string, doubles: boolean): string => {
    const chars = [...text];
    const result: string[] = [];
    for (let index = 0; index < chars.length; index += 1) {
        const pair = chars[index]! + (chars[index + 1] ?? '');
        const combined = compoundPairs[pair] ?? (doubles ? doublePairs[pair] : undefined);
        result.push(combined ?? chars[index]!);
        if (combined) index += 1;
    }
    return result.join('');
};

export const buildCommandTargetSearchIndex = (text: string): string[] => {
    const compact = text.normalize('NFC').replace(/\s+/gu, '');
    let hangul = '';
    let alphabet = '';
    for (const character of compact) {
        const code = character.charCodeAt(0) - 0xac00;
        const index = code >= 0 && code < 11172 ? Math.floor(code / 588) : -1;
        hangul += index >= 0 ? initials[index] : character;
        alphabet += index >= 0 ? keyboard[index] : character;
    }
    return [...new Set([compact, alphabet, hangul, combine(hangul, false), combine(hangul, true)].map(normalize))];
};

export const matchesCommandTargetSearch = (index: readonly string[], query: string): boolean => {
    const normalized = normalize(query);
    return index.some((text) => text.includes(normalized));
};
