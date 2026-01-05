export type JosaKey = '은' | '이' | '과' | '이나' | '을' | '으로' | '이라' | '이랑';

const DEFAULT_POSTPOSITION: Record<JosaKey, string> = {
    은: '는',
    이: '가',
    과: '와',
    이나: '나',
    을: '를',
    으로: '로',
    이라: '라',
    이랑: '랑',
};

const buildMapPostPosition = (): Record<string, JosaKey> => {
    const map: Record<string, JosaKey> = {};
    for (const [key, value] of Object.entries(DEFAULT_POSTPOSITION)) {
        const k = key as JosaKey;
        map[key] = k;
        map[value] = k;
        map[`(${key})${value}`] = k;
    }
    return map;
};

const MAP_POSTPOSITION = buildMapPostPosition();

const REG_INVALID_CHAR = /[^a-zA-Z0-9ㄱ-ㅎ가-힣一-廓\s]+/gu;
const REG_TARGET_CHAR = /^[\s\S]*?(\S*)\s*$/u;

const KO_START_CODE = 0xac00;
const KO_FINISH_CODE = 0xd7a3;
const JONGSUNG_RIEUL = 8;

const getLastChar = (text: string): string => {
    const cleaned = text.replace(REG_INVALID_CHAR, ' ').replace(REG_TARGET_CHAR, '$1').trim();
    if (!cleaned) {
        return '';
    }
    const chars = Array.from(cleaned);
    return chars[chars.length - 1] ?? '';
};

const getDigitJongsung = (digit: number): { has: boolean; rieul: boolean } => {
    switch (digit) {
        case 0:
        case 3:
        case 6:
            return { has: true, rieul: false };
        case 1:
        case 7:
        case 8:
            return { has: true, rieul: true };
        default:
            return { has: false, rieul: false };
    }
};

const hasJongsung = (text: string, isRo: boolean): boolean => {
    const lastChar = getLastChar(text);
    if (!lastChar) {
        return false;
    }
    const code = lastChar.codePointAt(0);
    if (code === undefined) {
        return false;
    }
    if (code >= KO_START_CODE && code <= KO_FINISH_CODE) {
        const jongsung = (code - KO_START_CODE) % 28;
        if (jongsung === 0) {
            return false;
        }
        if (isRo && jongsung === JONGSUNG_RIEUL) {
            return false;
        }
        return true;
    }
    if (lastChar >= 'ㄱ' && lastChar <= 'ㅎ') {
        if (isRo && lastChar === 'ㄹ') {
            return false;
        }
        return true;
    }
    if (lastChar >= '0' && lastChar <= '9') {
        const { has, rieul } = getDigitJongsung(Number(lastChar));
        if (isRo && rieul) {
            return false;
        }
        return has;
    }
    const lower = lastChar.toLowerCase();
    const isVowel = ['a', 'e', 'i', 'o', 'u', 'y'].includes(lower);
    return !isVowel;
};

export class JosaUtil {
    static pick(text: string | null | undefined, wJongsung: string, woJongsung = ''): string {
        const normalizedText = text ?? '';
        let withJongsung = wJongsung;
        let withoutJongsung = woJongsung;

        if (!withoutJongsung) {
            const mapped = MAP_POSTPOSITION[wJongsung];
            if (!mapped) {
                throw new Error('올바르지 않은 조사 지정');
            }
            withJongsung = mapped;
            withoutJongsung = DEFAULT_POSTPOSITION[mapped];
        }

        const isRo = withJongsung === '으로';
        return hasJongsung(normalizedText, isRo) ? withJongsung : withoutJongsung;
    }

    static put(text: string, wJongsung: string, woJongsung = ''): string {
        return text + JosaUtil.pick(text, wJongsung, woJongsung);
    }
}
