import { JosaUtil } from '@sammo-ts/common';

import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';
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
    // Ref reads patients from the primary-key-backed `general` table. Make
    // that observed order explicit so the 50% draws stay attached to the
    // same general even when Core's in-memory insertion order differs.
    return list
        .filter((candidate) => candidate.id !== general.id)
        .sort((left, right) => left.id - right.id);
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
            logger?.push('<C>의술</>을 펼쳐 스스로 치료합니다!', { format: LogFormat.PLAIN });
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
            const generalName = general.name;
            logger?.pushForGeneral?.(
                patient.id,
                `<Y>${generalName}</>${JosaUtil.pick(generalName, '이')} <C>의술</>로써 치료해줍니다!`,
                { format: LogFormat.PLAIN }
            );
        }

        if (healed.length === 0) {
            return env;
        }

        // Ref overwrites `$curedPatientName` for each successful patient and
        // therefore names the last general in the ordered draw list.
        const curedPatientName = healed.at(-1)?.name ?? '장수';
        if (healed.length === 1) {
            const josa = JosaUtil.pick(curedPatientName, '을');
            logger?.push(`<C>의술</>을 펼쳐 도시의 장수 <Y>${curedPatientName}</>${josa} 치료합니다!`, {
                format: LogFormat.PLAIN,
            });
        } else {
            const otherCount = healed.length - 1;
            logger?.push(
                `<C>의술</>을 펼쳐 도시의 장수들 <Y>${curedPatientName}</> 외 <C>${otherCount}</>명을 치료합니다!`,
                { format: LogFormat.PLAIN }
            );
        }

        return env;
    }
}
