import { DIPLOMACY_STATE } from '@sammo-ts/logic';

import type { TurnCommandAmountPreset, TurnCommandOption } from './commandInput.js';

export interface GeneralTargetSource {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    npcState: number;
    officerLevel: number;
    gold?: number;
    rice?: number;
    crew?: number;
    train?: number;
    atmos?: number;
    troopId?: number;
}

export interface NationTargetSource {
    id: number;
    name: string;
    color: string;
    capitalName: string;
    level: number;
    power: number;
    generalCount: number;
    cityCount: number;
    diplomacyState: number;
    diplomacyTerm: number;
    adjacent: boolean;
    diplomacyRestricted?: boolean;
}

export interface RefGeneralTargetOptions {
    generals: TurnCommandOption[];
    generalTargets: Record<string, TurnCommandOption[]>;
}

export interface RefNationTargetOptions {
    nations: TurnCommandOption[];
    nationTargets: Record<string, TurnCommandOption[]>;
}

const SAME_NATION_GENERAL_COMMANDS = ['che_증여'] as const;
const SAME_NATION_NATION_COMMANDS = ['che_발령', 'che_포상', 'che_몰수', 'che_부대탈퇴지시'] as const;

/** Ref 각 처리 화면의 SELECT 조건을 공통 command table의 명령별 option으로 투영한다. */
export const buildRefGeneralTargetOptions = (options: {
    actorId: number;
    actorNationId: number;
    generals: readonly GeneralTargetSource[];
    nationNames: ReadonlyMap<number, string>;
    cityNames: ReadonlyMap<number, string>;
    troopNames?: ReadonlyMap<number, string>;
}): RefGeneralTargetOptions => {
    const toOption = (entry: GeneralTargetSource, action?: string): TurnCommandOption => {
        const troopName = entry.troopId ? options.troopNames?.get(entry.troopId) : undefined;
        const cityName = options.cityNames.get(entry.cityId) ?? '재야';
        const troopLabel = entry.troopId
            ? `${troopName ?? `#${entry.troopId}`}${entry.troopId === entry.id ? ' (부대장)' : ''}`
            : '부대 없음';
        const isTroopMember = Boolean(entry.troopId && entry.troopId !== entry.id);
        const isTroopExit = action === 'che_부대탈퇴지시';
        const availableNow = isTroopExit ? isTroopMember && entry.id !== options.actorId : undefined;
        const label = (() => {
            if (action === 'che_발령') return `${entry.name} (${troopLabel} · ${cityName})`;
            if (action === 'che_포상' || action === 'che_몰수') return `${entry.name} (${cityName})`;
            return `${entry.name} (${options.nationNames.get(entry.nationId) ?? '무소속'} · ${cityName})`;
        })();
        const details = [
            entry.gold === undefined ? null : `금 ${entry.gold.toLocaleString()}`,
            entry.rice === undefined ? null : `쌀 ${entry.rice.toLocaleString()}`,
            entry.crew === undefined ? null : `병력 ${entry.crew.toLocaleString()}`,
            entry.train === undefined ? null : `훈련 ${entry.train.toLocaleString()}`,
            entry.atmos === undefined ? null : `사기 ${entry.atmos.toLocaleString()}`,
            action === 'che_발령' || action === 'che_포상' || action === 'che_몰수'
                ? null
                : entry.troopId
                  ? `탑승 부대 ${troopLabel}`
                  : '탑승 부대 없음',
        ].filter((value): value is string => Boolean(value));
        if (isTroopExit) {
            details.unshift(availableNow ? '현재 탈퇴 지시 가능' : '현재 탈퇴 지시 불가');
        }
        return {
            value: entry.id,
            label,
            description: details.join(' · '),
            ...(availableNow === undefined ? {} : { availableNow }),
            ...(entry.gold === undefined ? {} : { gold: entry.gold }),
            ...(entry.rice === undefined ? {} : { rice: entry.rice }),
            ...(entry.crew === undefined ? {} : { crew: entry.crew }),
            ...(entry.troopId === undefined ? {} : { troopId: entry.troopId }),
            npcState: entry.npcState,
        };
    };
    const project = (predicate: (entry: GeneralTargetSource) => boolean): TurnCommandOption[] =>
        options.generals.filter(predicate).map((entry) => toOption(entry));

    const generalTargets: Record<string, TurnCommandOption[]> = {};
    for (const action of SAME_NATION_GENERAL_COMMANDS) {
        generalTargets[action] = options.generals
            .filter((entry) => entry.nationId === options.actorNationId)
            .map((entry) => toOption(entry, action));
    }
    for (const action of SAME_NATION_NATION_COMMANDS) {
        generalTargets[action] = options.generals
            .filter((entry) => entry.nationId === options.actorNationId)
            .map((entry) => toOption(entry, action))
            .sort((left, right) => Number(right.availableNow) - Number(left.availableNow));
    }

    generalTargets.che_선양 = project(
        (entry) => entry.nationId !== 0 && entry.nationId === options.actorNationId && entry.id !== options.actorId
    );
    generalTargets.che_등용 = project(
        (entry) => entry.npcState < 2 && entry.officerLevel !== 12 && entry.id !== options.actorId
    );
    generalTargets.che_장수대상임관 = project((entry) => entry.id !== options.actorId);

    return {
        // 기존 profile의 공통 fallback은 유저장 목록을 유지한다.
        generals: project((entry) => entry.npcState < 2),
        generalTargets,
    };
};

const DIPLOMACY_LABELS: Record<number, string> = {
    [DIPLOMACY_STATE.WAR]: '전쟁',
    [DIPLOMACY_STATE.DECLARATION]: '선포',
    [DIPLOMACY_STATE.TRADE]: '교역',
    [DIPLOMACY_STATE.NON_AGGRESSION]: '불가침',
};

