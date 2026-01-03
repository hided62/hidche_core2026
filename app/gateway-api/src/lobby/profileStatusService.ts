import type { GatewayOrchestratorHandle } from '../orchestrator/gatewayOrchestrator.js';
import type {
    GatewayProfileRecord,
    GatewayProfileRepository,
    GatewayProfileStatus,
} from '../orchestrator/profileRepository.js';

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

export type LobbyProfileStatus = {
    profileName: string;
    profile: string;
    scenario: string;
    status: GatewayProfileStatus;
    runtime: {
        apiRunning: boolean;
        daemonRunning: boolean;
    };
    map: LobbyMapSnapshot;
    myGeneral: LobbyGeneralStatus;
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
        return this.profiles;
    }

    setProfiles(profiles: LobbyProfileStatus[]): void {
        this.profiles = [...profiles];
    }
}

// 프로필 저장소/오케스트레이터를 이용해 로비 상태를 구성하는 기본 구현체.
export class RepositoryProfileStatusService implements GatewayProfileStatusService {
    constructor(
        private readonly profiles: GatewayProfileRepository,
        private readonly orchestrator: GatewayOrchestratorHandle
    ) {}

    async listLobbyProfiles(): Promise<LobbyProfileStatus[]> {
        const rows = await this.profiles.listProfiles();
        const runtimeStates = await this.orchestrator.listRuntimeStates(
            rows.map((profile) => profile.profileName)
        );
        const runtimeMap = new Map(
            runtimeStates.map((state) => [state.profileName, state])
        );
        return rows.map((row) => this.mapProfile(row, runtimeMap));
    }

    private mapProfile(
        row: GatewayProfileRecord,
        runtimeMap: Map<string, { apiRunning: boolean; daemonRunning: boolean }>
    ): LobbyProfileStatus {
        return {
            profileName: row.profileName,
            profile: row.profile,
            scenario: row.scenario,
            status: row.status,
            runtime: runtimeMap.get(row.profileName) ?? {
                apiRunning: false,
                daemonRunning: false,
            },
            map: {
                updatedAt: null,
                summary: null,
            },
            myGeneral: {
                exists: false,
                cityId: null,
                cityName: null,
                updatedAt: null,
            },
        };
    }
}
