import { WarTriggerCaller, type WarTriggerRegistry } from './triggers.js';
import { che_기병병종전투 } from './triggers/che_기병병종전투.js';
import { che_방어력증가5p } from './triggers/che_방어력증가5p.js';
import { che_선제사격발동, che_선제사격시도 } from './triggers/che_선제사격.js';
import { che_성벽부상무효 } from './triggers/che_성벽부상무효.js';
import { che_저지, che_저지_시도 } from './triggers/che_저지.js';
import { che_필살발동, che_필살시도 } from './triggers/che_필살.js';
import { che_회피발동, che_회피시도 } from './triggers/che_회피.js';
import { che_계략발동, che_계략실패, che_계략시도 } from './triggers/che_계략.js';

export const CREW_TYPE_WAR_TRIGGER_KEYS = [
    'che_성벽부상무효',
    'che_기병병종전투',
    'che_방어력증가5p',
    'che_선제사격시도',
    'che_선제사격발동',
    'che_저지시도',
    'che_저지발동',
    'che_필살',
    'che_회피',
    'che_계략',
] as const;

export const createCrewTypeWarTriggerRegistry = (): WarTriggerRegistry => ({
    che_성벽부상무효: (unit) => new che_성벽부상무효(unit),
    che_기병병종전투: (unit) => new che_기병병종전투(unit),
    che_방어력증가5p: (unit) => new che_방어력증가5p(unit),
    che_선제사격시도: (unit) => new che_선제사격시도(unit),
    che_선제사격발동: (unit) => new che_선제사격발동(unit),
    che_저지시도: (unit) => new che_저지_시도(unit),
    che_저지발동: (unit) => new che_저지(unit),
    che_필살: (unit) => new WarTriggerCaller(new che_필살시도(unit), new che_필살발동(unit)),
    che_회피: (unit) => new WarTriggerCaller(new che_회피시도(unit), new che_회피발동(unit)),
    che_계략: (unit) =>
        new WarTriggerCaller(new che_계략시도(unit), new che_계략발동(unit), new che_계략실패(unit)),
});
