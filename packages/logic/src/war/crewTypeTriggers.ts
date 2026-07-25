import type { WarTriggerRegistry } from './triggers.js';
import { che_기병병종전투 } from './triggers/che_기병병종전투.js';
import { che_방어력증가5p } from './triggers/che_방어력증가5p.js';
import { che_선제사격발동, che_선제사격시도 } from './triggers/che_선제사격.js';
import { che_성벽부상무효 } from './triggers/che_성벽부상무효.js';
import { che_저지, che_저지_시도 } from './triggers/che_저지.js';

export const CREW_TYPE_WAR_TRIGGER_KEYS = [
    'che_성벽부상무효',
    'che_기병병종전투',
    'che_방어력증가5p',
    'che_선제사격시도',
    'che_선제사격발동',
    'che_저지시도',
    'che_저지발동',
] as const;

export const createCrewTypeWarTriggerRegistry = (): WarTriggerRegistry => ({
    che_성벽부상무효: (unit) => new che_성벽부상무효(unit),
    che_기병병종전투: (unit) => new che_기병병종전투(unit),
    che_방어력증가5p: (unit) => new che_방어력증가5p(unit),
    che_선제사격시도: (unit) => new che_선제사격시도(unit),
    che_선제사격발동: (unit) => new che_선제사격발동(unit),
    che_저지시도: (unit) => new che_저지_시도(unit),
    che_저지발동: (unit) => new che_저지(unit),
});
