import { DIPLOMACY_STATE } from '@sammo-ts/logic';

import type { TurnCommandAmountPreset, TurnCommandNationScoutMessage, TurnCommandOption } from './commandInput.js';

export interface GeneralTargetSource {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    npcState: number;
    officerLevel: number;
    gold?: number;
    rice?: number;
    leadership?: number;
    strength?: number;
    intel?: number;
    crew?: number;
    train?: number;
    atmos?: number;
    troopId?: number;
}

export interface NationTargetSource {
    id: number;
    name: string;
    color: string;
    capitalName?: string;
    level: number;
    power: number;
    generalCount: number;
    cityCount: number;
    diplomacyState: number;
    diplomacyTerm: number;
    adjacent: boolean;
    diplomacyRestricted?: boolean;
    /** Ref nation.gennum. 없으면 generalCount를 쓴다. */
    gennum?: number;
    /** 임관 금지(nation.scout). */
    blockScout?: boolean;
    /** 서버에서 purifyNationHtml로 정제한 임관 권유문. */
    scoutMessage?: string;
}

/** Ref AllowJoinDestNation이 쓰는 actor·시점 정보. */
export interface NationJoinContext {
    actorNpcState: number;
    relYear: number;
    openingPartYear: number;
    initialNationGenLimit: number;
}

export interface RefGeneralTargetOptions {
    generals: TurnCommandOption[];
    generalTargets: Record<string, TurnCommandOption[]>;
}

export interface RefNationTargetOptions {
    nations: TurnCommandOption[];
    nationTargets: Record<string, TurnCommandOption[]>;
    nationScoutMessages: TurnCommandNationScoutMessage[];
}

const SAME_NATION_GENERAL_COMMANDS = ['che_증여'] as const;
const SAME_NATION_NATION_COMMANDS = ['che_발령', 'che_포상', 'che_몰수', 'che_부대탈퇴지시'] as const;

