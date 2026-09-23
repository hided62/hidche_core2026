import { dexProgress } from '../../utils/legacyProgress.ts';
import type { CommandOption } from './types';

/** Ref che_장비매매.vue: 현재 구입(판매) 불가능한 항목은 붉은색 `(불가)`로 표시한다. */
export const equipmentOptionText = (option: CommandOption): string =>
    option.availableNow === false ? `${option.label} (불가)` : option.label;

export type DexAmountInfo = { amount: number; name: string; color: string };
export type DexConversionRow = { armName: string; before: DexAmountInfo; after: DexAmountInfo };

/** Core che_숙련전환 실행 계수. Ref che_숙련전환 $decreaseCoeff·$convertCoeff와 같다. */
export const DEX_DECREASE_COEFF = 0.4;
export const DEX_CONVERT_COEFF = 0.9;

const dexAmountInfo = (amount: number): DexAmountInfo => {
    const progress = dexProgress(amount);
    return { amount, name: progress.name, color: progress.color };
};

export const dexGradeName = (amount: number | undefined): string | undefined =>
    amount === undefined ? undefined : dexProgress(amount).name;

/**
 * Ref che_숙련전환.vue의 감소 대상·전환 대상 전/후 두 줄.
 * Ref 화면은 소수 그대로 계산한 뒤 내림해 보이지만, 여기서는 실제 실행과 같은 정수 절삭
 * (`cut = trunc(src × 0.4)`, `add = trunc(cut × 0.9)`) 값을 보인다.
 * 같은 병과끼리는 예약할 수 없으므로 미리보기를 만들지 않는다.
 */
export const dexConversionPreview = (
    srcArmType: unknown,
    destArmType: unknown,
    armTypes: readonly CommandOption[],
    dexterity: Readonly<Record<string, number>> | undefined
): DexConversionRow[] | null => {
    if (!dexterity || srcArmType === destArmType) return null;
    const src = armTypes.find((entry) => entry.value === srcArmType);
    const dest = armTypes.find((entry) => entry.value === destArmType);
    if (!src || !dest) return null;
    const srcDex = dexterity[String(src.value)] ?? 0;
    const destDex = dexterity[String(dest.value)] ?? 0;
    const cutDex = Math.trunc(srcDex * DEX_DECREASE_COEFF);
    const addDex = Math.trunc(cutDex * DEX_CONVERT_COEFF);
    return [
        { armName: src.label, before: dexAmountInfo(srcDex), after: dexAmountInfo(srcDex - cutDex) },
        { armName: dest.label, before: dexAmountInfo(destDex), after: dexAmountInfo(destDex + addDex) },
    ];
};

export type NationTypeRow = { value: CommandOption['value']; name: string; pros: string; cons: string };

/**
 * Ref che_건국.vue 성향표: `- 이름 : 장점, 단점`.
 * Core 국가 성향 info는 Ref `$pros`와 `$cons`를 공백으로 이은 문자열이므로 ↑/↓ 항목으로 다시 나눈다.
 */
export const nationTypeRows = (options: readonly CommandOption[]): NationTypeRow[] =>
    options.map((option) => {
        const tokens = (option.description ?? '').split(/\s+/).filter(Boolean);
        return {
            value: option.value,
            name: option.label,
            pros: tokens.filter((token) => token.endsWith('↑')).join(' '),
            cons: tokens.filter((token) => !token.endsWith('↑')).join(' '),
        };
    });