const NATION_TARGET_COMMANDS = [
    'che_물자원조',
    'che_불가침제의',
    'che_선전포고',
    'che_종전제의',
    'che_불가침파기제의',
] as const;

const nationAvailability = (
    action: (typeof NATION_TARGET_COMMANDS)[number],
    actorNationId: number,
    target: NationTargetSource
): { available: boolean; reason: string } => {
    if (target.id === actorNationId) return { available: false, reason: '아국은 대상이 아닙니다.' };
    if (action === 'che_물자원조') {
        return target.diplomacyRestricted
            ? { available: false, reason: '상대국이 외교제한 중입니다.' }
            : { available: true, reason: '현재 원조 대상' };
    }
    if (action === 'che_불가침제의') {
        const available = ![DIPLOMACY_STATE.WAR, DIPLOMACY_STATE.DECLARATION].includes(target.diplomacyState as 0 | 1);
        return { available, reason: available ? '현재 제의 가능' : '교전·선포 중에는 제의 불가' };
    }
    if (action === 'che_선전포고') {
        if (!target.adjacent) return { available: false, reason: '인접 국가가 아닙니다.' };
        const available = ![DIPLOMACY_STATE.WAR, DIPLOMACY_STATE.DECLARATION, DIPLOMACY_STATE.NON_AGGRESSION].includes(
            target.diplomacyState as 0 | 1 | 7
        );
        return { available, reason: available ? '현재 선전포고 가능' : '현재 외교 관계에서는 선전포고 불가' };
    }
    if (action === 'che_종전제의') {
        const available = [DIPLOMACY_STATE.WAR, DIPLOMACY_STATE.DECLARATION].includes(target.diplomacyState as 0 | 1);
        return { available, reason: available ? '현재 종전 제의 가능' : '전쟁·선포 중인 국가가 아닙니다.' };
    }
    const available = target.diplomacyState === DIPLOMACY_STATE.NON_AGGRESSION;
    return { available, reason: available ? '현재 불가침 파기 제의 가능' : '불가침 중인 국가가 아닙니다.' };
};

/** 사령턴 외교 대상은 현재 명령에 맞는 국가부터 보이되, 예약 자체는 모든 대상을 유지한다. */
export const buildRefNationTargetOptions = (options: {
    actorNationId: number;
    nations: readonly NationTargetSource[];
}): RefNationTargetOptions => {
    const baseOptions = options.nations.map<TurnCommandOption>((entry) => ({
        value: entry.id,
        label: entry.name,
        color: entry.color,
        description: `수도 ${entry.capitalName} · 국력 ${entry.power.toLocaleString()} · 도시 ${entry.cityCount.toLocaleString()} · 장수 ${entry.generalCount.toLocaleString()}`,
    }));
    const nationTargets: Record<string, TurnCommandOption[]> = {};
    for (const action of NATION_TARGET_COMMANDS) {
        nationTargets[action] = options.nations
            .map((entry) => {
                const availability = nationAvailability(action, options.actorNationId, entry);
                const relation = DIPLOMACY_LABELS[entry.diplomacyState] ?? `관계 ${entry.diplomacyState}`;
                const term = entry.diplomacyTerm > 0 ? ` ${entry.diplomacyTerm}턴` : '';
                return {
                    value: entry.id,
                    label: entry.name,
                    color: entry.color,
                    availableNow: availability.available,
                    description: `${availability.reason} · ${relation}${term} · 수도 ${entry.capitalName} · 국력 ${entry.power.toLocaleString()} · 도시 ${entry.cityCount.toLocaleString()} · 장수 ${entry.generalCount.toLocaleString()}`,
                    power: entry.power,
                } as TurnCommandOption & { power: number };
            })
            .sort(
                (left, right) =>
                    Number(right.availableNow) - Number(left.availableNow) ||
                    right.power - left.power ||
                    Number(left.value) - Number(right.value)
            )
            .map(({ power: _power, ...entry }) => entry);
    }
    return { nations: baseOptions, nationTargets };
};

const RESOURCE_ACTION_GUIDE = [
    100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000,
    10000,
];

/** Ref SelectAmount의 dropdown 값을 공통 예약 입력 DTO로 옮긴다. */
export const buildRefAmountPresets = (
    nationLevel: number,
    maxResourceActionAmount: number
): Record<string, TurnCommandAmountPreset> => {
    const resourceMax = maxResourceActionAmount > 0 ? maxResourceActionAmount : 10_000;
    const resourceValues = RESOURCE_ACTION_GUIDE.filter((value) => value <= resourceMax);
    if (!resourceValues.includes(resourceMax)) resourceValues.push(resourceMax);
    const resourcePreset: TurnCommandAmountPreset = {
        values: resourceValues,
        defaultValue: Math.min(1000, resourceMax),
        min: Math.min(100, resourceMax),
        max: resourceMax,
        step: 1,
    };
    const aidMax = Math.max(10_000, Math.max(1, nationLevel) * 10_000);
    const aidPreset: TurnCommandAmountPreset = {
        values: Array.from({ length: Math.max(1, nationLevel) }, (_, index) => (index + 1) * 10_000),
        defaultValue: Math.min(1000, aidMax),
        min: 1000,
        max: aidMax,
        step: 10,
    };
    return {
        che_증여: resourcePreset,
        che_헌납: resourcePreset,
        che_군량매매: resourcePreset,
        che_포상: resourcePreset,
        che_몰수: resourcePreset,
        che_물자원조: aidPreset,
    };
};