const statsText = (entry: GeneralTargetSource): string =>
    [
        entry.leadership === undefined ? null : `통솔 ${entry.leadership.toLocaleString()}`,
        entry.strength === undefined ? null : `무력 ${entry.strength.toLocaleString()}`,
        entry.intel === undefined ? null : `지력 ${entry.intel.toLocaleString()}`,
    ]
        .filter(Boolean)
        .join(' · ');

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
        const isTroopMember = Boolean(entry.troopId && entry.troopId !== entry.id);
        const isTroopExit = action === 'che_부대탈퇴지시';
        const availableNow = isTroopExit ? isTroopMember && entry.id !== options.actorId : undefined;
        const label = (() => {
            // 같은 국가 후보만 있는 명령은 국명을 반복하지 않는다.
            if (['che_발령', 'che_포상', 'che_몰수', 'che_선양'].includes(action ?? '')) {
                return `${entry.name} (${cityName})`;
            }
            return `${entry.name} (${options.nationNames.get(entry.nationId) ?? '무소속'} · ${cityName})`;
        })();
        // Ref che_선양.vue는 후보에 (통/무/지)만 보인다.
        const details = (
            action === 'che_선양'
                ? []
                : [
                      entry.gold === undefined ? null : `금 ${entry.gold.toLocaleString()}`,
                      entry.rice === undefined ? null : `쌀 ${entry.rice.toLocaleString()}`,
                      entry.crew === undefined ? null : `병력 ${entry.crew.toLocaleString()}`,
                      entry.train === undefined ? null : `훈련 ${entry.train.toLocaleString()}`,
                      entry.atmos === undefined ? null : `사기 ${entry.atmos.toLocaleString()}`,
                  ]
        ).filter((value): value is string => Boolean(value));
        // 발령 후보는 Ref처럼 능력치와 병력 준비 상태를 함께 비교한다.
        // 예약 요약에 쓰는 label은 그대로 두고, 같은 국가 후보의 상세 정보만 보강한다.
        const assignmentDetails =
            action === 'che_발령'
                ? [
                      statsText(entry),
                      [
                          entry.crew === undefined ? null : `병력 ${entry.crew.toLocaleString()}`,
                          entry.train === undefined ? null : `훈련 ${entry.train.toLocaleString()}`,
                          entry.atmos === undefined ? null : `사기 ${entry.atmos.toLocaleString()}`,
                      ]
                          .filter(Boolean)
                          .join(' · '),
                      [
                          entry.gold === undefined ? null : `금 ${entry.gold.toLocaleString()}`,
                          entry.rice === undefined ? null : `쌀 ${entry.rice.toLocaleString()}`,
                      ]
                          .filter(Boolean)
                          .join(' · '),
                  ]
                      .filter(Boolean)
                      .join('\n')
                : undefined;
        // Ref ProcessGeneralAmount·ProcessGeneral은 같은 국가 후보에 (통/무/지)를 함께 보인다.
        const stats = statsText(entry);
        if (stats && action !== 'che_발령') details.push(stats);
        if (isTroopExit) {
            details.unshift(availableNow ? '현재 탈퇴 지시 가능' : '현재 탈퇴 지시 불가');
        }
        return {
            value: entry.id,
            label,
            targetNames: {
                name: entry.name,
                nationName: options.nationNames.get(entry.nationId) ?? null,
                cityName: options.cityNames.get(entry.cityId) ?? null,
                troopName: troopName ?? null,
            },
            description: assignmentDetails ?? details.join(' · '),
            ...(availableNow === undefined ? {} : { availableNow }),
            ...(entry.gold === undefined ? {} : { gold: entry.gold }),
            ...(entry.rice === undefined ? {} : { rice: entry.rice }),
            ...(entry.crew === undefined ? {} : { crew: entry.crew }),
            ...(entry.troopId === undefined ? {} : { troopId: entry.troopId }),
            npcState: entry.npcState,
        };
    };
    // Ref che_등용·che_장수대상임관 exportJSVars()는 타국·재야 장수의
    // no,name,nation,officer_level,npc,leadership,strength,intel만 내보낸다.
    // 명령표는 모든 장수에게 전달되므로 금·쌀·병력·훈련·사기·부대·위치 도시를 싣지 않는다.
    const toPublicOption = (entry: GeneralTargetSource): TurnCommandOption => {
        const nationName = options.nationNames.get(entry.nationId) ?? null;
        return {
            value: entry.id,
            label: `${entry.name} (${nationName ?? '재야'})`,
            targetNames: { name: entry.name, nationName },
            description: statsText(entry),
            npcState: entry.npcState,
            nationId: entry.nationId,
        };
    };
    const projectPublic = (predicate: (entry: GeneralTargetSource) => boolean): TurnCommandOption[] =>
        options.generals.filter(predicate).map(toPublicOption);
    // 재야는 국가가 아니므로 같은 국가 명령 후보가 없다. 해당 명령도 NotBeNeutral로 막힌다.
    const isSameNation = (entry: GeneralTargetSource): boolean =>
        options.actorNationId !== 0 && entry.nationId === options.actorNationId;

    const generalTargets: Record<string, TurnCommandOption[]> = {};
    for (const action of SAME_NATION_GENERAL_COMMANDS) {
        generalTargets[action] = options.generals.filter(isSameNation).map((entry) => toOption(entry, action));
    }
    for (const action of SAME_NATION_NATION_COMMANDS) {
        generalTargets[action] = options.generals
            .filter(isSameNation)
            .map((entry) => toOption(entry, action))
            .sort((left, right) => Number(right.availableNow) - Number(left.availableNow));
    }

    generalTargets.che_선양 = options.generals
        .filter((entry) => isSameNation(entry) && entry.id !== options.actorId)
        .map((entry) => toOption(entry, 'che_선양'));
    generalTargets.che_등용 = projectPublic(
        (entry) => entry.npcState < 2 && entry.officerLevel !== 12 && entry.id !== options.actorId
    );
    generalTargets.che_장수대상임관 = projectPublic((entry) => entry.id !== options.actorId);

    return {
        // 기존 profile의 공통 fallback은 유저장 목록을 유지한다. 타국 장수가 섞이므로 공개 필드만 둔다.
        generals: projectPublic((entry) => entry.npcState < 2),
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
    'che_피장파장',
    'che_이호경식',
    'che_급습',
] as const;

/** 피장파장으로 지정할 수 있는 전략(GameConst availableChiefCommand['전략']에서 자신 제외). */
export const COUNTER_STRATEGY_COMMAND_KEYS = [
    'che_필사즉생',
    'che_백성동원',
    'che_수몰',
    'che_허보',
    'che_의병모집',
    'che_이호경식',
    'che_급습',
] as const;

/** Ref che_임관 exportJSVars()의 notAvailable: AllowJoinDestNation의 대상 국가 조건. */
const joinAvailability = (
    join: NationJoinContext,
    actorNationId: number,
    target: NationTargetSource
): { available: boolean; reason: string } => {
    if (target.id === actorNationId) return { available: false, reason: '아국은 대상이 아닙니다.' };
    const gennum = target.gennum ?? target.generalCount;
    if (join.relYear < join.openingPartYear && join.initialNationGenLimit > 0 && gennum >= join.initialNationGenLimit) {
        return { available: false, reason: '임관이 제한되고 있습니다.' };
    }
    if (target.blockScout) return { available: false, reason: '임관이 금지되어 있습니다.' };
    if (join.actorNpcState < 2 && target.name.startsWith('ⓤ')) {
        return { available: false, reason: '유저장은 태수국에 임관할 수 없습니다.' };
    }
    if (join.actorNpcState !== 9 && target.name.startsWith('ⓞ')) {
        return { available: false, reason: '이민족 국가에 임관할 수 없습니다.' };
    }
    return { available: true, reason: '현재 임관 가능' };
};

