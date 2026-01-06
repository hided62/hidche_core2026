import { JosaUtil } from '@sammo-ts/common';

import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseGeneralTrigger, type GeneralTriggerContext } from '@sammo-ts/logic/triggers/general.js';

const HEAL_PROBABILITY = 0.5;
const MIN_HEAL_INJURY = 10;

const resolveCityGenerals = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>,
    context: GeneralTriggerContext<TriggerState>
): General<TriggerState>[] => {
    const worldView = context.worldView;
    if (!worldView) {
        return [];
    }
    const list = worldView.listGeneralsByCity
        ? worldView.listGeneralsByCity(general.cityId)
        : worldView.listGenerals().filter((candidate) => candidate.cityId === general.cityId);
    return list.filter((candidate) => candidate.id !== general.id);
};

// 의술 특기의 도시 치료 트리거.
export class CheUisulCityHealTrigger<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends BaseGeneralTrigger<TriggerState> {
    public readonly priority = TriggerPriority.Begin + 10;

    public constructor(
        general: General<TriggerState>,
        private multiplier: number = 1
    ) {
        super(general);
    }

    action(context: GeneralTriggerContext<TriggerState>, env: Record<string, unknown>): Record<string, unknown> {
        const general = context.general;
        const rng = context.rng;
        const logger = context.log;

        if (general.injury > 0) {
            general.injury = 0;
            context.skill.activate('pre.부상경감', 'pre.치료');
            logger?.push('<C>의술</>을 펼쳐 스스로 치료합니다!');
        }

        const candidates = resolveCityGenerals(general, context).filter((candidate) => {
            if (candidate.injury <= MIN_HEAL_INJURY) {
                return false;
            }
            if (general.nationId === 0) {
                return candidate.nationId === 0;
            }
            return true;
        });

        const healed = candidates.filter(() => rng.nextBool(HEAL_PROBABILITY * this.multiplier));

        for (const patient of healed) {
            patient.injury = 0;
        }

        if (healed.length === 0) {
            return env;
        }

        const firstName = healed[0]?.name ?? '장수';
        if (healed.length === 1) {
            const josa = JosaUtil.pick(firstName, '을');
            logger?.push(`<C>의술</>을 펼쳐 도시의 장수 <Y>${firstName}</>${josa} 치료합니다!`);
        } else {
            const otherCount = healed.length - 1;
            logger?.push(`<C>의술</>을 펼쳐 도시의 장수들 <Y>${firstName}</> 외 <C>${otherCount}</>명을 치료합니다!`);
        }

        return env;
    }
}
