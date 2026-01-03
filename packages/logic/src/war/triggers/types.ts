import type { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export interface WarTriggerModule {
    key: string;
    name: string;
    info: string;
    createTriggerList(unit: WarUnit): WarTriggerCaller | null;
}

export interface WarTriggerModuleExport {
    triggerModule: WarTriggerModule;
}
