export const GATEWAY_PROFILE_STATUSES = [
    'RESERVED',
    'PREOPEN',
    'RUNNING',
    'PAUSED',
    'COMPLETED',
    'STOPPED',
    'DISABLED',
] as const;

export type GatewayProfileStatus = (typeof GATEWAY_PROFILE_STATUSES)[number];

export type GatewayProfileCapabilities = {
    /** Frontend/API/daemon processes are expected to remain online. */
    runtimeExpected: boolean;
    /** A player may enter the game and read or edit data such as reserved turns. */
    userAccessible: boolean;
    /** The turn daemon may advance logical game time. */
    turnsRunning: boolean;
    /** An operator may move this state directly back to RUNNING. */
    operatorResumable: boolean;
};

const CAPABILITIES: Record<GatewayProfileStatus, GatewayProfileCapabilities> = {
    RESERVED: {
        runtimeExpected: false,
        userAccessible: false,
        turnsRunning: false,
        operatorResumable: false,
    },
    PREOPEN: {
        runtimeExpected: true,
        userAccessible: true,
        turnsRunning: false,
        operatorResumable: false,
    },
    RUNNING: {
        runtimeExpected: true,
        userAccessible: true,
        turnsRunning: true,
        operatorResumable: false,
    },
    PAUSED: {
        runtimeExpected: true,
        userAccessible: true,
        turnsRunning: false,
        operatorResumable: true,
    },
    COMPLETED: {
        runtimeExpected: true,
        userAccessible: true,
        turnsRunning: false,
        operatorResumable: false,
    },
    STOPPED: {
        runtimeExpected: false,
        userAccessible: false,
        turnsRunning: false,
        operatorResumable: true,
    },
    DISABLED: {
        runtimeExpected: false,
        userAccessible: false,
        turnsRunning: false,
        operatorResumable: false,
    },
};

export const gatewayProfileCapabilities = (status: GatewayProfileStatus): GatewayProfileCapabilities =>
    CAPABILITIES[status];
