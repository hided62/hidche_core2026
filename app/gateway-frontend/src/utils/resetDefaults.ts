export const RESET_AUTORUN_OPTIONS = ['develop', 'warp', 'recruit', 'train', 'battle'] as const;

export type ResetAutorunOption = (typeof RESET_AUTORUN_OPTIONS)[number];

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
        turnTermMinutes: enumNumber(raw.turnTermMinutes, [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 24, 30, 40, 60, 120], 60),
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
