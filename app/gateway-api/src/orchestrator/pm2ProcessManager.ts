import { createRequire } from 'node:module';

import type * as Pm2 from 'pm2';
import type { ProcessManager, ManagedProcessInfo, ProcessDefinition } from './processManager.js';

type Pm2Module = typeof Pm2;

const require = createRequire(import.meta.url);

const loadPm2 = (): Pm2Module => require('pm2') as Pm2Module;

const withPm2 = async <T>(handler: (pm2: Pm2Module) => Promise<T>): Promise<T> => {
    const pm2 = loadPm2();
    await new Promise<void>((resolve, reject) => {
        pm2.connect((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
    try {
        return await handler(pm2);
    } finally {
        pm2.disconnect();
    }
};

export class Pm2ProcessManager implements ProcessManager {
    async list(): Promise<ManagedProcessInfo[]> {
        return withPm2(
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
                            })) ?? [];
                        resolve(normalized);
                    });
                })
        );
    }

    async start(definition: ProcessDefinition): Promise<void> {
        await withPm2(
            (pm2) =>
                new Promise<void>((resolve, reject) => {
                    pm2.start(
                        {
                            name: definition.name,
                            script: definition.script,
                            cwd: definition.cwd,
                            args: definition.args,
                            env: definition.env,
                            autorestart: true,
                            time: true,
                        },
                        (error) => {
                            if (error) {
                                reject(error);
                                return;
                            }
                            resolve();
                        }
                    );
                })
        );
    }

    async stop(name: string): Promise<void> {
        await withPm2(
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
        await withPm2(
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
