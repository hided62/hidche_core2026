import { JosaUtil } from '@sammo-ts/common';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseGeneralTrigger, type GeneralTriggerContext } from '@sammo-ts/logic/triggers/general.js';
import type { General } from '@sammo-ts/logic/domain/entities.js';

interface ItemHealOptions {
    itemKey: string;
    itemName: string;
    itemRawName: string;
    injuryTarget: number;
    consume: () => boolean;
}

// 아이템(환약 등)으로 턴 실행 전 부상을 회복하는 트리거.
export class CheItemHealTrigger extends BaseGeneralTrigger {
    public readonly priority = TriggerPriority.Begin - 10;
    private readonly options: ItemHealOptions;

    constructor(general: General, options: ItemHealOptions) {
        super(general);
        this.options = options;
    }

    action(context: GeneralTriggerContext, env: Record<string, unknown>): Record<string, unknown> {
        const { general } = context;
        if (general.role.items.item !== this.options.itemKey) {
            return env;
        }
        if (general.injury < this.options.injuryTarget) {
            return env;
        }

        general.injury = 0;
        context.skill.activate('pre.부상경감', 'pre.치료');

        const josa = JosaUtil.pick(this.options.itemRawName, '을');
        context.log?.push(`<C>${this.options.itemName}</>${josa} 사용하여 치료합니다!`);

        if (this.options.consume()) {
            general.role.items.item = null;
        }

        return env;
    }
}