const nationAvailability = (
    action: (typeof NATION_TARGET_COMMANDS)[number],
    actorNationId: number,
    target: NationTargetSource,
    strategyAvailable: boolean
): { available: boolean; reason: string } => {
    if (target.id === actorNationId) return { available: false, reason: '아국은 대상이 아닙니다.' };
    // Ref 피장파장은 쓸 수 있는 전략이 하나도 없으면 모든 국가를 불가로 표시한다.
    if (action === 'che_피장파장' && !strategyAvailable) {
        return { available: false, reason: '사용할 수 있는 전략이 없습니다.' };
    }
    if (action === 'che_피장파장' || action === 'che_이호경식') {
        const available = [DIPLOMACY_STATE.WAR, DIPLOMACY_STATE.DECLARATION].includes(target.diplomacyState as 0 | 1);
        return { available, reason: available ? '현재 발동 가능' : '선포, 전쟁중인 상대국에게만 가능합니다.' };
    }
    if (action === 'che_급습') {
        // Ref AllowDiplomacyWithTerm(1, 12): 선포 상태이고 남은 기간이 12개월 이상.
        const available = target.diplomacyState === DIPLOMACY_STATE.DECLARATION && target.diplomacyTerm >= 12;
        return { available, reason: available ? '현재 발동 가능' : '선포 12개월 이상인 상대국에만 가능합니다.' };
    }
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
    /** 없으면 임관 대상 가능 여부를 계산하지 않고 기본 국가 목록을 쓴다. */
    join?: NationJoinContext;
    /** 피장파장으로 지정할 수 있는 전략이 하나라도 있는지. 기본값 true. */
    strategyAvailable?: boolean;
}): RefNationTargetOptions => {
    const strategyAvailable = options.strategyAvailable ?? true;
    const baseOptions = options.nations.map<TurnCommandOption>((entry) => ({
        value: entry.id,
        label: entry.name,
        targetNames: { name: entry.name, capitalName: entry.capitalName ?? null },
        color: entry.color,
        description: `수도 ${entry.capitalName ?? '-'} · 국력 ${entry.power.toLocaleString()} · 도시 ${entry.cityCount.toLocaleString()} · 장수 ${entry.generalCount.toLocaleString()}`,
    }));
    const nationTargets: Record<string, TurnCommandOption[]> = {};
    for (const action of NATION_TARGET_COMMANDS) {
        nationTargets[action] = options.nations
            .map((entry) => {
                const availability = nationAvailability(action, options.actorNationId, entry, strategyAvailable);
                const relation = DIPLOMACY_LABELS[entry.diplomacyState] ?? `관계 ${entry.diplomacyState}`;
                const term = entry.diplomacyTerm > 0 ? ` ${entry.diplomacyTerm}턴` : '';
                return {
                    value: entry.id,
                    label: entry.name,
                    targetNames: { name: entry.name, capitalName: entry.capitalName ?? null },
                    color: entry.color,
                    availableNow: availability.available,
                    description: `${availability.reason} · ${relation}${term} · 수도 ${entry.capitalName ?? '-'} · 국력 ${entry.power.toLocaleString()} · 도시 ${entry.cityCount.toLocaleString()} · 장수 ${entry.generalCount.toLocaleString()}`,
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
    const join = options.join;
    if (join) {
        // Ref 임관 목록은 nation 표 순서 그대로이며 불가 국가도 남긴다. 재야(0)는 국가가 아니다.
        nationTargets.che_임관 = options.nations.flatMap((entry, index) => {
            if (entry.id <= 0) return [];
            const availability = joinAvailability(join, options.actorNationId, entry);
            return [
                {
                    ...baseOptions[index]!,
                    availableNow: availability.available,
                    description: `${availability.reason} · ${baseOptions[index]!.description}`,
                },
            ];
        });
    }
    // Ref che_임관·che_장수대상임관은 모든 국가의 권유문(scout_msg)을 함께 내보낸다.
    const nationScoutMessages = options.nations
        .filter((entry) => entry.id > 0)
        .map((entry) => ({
            nationId: entry.id,
            name: entry.name,
            color: entry.color,
            message: entry.scoutMessage ?? '',
        }));
    return { nations: baseOptions, nationTargets, nationScoutMessages };
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
