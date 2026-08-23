import { gatewayProfileCapabilities, type GatewayProfileCapabilities } from '@sammo-ts/common';
import type { GatewayOrchestratorHandle } from '../orchestrator/gatewayOrchestrator.js';
import type {
    GatewayOperationRecord,
    GatewayProfileRecord,
    GatewayProfileRepository,
    GatewayProfileStatus,
} from '../orchestrator/profileRepository.js';
import { orderGatewayProfiles, resolveGatewayProfileKoreanName } from '../profileOrder.js';

export type LobbyMapSnapshot = {
    updatedAt: string | null;
    summary?: string | null;
};

export type LobbyGeneralStatus = {
    exists: boolean;
    cityId: number | null;
    cityName: string | null;
    updatedAt: string | null;
};

const PUBLIC_AUTORUN_OPTIONS = ['develop', 'warp', 'recruit', 'recruit_high', 'train', 'battle', 'chief'] as const;
type PublicAutorunOption = (typeof PUBLIC_AUTORUN_OPTIONS)[number];

export type LobbyUpcomingReset = {
    phase: 'SCHEDULED' | 'PREPARING' | 'READY' | 'DELAYED';
    scheduledAt: string;
    preopenAt: string;
    openAt: string;
    scenarioId: number;
    scenarioTitle: string;
    turnTermMinutes: number;
    fictionMode: string;
    npcMode: number;
    defaultStatTotal: number;
    otherTextInfo: string;
    autorunUser: {
        limitMinutes: number;
        options: PublicAutorunOption[];
    } | null;
};

export type LobbyProfileStatus = {
    profileName: string;
    profile: string;
    instanceKey: string;
    currentScenario: string | null;
    /** @deprecated Rollback-compatible mirror of currentScenario. */
    scenario: string;
    status: GatewayProfileStatus;
    lifecycle: GatewayProfileCapabilities & {
        dataInitialized: boolean;
    };
    apiPort: number;
    runtime: {
        apiRunning: boolean;
        daemonRunning: boolean;
        auctionRunning: boolean;
        battleSimRunning: boolean;
        tournamentRunning: boolean;
    };
    upcomingReset?: LobbyUpcomingReset | null;
    korName: string;
    color: string;
};

export interface GatewayProfileStatusService {
    listLobbyProfiles(input: { userId?: string } | undefined): Promise<LobbyProfileStatus[]>;
}

// 로비에서 사용할 프로필 상태를 메모리에서 반환하는 구현체.
export class InMemoryProfileStatusService implements GatewayProfileStatusService {
    private profiles: LobbyProfileStatus[];

    constructor(initial: LobbyProfileStatus[] = []) {
        this.profiles = [...initial];
    }

    async listLobbyProfiles(): Promise<LobbyProfileStatus[]> {
        return orderGatewayProfiles(this.profiles);
    }

    setProfiles(profiles: LobbyProfileStatus[]): void {
        this.profiles = [...profiles];
    }
}

// 프로필 저장소/오케스트레이터를 이용해 로비 상태를 구성하는 기본 구현체.
export class RepositoryProfileStatusService implements GatewayProfileStatusService {
    constructor(
        private readonly profiles: GatewayProfileRepository,
        private readonly orchestrator: GatewayOrchestratorHandle,
        private readonly now: () => Date = () => new Date()
    ) {}

    async listLobbyProfiles(): Promise<LobbyProfileStatus[]> {
        const [profileRows, recentResetOperations] = await Promise.all([
            this.profiles.listProfiles(),
            this.profiles.listOperations({
                statuses: ['QUEUED', 'RUNNING', 'SUCCEEDED'],
                types: ['RESET'],
                limit: 200,
            }),
        ]);
        const rows = orderGatewayProfiles(profileRows);
        const runtimeStates = await this.orchestrator.listRuntimeStates(rows.map((profile) => profile.profileName));
        const runtimeMap = new Map(runtimeStates.map((state) => [state.profileName, state]));
        const announcementMap = new Map<string, LobbyUpcomingReset>();
        const profileStatusMap = new Map(rows.map((row) => [row.profileName, row.status]));
        const now = this.now();
        for (const operation of recentResetOperations) {
            if (announcementMap.has(operation.profileName)) continue;
            if (!shouldExposeUpcomingReset(operation, profileStatusMap.get(operation.profileName))) continue;
            const announcement = resolveUpcomingResetAnnouncement(operation, now);
            if (announcement) announcementMap.set(operation.profileName, announcement);
        }
        return rows.map((row) => this.mapProfile(row, runtimeMap, announcementMap));
    }

