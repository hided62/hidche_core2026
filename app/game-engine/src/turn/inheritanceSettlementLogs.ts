import {
    REBIRTH_INHERITANCE_COEFFICIENTS,
    type MergedInheritanceKey,
} from '@sammo-ts/logic/inheritance/pointCalculation.js';

const LEGACY_KEY_ORDER = [
    'lived_month',
    'max_belong',
    'max_domestic_critical',
    'active_action',
    'combat',
    'sabotage',
    'unifier',
    'dex',
    'tournament',
    'betting',
] as const satisfies readonly MergedInheritanceKey[];

const LEGACY_CALCULATED_KEYS = new Set<MergedInheritanceKey>(['max_belong', 'combat', 'sabotage', 'dex', 'betting']);

const LEGACY_KEY_LABEL: Readonly<Record<'previous' | MergedInheritanceKey, string>> = {
    previous: '기존 보유',
    lived_month: '생존',
    max_belong: '최대 임관년 수',
    max_domestic_critical: '최대 연속 내정 성공',
    active_action: '능동 행동 수',
    combat: '전투 횟수',
    sabotage: '계략 성공 횟수',
    unifier: '천통 기여',
    dex: '숙련도',
    tournament: '토너먼트',
    betting: '베팅 당첨',
};

const formatLegacyPoint = (value: number): string => {
    if (!Number.isFinite(value)) {
        return '0';
    }
    return String(Object.is(value, -0) ? 0 : value);
};

export const buildInheritanceSettlementLogTexts = (input: {
    previous: number;
    points: Readonly<Partial<Record<MergedInheritanceKey, number>>>;
    storedKeys: ReadonlySet<string>;
    total: number;
    isRebirth: boolean;
}): string[] => {
    const texts = input.storedKeys.has('previous')
        ? [`${LEGACY_KEY_LABEL.previous} 포인트 ${formatLegacyPoint(input.previous)} 증가`]
        : [];
    for (const key of LEGACY_KEY_ORDER) {
        if (!LEGACY_CALCULATED_KEYS.has(key) && !input.storedKeys.has(key)) {
            continue;
        }
        if (input.isRebirth && REBIRTH_INHERITANCE_COEFFICIENTS[key] === null) {
            continue;
        }
        texts.push(`${LEGACY_KEY_LABEL[key]} 포인트 ${formatLegacyPoint(input.points[key] ?? 0)} 증가`);
    }
    texts.push(`포인트 ${formatLegacyPoint(input.previous)} => ${formatLegacyPoint(input.total)}`);
    return texts;
};
