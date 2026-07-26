import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyBetweenStatus,
    beChief,
    existsDestGeneral,
    existsDestNation,
    notBeNeutral,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import {
    destGeneralBelongsToDestNation,
    resolveInstantDiplomacyResponse,
} from '@sammo-ts/logic/diplomacy/instantResponse.js';

export interface StopWarAcceptArgs {
    destNationId: number;
    destGeneralId: number;
}

export interface StopWarAcceptContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
    destGeneral: General<TriggerState>;
    currentYear: number;
    currentMonth: number;
}

const ACTION_NAME = '종전 수락';
const parseNationId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

const parseGeneralId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

// 종전 수락은 메시지와 연결되는 즉시 국가 커맨드로 사용한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, StopWarAcceptArgs, StopWarAcceptContext<TriggerState>> {
    public readonly key = 'che_종전수락';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): StopWarAcceptArgs | null {
        const data = raw as { destNationId?: unknown; destGeneralId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        const destGeneralId = parseGeneralId(data?.destGeneralId);
        if (destNationId === null || destGeneralId === null) {
            return null;
        }
        return { destNationId, destGeneralId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: StopWarAcceptArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            existsDestNation(),
            existsDestGeneral(),
            destGeneralBelongsToDestNation(),
            allowDiplomacyBetweenStatus([0, 1], '상대국과 선포, 전쟁중이지 않습니다.'),
        ];
    }

    resolve(context: StopWarAcceptContext<TriggerState>, _args: StopWarAcceptArgs): GeneralActionOutcome<TriggerState> {
        const nation = context.nation;
        if (!nation) {
            return { effects: [] };
        }
        const resolution = resolveInstantDiplomacyResponse<TriggerState>(
            {
                actor: context.general,
                actorNation: nation,
                proposer: context.destGeneral,
                proposerNation: context.destNation,
                currentYear: context.currentYear,
                currentMonth: context.currentMonth,
            },
            { action: 'stopWar' }
        );
        return {
            effects: resolution.effects,
        };
    }
}