    private mapProfile(
        row: GatewayProfileRecord,
        runtimeMap: Map<
            string,
            {
                apiRunning: boolean;
                daemonRunning: boolean;
                auctionRunning: boolean;
                battleSimRunning: boolean;
                tournamentRunning: boolean;
            }
        >,
        announcementMap: Map<string, LobbyUpcomingReset>
    ): LobbyProfileStatus {
        const meta = row.meta;
        return {
            profileName: row.profileName,
            profile: row.profile,
            instanceKey: row.instanceKey,
            currentScenario: row.currentScenario,
            scenario: row.scenario,
            status: row.status,
            lifecycle: {
                ...gatewayProfileCapabilities(row.status),
                dataInitialized: row.currentScenario !== null,
            },
            apiPort: row.apiPort,
            runtime: runtimeMap.get(row.profileName) ?? {
                apiRunning: false,
                daemonRunning: false,
                auctionRunning: false,
                battleSimRunning: false,
                tournamentRunning: false,
            },
            upcomingReset: announcementMap.get(row.profileName) ?? null,
            korName: resolveGatewayProfileKoreanName(row.profile, meta.korName),
            color: (meta.color as string | undefined) ?? '#ffffff',
        };
    }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readDateTime = (value: unknown): string | null =>
    typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? value : null;

const readFiniteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const readAutorun = (value: unknown): LobbyUpcomingReset['autorunUser'] | undefined => {
    if (value === null) return null;
    const autorun = asRecord(value);
    const limitMinutes = readFiniteNumber(autorun?.limitMinutes);
    if (!autorun || !Number.isInteger(limitMinutes) || (limitMinutes ?? 0) <= 0 || !Array.isArray(autorun.options)) {
        return undefined;
    }
    const allowed = new Set<string>(PUBLIC_AUTORUN_OPTIONS);
    if (
        !autorun.options.every(
            (option): option is PublicAutorunOption => typeof option === 'string' && allowed.has(option)
        )
    ) {
        return undefined;
    }
    return {
        limitMinutes: limitMinutes as number,
        options: [...autorun.options],
    };
};

export const shouldExposeUpcomingReset = (
    operation: GatewayOperationRecord,
    profileStatus: GatewayProfileStatus | undefined
): boolean =>
    operation.type === 'RESET' &&
    (operation.status === 'QUEUED' ||
        operation.status === 'RUNNING' ||
        (operation.status === 'SUCCEEDED' && profileStatus === 'RESERVED'));

export const resolveUpcomingResetAnnouncement = (
    operation: GatewayOperationRecord,
    now: Date
): LobbyUpcomingReset | null => {
    if (operation.type !== 'RESET' || !['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(operation.status)) return null;
    const payload = asRecord(operation.payload);
    const announcement = asRecord(payload?.publicAnnouncement);
    if (!announcement || announcement.enabled !== true) return null;

    const scheduledAt = readDateTime(announcement.scheduledAt);
    const preopenAt = readDateTime(announcement.preopenAt);
    const openAt = readDateTime(announcement.openAt);
    const scenarioId = readFiniteNumber(announcement.scenarioId);
    const turnTermMinutes = readFiniteNumber(announcement.turnTermMinutes);
    const npcMode = readFiniteNumber(announcement.npcMode);
    const defaultStatTotal = readFiniteNumber(announcement.defaultStatTotal);
    const autorunUser = readAutorun(announcement.autorunUser);
    if (
        !scheduledAt ||
        !preopenAt ||
        !openAt ||
        !Number.isInteger(scenarioId) ||
        !Number.isInteger(turnTermMinutes) ||
        !Number.isInteger(npcMode) ||
        !Number.isInteger(defaultStatTotal) ||
        typeof announcement.scenarioTitle !== 'string' ||
        !announcement.scenarioTitle.trim() ||
        typeof announcement.fictionMode !== 'string' ||
        typeof announcement.otherTextInfo !== 'string' ||
        autorunUser === undefined
    ) {
        return null;
    }

    const nowMs = now.getTime();
    const phase =
        nowMs >= new Date(preopenAt).getTime()
            ? 'DELAYED'
            : operation.status === 'SUCCEEDED'
              ? 'READY'
              : operation.status === 'RUNNING' || nowMs >= new Date(scheduledAt).getTime()
                ? 'PREPARING'
                : 'SCHEDULED';
    return {
        phase,
        scheduledAt,
        preopenAt,
        openAt,
        scenarioId: scenarioId as number,
        scenarioTitle: announcement.scenarioTitle.trim(),
        turnTermMinutes: turnTermMinutes as number,
        fictionMode: announcement.fictionMode,
        npcMode: npcMode as number,
        defaultStatTotal: defaultStatTotal as number,
        otherTextInfo: announcement.otherTextInfo,
        autorunUser,
    };
};
