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

export interface NonAggressionCancelAcceptArgs {
    destNationId: number;
    destGeneralId: number;
}

export interface NonAggressionCancelAcceptContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
    destGeneral: General<TriggerState>;
    currentYear: number;
    currentMonth: number;
}

const ACTION_NAME = '불가침 파기 수락';
const DIPLOMACY_NON_AGGRESSION = 7;

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

// 불가침 파기 수락은 메시지와 연결되는 즉시 국가 커맨드로 사용한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<
    TriggerState,
    NonAggressionCancelAcceptArgs,
    NonAggressionCancelAcceptContext<TriggerState>
> {
    public readonly key = 'che_불가침파기수락';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): NonAggressionCancelAcceptArgs | null {
        const data = raw as { destNationId?: unknown; destGeneralId?: unknown };
        const destNationId = parseNationId(data?.destNationId);
        const destGeneralId = parseGeneralId(data?.destGeneralId);
        if (destNationId === null || destGeneralId === null) {
            return null;
        }
        return { destNationId, destGeneralId };
    }

    buildConstraints(_ctx: ConstraintContext, _args: NonAggressionCancelAcceptArgs): Constraint[] {
        return [
            beChief(),
            notBeNeutral(),
            existsDestNation(),
            existsDestGeneral(),
            destGeneralBelongsToDestNation(),
            allowDiplomacyBetweenStatus([DIPLOMACY_NON_AGGRESSION], '불가침 중인 상대국에게만 가능합니다.'),
        ];
    }

    resolve(
        context: NonAggressionCancelAcceptContext<TriggerState>,
        _args: NonAggressionCancelAcceptArgs
    ): GeneralActionOutcome<TriggerState> {
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
            { action: 'cancelNA' }
        );
        return {
            effects: resolution.effects,
        };
    }
}
