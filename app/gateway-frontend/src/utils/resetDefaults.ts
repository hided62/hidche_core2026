export const PROFILE_TURN_TERM_MINUTES = [1, 2, 5, 10, 20, 30, 60, 120] as const;
export const RESET_AUTORUN_OPTIONS = [
    'develop',
    'warp',
    'recruit',
    'recruit_high',
    'train',
    'battle',
    'chief',
] as const;

export type ResetAutorunOption = (typeof RESET_AUTORUN_OPTIONS)[number];

export const RESET_AUTORUN_LABELS: ReadonlyArray<{ value: ResetAutorunOption; label: string }> = [
    { value: 'develop', label: '내정' },
    { value: 'warp', label: '순간이동' },
    { value: 'recruit', label: '징병' },
    { value: 'recruit_high', label: '모병' },
    { value: 'train', label: '훈사' },
    { value: 'battle', label: '출병' },
    { value: 'chief', label: '기본 사령턴' },
];

export const RESET_OPTION_COPY = {
    turnTerm: {
        label: '턴 시간(분)',
        help: '한 턴이 진행되는 실제 시간입니다. ref 초기화 화면과 같은 분 단위 값입니다.',
    },
    sync: {
        label: '시간 동기화',
        help: '실제 시각의 시간 단위에 게임의 년·월 경계를 맞춥니다. ref 기준 120분은 오전 1시, 60분은 오전·오후 1시에 1월이 시작됩니다.',
    },
    fiction: {
        label: 'NPC 상성',
        help: 'ref의 연의/가상 모드입니다. 연의는 서버 정보에서 사실 모드로도 표시됩니다. 가상 장수 생성 허용 여부를 뜻하는 옵션은 아닙니다.',
    },
    extend: {
        label: '확장 NPC',
        help: '시나리오에 별도로 정의된 확장 장수 목록을 초기 배치에 포함할지 정합니다. 게임 기간을 연장하는 옵션은 아닙니다.',
    },
    blockGeneralCreate: {
        label: '장수 임의 생성',
        help: '가능은 이름을 직접 정해 생성, 장수명 무작위는 생성은 허용하되 이름을 무작위로 지정, 불가는 일반 장수 생성을 막습니다.',
    },
    npcMode: {
        label: 'NPC 빙의',
        help: '불가는 빙의를 막고, 가능은 배치된 NPC에 빙의할 수 있게 합니다. 선택 생성 가능은 장수 풀에서 대상을 골라 생성하는 방식입니다.',
    },
    autorun: {
        label: '자율행동',
        help: 'ref 초기화 화면의 휴식 턴 시 장수 턴입니다. 설정한 유효 시간 동안 휴식 턴에 선택한 행동을 대신 수행합니다. 훈사는 훈련/사기진작을 뜻합니다.',
    },
    autorunLimit: {
        label: '유효 시간(분)',
        help: '자율행동을 사용할 수 있는 기간입니다. 43200분은 ref의 항상 유효에 해당합니다.',
    },
    joinMode: {
        label: '임관 모드',
        help: '일반은 지원되는 임관 방식을 허용하고, 랜덤 임관은 무작위 국가 임관만 허용합니다.',
    },
    showImgLevel: {
        label: '이미지 표기',
        help: '전콘은 장수 개인 아이콘입니다. 단계에 따라 전콘, 병종 이미지, NPC 이미지를 차례로 표시합니다.',
    },
    tournamentTrig: {
        label: '토너먼트 자동 시작',
        help: '자동은 기수 진행 중 토너먼트를 자동으로 시작하고, 수동은 자동 시작을 끕니다.',
    },
} as const;

export type ProfileResetDefaults = {
    turnTermMinutes: number;
    sync: boolean;
    fiction: 0 | 1;
    extend: boolean;
    blockGeneralCreate: 0 | 1 | 2;
    npcMode: 0 | 1 | 2;
    showImgLevel: 0 | 1 | 2 | 3;
    tournamentTrig: boolean;
    joinMode: 'full' | 'onlyRandom';
    autorunUser: {
        limitMinutes: number;
        options: ResetAutorunOption[];
    } | null;
};

export const SYSTEM_PROFILE_RESET_DEFAULTS: ProfileResetDefaults = {
    turnTermMinutes: 60,
    sync: true,
    fiction: 1,
    extend: true,
    blockGeneralCreate: 0,
    npcMode: 0,
    showImgLevel: 3,
    tournamentTrig: true,
    joinMode: 'full',
    autorunUser: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));

const enumNumber = <T extends number>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'number' && allowed.includes(value as T) ? (value as T) : fallback;

export const normalizeProfileResetDefaults = (value: unknown): ProfileResetDefaults => {
    const raw = isRecord(value) ? value : {};
    const rawAutorun = isRecord(raw.autorunUser) ? raw.autorunUser : null;
    const autorunOptions = Array.isArray(rawAutorun?.options)
        ? rawAutorun.options.filter((option): option is ResetAutorunOption =>
              RESET_AUTORUN_OPTIONS.includes(option as ResetAutorunOption)
          )
        : [];
    const autorunLimit = rawAutorun?.limitMinutes;

    return {
        turnTermMinutes: enumNumber(raw.turnTermMinutes, PROFILE_TURN_TERM_MINUTES, 60),
        sync: typeof raw.sync === 'boolean' ? raw.sync : SYSTEM_PROFILE_RESET_DEFAULTS.sync,
        fiction: enumNumber(raw.fiction, [0, 1], SYSTEM_PROFILE_RESET_DEFAULTS.fiction),
        extend: typeof raw.extend === 'boolean' ? raw.extend : SYSTEM_PROFILE_RESET_DEFAULTS.extend,
        blockGeneralCreate: enumNumber(
            raw.blockGeneralCreate,
            [0, 1, 2],
            SYSTEM_PROFILE_RESET_DEFAULTS.blockGeneralCreate
        ),
        npcMode: enumNumber(raw.npcMode, [0, 1, 2], SYSTEM_PROFILE_RESET_DEFAULTS.npcMode),
        showImgLevel: enumNumber(raw.showImgLevel, [0, 1, 2, 3], SYSTEM_PROFILE_RESET_DEFAULTS.showImgLevel),
        tournamentTrig:
            typeof raw.tournamentTrig === 'boolean' ? raw.tournamentTrig : SYSTEM_PROFILE_RESET_DEFAULTS.tournamentTrig,
        joinMode: raw.joinMode === 'onlyRandom' ? 'onlyRandom' : 'full',
        autorunUser:
            typeof autorunLimit === 'number' &&
            Number.isInteger(autorunLimit) &&
            autorunLimit > 0 &&
            autorunLimit <= 43200 &&
            autorunOptions.length > 0
                ? { limitMinutes: autorunLimit, options: autorunOptions }
                : null,
    };
};
