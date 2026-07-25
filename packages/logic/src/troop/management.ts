import { asRecord } from '@sammo-ts/common';

export interface TroopPermissionGeneral {
    nationId: number;
    officerLevel: number;
    meta: unknown;
    penalty?: unknown;
}

const readNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const isFullWidthCodePoint = (codePoint: number): boolean =>
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
        codePoint === 0x2329 ||
        codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
        (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
        (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
        (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
        (codePoint >= 0xff01 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
        (codePoint >= 0x1b000 && codePoint <= 0x1b001) ||
        (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
        (codePoint >= 0x20000 && codePoint <= 0x3fffd));

// PHP mb_strwidth와 같은 전각 2/반각 1 기준으로 부대명 길이를 센다.
export const getLegacyStringWidth = (value: string): number => {
    let width = 0;
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) {
            continue;
        }
        if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
            continue;
        }
        width += isFullWidthCodePoint(codePoint) ? 2 : 1;
    }
    return width;
};

// 레거시 StringUtil::neutralize처럼 HTML 특수문자를 저장용 문자열로 바꾼 뒤
// 양 끝의 separator/control만 제거한다.
export const normalizeTroopName = (value: string): string =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replace(/^[\p{Z}\p{C}]+|[\p{Z}\p{C}]+$/gu, '');

export const isValidTroopNameWidth = (value: string): boolean => {
    const width = getLegacyStringWidth(value);
    return width >= 1 && width <= 18;
};

export const resolveTroopSecretPermission = (
    general: TroopPermissionGeneral,
    nationMeta: unknown,
    checkSecretLimit = false
): number => {
    if (general.nationId <= 0 || general.officerLevel === 0) {
        return -1;
    }

    const penalty = asRecord(general.penalty);
    if (penalty.noChief) {
        return 0;
    }

    const meta = asRecord(general.meta);
    const permission = meta.permission;
    const belong = readNumber(meta.belong, 0);
    const nation = asRecord(nationMeta);
    const secretLimit = readNumber(nation.secretlimit ?? nation.secretLimit, 3);

    let secretMax = 4;
    if (penalty.noTopSecret || penalty.noChief) {
        secretMax = 1;
    } else if (penalty.noAmbassador) {
        secretMax = 2;
    }

    let secretMin = 0;
    if (general.officerLevel === 12 || permission === 'ambassador') {
        secretMin = 4;
    } else if (permission === 'auditor') {
        secretMin = 3;
    } else if (general.officerLevel >= 5) {
        secretMin = 2;
    } else if (general.officerLevel > 1) {
        secretMin = 1;
    } else if (checkSecretLimit && belong >= secretLimit) {
        secretMin = 1;
    }

    return Math.min(secretMin, secretMax);
};
