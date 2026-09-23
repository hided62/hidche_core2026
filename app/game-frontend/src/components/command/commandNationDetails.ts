import { nationLevelMap } from '../../utils/nationFormat.ts';
import { legacyLuminanceTextColor } from '../../utils/legacyNationColor.ts';
import type { CommandNationScoutMessage, CommandOption } from './types';

/** Ref GameConst::$coefAidAmount, Core che_물자원조 COEF_AID_AMOUNT. */
export const AID_AMOUNT_PER_NATION_LEVEL = 10_000;

export type AidLevelRow = { level: number; text: string; amount: number; current: boolean };

/** Ref che_물자원조 exportJSVars()의 levelInfo: 작위마다 작위 × coefAidAmount. */
export const aidLevelTable = (currentLevel: number | undefined): AidLevelRow[] =>
    Object.keys(nationLevelMap)
        .map(Number)
        .sort((left, right) => left - right)
        .map((level) => ({
            level,
            text: nationLevelMap[level]!,
            amount: level * AID_AMOUNT_PER_NATION_LEVEL,
            current: level === currentLevel,
        }));

export const SCOUT_MESSAGE_COMMANDS: ReadonlySet<string> = new Set(['che_임관', 'che_장수대상임관']);

export type ScoutMessageRow = CommandNationScoutMessage & { textColor: string; selectable: boolean };

/**
 * Ref che_임관·che_장수대상임관의 권유문 목록.
 * 임관은 nation 표 순서이고, 장수대상임관은 getNationStaticInfo(0)의 재야를 앞에 둔다.
 * 행을 눌러 국가를 고르는 것은 임관뿐이다.
 */
export const scoutMessageRows = (
    commandKey: string,
    messages: readonly CommandNationScoutMessage[] | undefined
): ScoutMessageRow[] => {
    if (!SCOUT_MESSAGE_COMMANDS.has(commandKey)) return [];
    const nations = (messages ?? []).filter((entry) => entry.nationId > 0);
    const rows =
        commandKey === 'che_장수대상임관'
            ? [{ nationId: 0, name: '재야', color: '#000000', message: '' }, ...nations]
            : nations;
    return rows.map((entry) => ({
        ...entry,
        textColor: legacyLuminanceTextColor(entry.color),
        selectable: commandKey === 'che_임관',
    }));
};

/** Ref che_피장파장.vue: 재사용 대기 중인 전략은 `이름 (불가, N턴)`을 붉은색으로 보인다. */
export const counterStrategyOption = (
    option: CommandOption,
    cooldowns: Readonly<Record<string, number>> | undefined
): { label: string; remainTurn: number } => {
    const remainTurn = cooldowns?.[String(option.value)] ?? 0;
    return {
        label: remainTurn > 0 ? `${option.label} (불가, ${remainTurn}턴)` : option.label,
        remainTurn,
    };
};
