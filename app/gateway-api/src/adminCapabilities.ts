export type AdminCapabilityRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AdminCapabilityScope = 'GLOBAL' | 'PROFILE';

export interface AdminCapabilityDefinition {
    permission: string;
    label: string;
    description: string;
    risk: AdminCapabilityRisk;
    scope: AdminCapabilityScope;
}

export const ADMIN_CAPABILITIES: readonly AdminCapabilityDefinition[] = [
    {
        permission: 'admin.notice.manage',
        label: 'Gateway 공지 관리',
        description: 'Gateway 전역 공지를 조회하고 변경합니다.',
        risk: 'MEDIUM',
        scope: 'GLOBAL',
    },
    {
        permission: 'admin.users.create',
        label: '로컬 계정 생성',
        description: '환경에서 허용한 경우 로컬 계정을 생성합니다.',
        risk: 'HIGH',
        scope: 'GLOBAL',
    },
    {
        permission: 'admin.users.manage',
        label: '사용자·제재 관리',
        description: '계정 복구, 제재, OAuth 유예와 예약 탈퇴를 관리합니다.',
        risk: 'CRITICAL',
        scope: 'GLOBAL',
    },
    {
        permission: 'admin.audit.read',
        label: '관리자 감사 조회',
        description: 'Gateway 관리자 변경 이력과 실패 기록을 조회합니다.',
        risk: 'HIGH',
        scope: 'GLOBAL',
    },
    {
        permission: 'admin.profiles.runtime',
        label: 'Profile 실행 관리',
        description: '지정 profile의 시작, 정지와 실행 상태를 관리합니다.',
        risk: 'HIGH',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.profiles.settings',
        label: 'Profile 설정 관리',
        description: '지정 profile의 표시 정보와 계정 접근 정책을 변경합니다.',
        risk: 'HIGH',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.profiles.deploy',
        label: 'Profile 버전 배포',
        description: '지정 profile의 DB를 유지하면서 코드와 migration을 배포합니다.',
        risk: 'CRITICAL',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.scenarios.reset',
        label: '시나리오 초기화',
        description:
            '지정 profile의 현재 배포 버전으로 게임 DB와 시나리오를 초기화하고, 천하통일 서버를 닫아 정리합니다.',
        risk: 'CRITICAL',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.games.cancel',
        label: '진행 게임 취소',
        description: '지정 profile의 진행 중 게임을 취소하고 기록과 유산 포인트를 정산합니다.',
        risk: 'CRITICAL',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.reset.schedule',
        label: 'Profile 초기화 예약',
        description: '완료된 profile의 다음 초기화를 예약합니다.',
        risk: 'CRITICAL',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.resume.when-stopped',
        label: '중지 Profile 재개',
        description: '중지 또는 일시정지된 profile을 재개합니다.',
        risk: 'HIGH',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.survey.open',
        label: '게임 설문 운영',
        description: '지정 profile의 게임 내 설문 화면과 API를 운영합니다.',
        risk: 'MEDIUM',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.tournament',
        label: '게임 대회 운영',
        description: '지정 profile의 게임 내 토너먼트를 운영합니다.',
        risk: 'HIGH',
        scope: 'PROFILE',
    },
    {
        permission: 'admin.releases.manage',
        label: 'Gateway 릴리스',
        description: 'Gateway control plane을 배포하거나 이전 release로 전환합니다.',
        risk: 'CRITICAL',
        scope: 'GLOBAL',
    },
] as const;

const CAPABILITY_BY_PERMISSION = new Map(ADMIN_CAPABILITIES.map((entry) => [entry.permission, entry]));

export const getAdminCapability = (permission: string): AdminCapabilityDefinition | undefined =>
    CAPABILITY_BY_PERMISSION.get(permission);

export const resolveAdminActionCapability = (path: string, rawInput?: unknown): string | undefined => {
    if (path.endsWith('.users.createLocal')) return 'admin.users.create';
    if (path.includes('.users.')) return 'admin.users.manage';
    if (path.includes('.system.')) return 'admin.notice.manage';
    if (path.endsWith('.bulkReleases.request')) {
        const includeGateway =
            rawInput && typeof rawInput === 'object'
                ? (rawInput as { includeGateway?: unknown }).includeGateway
                : false;
        return includeGateway ? 'admin.releases.manage' : 'admin.profiles.deploy';
    }
    if (path.includes('.releases.')) return 'admin.releases.manage';
    if (path.endsWith('.profiles.requestAction') && rawInput && typeof rawInput === 'object') {
        const action = (rawInput as { action?: unknown }).action;
        if (action === 'RESET_SCHEDULED') return 'admin.reset.schedule';
        if (action === 'CLOSE_COMPLETED') return 'admin.scenarios.reset';
        if (action === 'RESUME') return 'admin.resume.when-stopped';
        if (action === 'UPDATE_RUNTIME_SETTINGS') return 'admin.profiles.runtime';
        if (action === 'OPEN_SURVEY') return 'admin.survey.open';
        return 'admin.profiles.runtime';
    }
    if (path.endsWith('.operations.requestDeploy')) return 'admin.profiles.deploy';
    if (path.endsWith('.operations.requestReset')) return 'admin.scenarios.reset';
    if (path.endsWith('.operations.requestGameCancellation')) return 'admin.games.cancel';
    if (path.endsWith('.operations.requestRuntime')) return 'admin.profiles.runtime';
    if (path.endsWith('.profiles.upsert') || path.endsWith('.profiles.updateMeta')) return 'admin.profiles.settings';
    if (path.endsWith('.profiles.setStatus') || path.endsWith('.profiles.reconcileNow')) {
        return 'admin.profiles.runtime';
    }
    if (path.endsWith('.profiles.install') || path.endsWith('.profiles.installNow')) {
        return 'admin.scenarios.reset';
    }
    if (
        path.endsWith('.profiles.requestBuild') ||
        path.endsWith('.profiles.setBuildStatus') ||
        path.endsWith('.profiles.cleanupWorkspaces')
    ) {
        return 'admin.profiles.deploy';
    }
    if (path.endsWith('.profiles.listScenarios')) {
        const sourceMode =
            rawInput && typeof rawInput === 'object' ? (rawInput as { sourceMode?: unknown }).sourceMode : undefined;
        return sourceMode === undefined || sourceMode === 'CURRENT' ? 'admin.scenarios.reset' : 'admin.profiles.deploy';
    }
    return undefined;
};

export const isProfileCapabilityPermission = (permission: string): boolean =>
    getAdminCapability(permission)?.scope === 'PROFILE';
