export interface ManagedProcessInfo {
    name: string;
    status: string;
    pid?: number;
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
