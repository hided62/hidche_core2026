export interface ManagedProcessInfo {
    name: string;
    status: string;
    pid?: number;
    cwd?: string;
    script?: string;
    restartCount?: number;
}

export interface ProcessDefinition {
    name: string;
    script: string;
    cwd: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface ProcessManager {
    list(): Promise<ManagedProcessInfo[]>;
    start(definition: ProcessDefinition): Promise<void>;
    stop(name: string): Promise<void>;
    delete(name: string): Promise<void>;
}

const PM2_INTERNAL_ENV_KEYS = new Set([
    'NODE_APP_INSTANCE',
    'autorestart',
    'autostart',
    'created_at',
    'exec_interpreter',
    'exec_mode',
    'exit_code',
    'instance_var',
    'instances',
    'merge_logs',
    'name',
    'namespace',
    'node_args',
    'node_version',
    'pm_cwd',
    'pm_err_log_path',
    'pm_exec_path',
    'pm_id',
    'pm_out_log_path',
    'pm_pid_path',
    'pm_uptime',
    'restart_time',
    'status',
    'unstable_restarts',
    'version',
    'vizion',
    'watch',
]);

export const sanitizePm2IdentityEnv = (env: NodeJS.ProcessEnv | Record<string, string>): Record<string, string> =>
    Object.fromEntries(
        Object.entries(env).filter(
            (entry): entry is [string, string] =>
                typeof entry[1] === 'string' &&
                !entry[0].startsWith('axm_') &&
                !entry[0].startsWith('pm_') &&
                !PM2_INTERNAL_ENV_KEYS.has(entry[0])
        )
    );

export const sanitizeManagedProcessEnv = (env: NodeJS.ProcessEnv | Record<string, string>): Record<string, string> => {
    const sanitized = sanitizePm2IdentityEnv(env);
    delete sanitized.GATEWAY_ROLE;
    delete sanitized.GAME_API_ROLE;
    delete sanitized.GAME_ENGINE_ROLE;
    return sanitized;
};
