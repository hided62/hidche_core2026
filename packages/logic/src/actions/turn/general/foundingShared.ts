import { isAvailableNationTraitKey } from '@sammo-ts/logic/actionModules/traits/nation/index.js';
import { getLegacyStringWidth } from '@sammo-ts/logic/troop/management.js';
import { z } from 'zod';

export const NATION_COLORS = [
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#FFA500',
    '#FFDAB9',
    '#FFD700',
    '#FFFF00',
    '#7CFC00',
    '#00FF00',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#20B2AA',
    '#6495ED',
    '#7FFFD4',
    '#AFEEEE',
    '#87CEEB',
    '#00FFFF',
    '#00BFFF',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#BA55D3',
    '#800080',
    '#FF00FF',
    '#FFC0CB',
    '#F5F5DC',
    '#E0FFFF',
    '#FFFFFF',
    '#A9A9A9',
] as const;

export const FOUNDING_ARGS_SCHEMA = z.object({
    nationName: z
        .string()
        .min(1)
        .refine((value) => getLegacyStringWidth(value) <= 18),
    nationType: z.string().refine(isAvailableNationTraitKey),
    colorType: z
        .number()
        .int()
        .min(0)
        .max(NATION_COLORS.length - 1),
});

export type FoundingArgs = z.infer<typeof FOUNDING_ARGS_SCHEMA>;

export const getNationTypeDisplayName = (nationType: string): string =>
    nationType.startsWith('che_') ? nationType.slice(4) : nationType;
