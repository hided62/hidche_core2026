import type { WarTriggerCaller } from '../triggers.js';
import type { WarUnit } from '../units.js';

export interface WarTriggerModule {
    key: string;
    name: string;
    info: string;
    createTriggerList(unit: WarUnit): WarTriggerCaller | null;
}

export interface WarTriggerModuleExport {
    triggerModule: WarTriggerModule;
}
