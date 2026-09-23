import { legacyLuminanceTextColor } from '../../utils/legacyNationColor.ts';
import type { CommandOption } from './types';

/** Ref `SelectGeneral.vue`에 `groupByNation`을 넘기는 명령. */
export const NATION_GROUPED_GENERAL_COMMANDS: ReadonlySet<string> = new Set(['che_등용', 'che_장수대상임관']);

export type GeneralOptionGroup = {
    nationId: number;
    name: string;
    color: string;
    textColor: '#000000' | '#FFFFFF';
    options: CommandOption[];
};

/** Ref `getNationStaticInfo(0)`의 재야 표시값. */
const WANDERER = { name: '재야', color: '#000000' } as const;

/**
 * Ref처럼 정렬된 장수 목록에서 국가가 처음 나타난 순서대로 묶는다.
 * 머리 글자색은 Ref `isBrightColor()` 기준이다.
 */
export const groupGeneralOptionsByNation = (
    options: readonly CommandOption[],
    nations: readonly CommandOption[]
): GeneralOptionGroup[] => {
    const nationById = new Map(nations.map((nation) => [nation.value, nation]));
    const groups = new Map<number, GeneralOptionGroup>();
    for (const option of options) {
        const nationId = option.nationId ?? 0;
        let group = groups.get(nationId);
        if (!group) {
            const nation = nationId === 0 ? undefined : nationById.get(nationId);
            const name =
                nationId === 0
                    ? WANDERER.name
                    : (nation?.targetNames?.name ?? nation?.label ?? option.targetNames?.nationName ?? WANDERER.name);
            const color = nationId === 0 ? WANDERER.color : (nation?.color ?? WANDERER.color);
            group = {
                nationId,
                name,
                color,
                textColor: legacyLuminanceTextColor(color),
                options: [],
            };
            groups.set(nationId, group);
        }
        group.options.push(option);
    }
    return [...groups.values()];
};
