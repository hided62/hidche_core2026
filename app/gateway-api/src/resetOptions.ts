import { z } from 'zod';

const AUTORUN_USER_OPTIONS = ['develop', 'warp', 'recruit', 'recruit_high', 'train', 'battle', 'chief'] as const;
const zJoinMode = z.enum(['full', 'onlyRandom']);

const zInstallAutorun = z.object({
    limitMinutes: z.number().int().min(0).max(43200),
    options: z.array(z.enum(AUTORUN_USER_OPTIONS)),
});

// Ref aligns a 12-month game year inside a 24-hour wall-clock day. That makes
// every positive divisor of 120 valid, including 3 and 8 minutes.
export const isAllowedTurnTerm = (value: number): boolean => Number.isInteger(value) && value > 0 && 120 % value === 0;

export const zInstallOptions = z.object({
    scenarioId: z.number().int().min(0),
    turnTermMinutes: z
        .number()
        .int()
        .refine((value) => isAllowedTurnTerm(value), {
            message: '턴 시간은 120의 약수여야 합니다.',
        }),
    sync: z.boolean(),
    fiction: z.number().int().min(0).max(1),
    extend: z.boolean(),
    blockGeneralCreate: z.number().int().min(0).max(2),
    npcMode: z.number().int().min(0).max(2),
    showImgLevel: z.number().int().min(0).max(3),
    tournamentTrig: z.boolean(),
    joinMode: zJoinMode,
    autorunUser: zInstallAutorun.nullable().optional(),
    openAt: z.string().datetime().optional(),
    preopenAt: z.string().datetime().optional(),
    gitRef: z.string().min(1).max(128).optional(),
});
export const zOperationInstallOptions = zInstallOptions.omit({ gitRef: true });
export const zProfileResetDefaults = zInstallOptions.omit({
    scenarioId: true,
    openAt: true,
    preopenAt: true,
    gitRef: true,
});
export const SYSTEM_PROFILE_RESET_DEFAULTS: z.infer<typeof zProfileResetDefaults> = {
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

export const buildResetOtherTextInfo = (install: z.infer<typeof zOperationInstallOptions>): string => {
    const settings: string[] = [];
    if (!install.sync) settings.push('시간동기화 없음');
    if (!install.extend) settings.push('확장 NPC 미포함');
    if (install.blockGeneralCreate === 1) settings.push('장수 생성 불가');
    if (install.blockGeneralCreate === 2) settings.push('장수명 무작위');
    if (install.joinMode === 'onlyRandom') settings.push('랜덤 임관');
    if (install.showImgLevel !== SYSTEM_PROFILE_RESET_DEFAULTS.showImgLevel) {
        settings.push(['이미지 표시 안함', '전콘 표시', '전콘/병종 표시'][install.showImgLevel] ?? '이미지 표시');
    }
    if (!install.tournamentTrig) settings.push('토너먼트 수동 시작');
    return settings.join(', ');
};
