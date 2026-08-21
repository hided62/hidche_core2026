import { createRequire } from 'node:module';

import type * as Pm2 from 'pm2';
import {
    sanitizePm2IdentityEnv,
    type ProcessManager,
    type ManagedProcessInfo,
    type ProcessDefinition,
} from './processManager.js';

export interface Pm2Client {
    connect(callback: (error?: Error) => void): void;
    disconnect(): void;
    list(callback: (error: Error | null, list?: Pm2.ProcessDescription[]) => void): void;
    start(options: Pm2.StartOptions, callback: (error?: Error) => void): void;
    stop(name: string, callback: (error?: Error) => void): void;
    delete(name: string, callback: (error?: Error) => void): void;
}

export interface Pm2ProcessManagerOptions {
    loadPm2?: () => Pm2Client;
    connectTimeoutMs?: number;
    listTimeoutMs?: number;
    mutationTimeoutMs?: number;
}

const require = createRequire(import.meta.url);

const loadPm2 = (): Pm2Client => require('pm2') as Pm2Client;
const DEFAULT_PM2_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_PM2_LIST_TIMEOUT_MS = 5_000;
const DEFAULT_PM2_MUTATION_TIMEOUT_MS = 30_000;

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
        timer.unref();
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });

export const buildPm2StartOptions = (definition: ProcessDefinition) => ({
    name: definition.name,
    script: definition.script,
    cwd: definition.cwd,
    args: definition.args,
    env: sanitizePm2IdentityEnv(definition.env ?? {}),
    autorestart: true,
    max_restarts: 5,
    min_uptime: 10_000,
    restart_delay: 2_000,
    kill_timeout: 15_000,
    time: true,
});

export class Pm2ProcessManager implements ProcessManager {
    private readonly loadPm2: () => Pm2Client;
    private readonly connectTimeoutMs: number;
    private readonly listTimeoutMs: number;
    private readonly mutationTimeoutMs: number;
    private sessionTail: Promise<void> = Promise.resolve();

    constructor(options: Pm2ProcessManagerOptions = {}) {
        this.loadPm2 = options.loadPm2 ?? loadPm2;
        this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_PM2_CONNECT_TIMEOUT_MS;
        this.listTimeoutMs = options.listTimeoutMs ?? DEFAULT_PM2_LIST_TIMEOUT_MS;
        this.mutationTimeoutMs = options.mutationTimeoutMs ?? DEFAULT_PM2_MUTATION_TIMEOUT_MS;
    }

    private withPm2<T>(label: string, timeoutMs: number, handler: (pm2: Pm2Client) => Promise<T>): Promise<T> {
        const task = this.sessionTail.then(async () => {
            const pm2 = this.loadPm2();
            try {
                await withTimeout(
                    new Promise<void>((resolve, reject) => {
                        pm2.connect((error) => {
                            if (error) {
                                reject(error);
                                return;
                            }
                            resolve();
                        });
                    }),
                    this.connectTimeoutMs,
                    'PM2 connect'
                );
                return await withTimeout(handler(pm2), timeoutMs, label);
            } finally {
                pm2.disconnect();
            }
        });
        this.sessionTail = task.then(
            () => undefined,
            () => undefined
        );
        return task;
    }

    async list(): Promise<ManagedProcessInfo[]> {
        return this.withPm2(
            'PM2 list',
            this.listTimeoutMs,
            (pm2) =>
                new Promise<ManagedProcessInfo[]>((resolve, reject) => {
                    pm2.list((error, list) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        const normalized =
                            list?.map((item) => ({
                                name: item.name ?? 'unknown',
                                status: item.pm2_env?.status ?? 'unknown',
                                pid: item.pid ?? undefined,
                                cwd: item.pm2_env?.pm_cwd ?? undefined,
                                script: item.pm2_env?.pm_exec_path ?? undefined,
                                restartCount: item.pm2_env?.restart_time ?? 0,
                            })) ?? [];
                        resolve(normalized);
                    });
                })
        );
    }

    async start(definition: ProcessDefinition): Promise<void> {
        await this.withPm2(
            `PM2 start ${definition.name}`,
            this.mutationTimeoutMs,
            (pm2) =>
                new Promise<void>((resolve, reject) => {
                    pm2.list((listError, list) => {
                        if (listError) {
                            reject(listError);
                            return;
                        }
                        if (list?.some((item) => item.name === definition.name)) {
                            reject(new Error(`PM2 process name already exists: ${definition.name}`));
                            return;
                        }
                        pm2.start(
                            buildPm2StartOptions(definition),
                            (error) => {
                                if (error) {
                                    reject(error);
                                    return;
                                }
                                resolve();
                            }
                        );
                    });
                })
        );
    }

    async stop(name: string): Promise<void> {
        await this.withPm2(
            `PM2 stop ${name}`,
            this.mutationTimeoutMs,
            (pm2) =>
                new Promise<void>((resolve, reject) => {
                    pm2.stop(name, (error) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve();
                    });
                })
        );
    }

    async delete(name: string): Promise<void> {
        await this.withPm2(
            `PM2 delete ${name}`,
            this.mutationTimeoutMs,
            (pm2) =>
                new Promise<void>((resolve, reject) => {
                    pm2.delete(name, (error) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve();
                    });
                })
        );
    }
}
