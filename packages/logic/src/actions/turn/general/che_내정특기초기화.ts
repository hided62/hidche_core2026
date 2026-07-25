import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { allow, unknownOrDeny, readGeneral } from '@sammo-ts/logic/constraints/helpers.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { setMetaNumber } from '@sammo-ts/logic/war/utils.js';
import { DOMESTIC_TRAIT_KEYS } from '@sammo-ts/logic/triggers/special/domestic/index.js';

export interface ResetSpecialDomesticArgs {}

const ACTION_NAME = '내정 특기 초기화';

const hasSpecial = (value: string | null | undefined): boolean =>
    value !== null && value !== undefined && value !== 'None';

const reqGeneralValue = (): Constraint => ({
    name: 'reqGeneralValue',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const general = readGeneral(ctx, view);
        if (!general) {
            const req = { kind: 'general', id: ctx.actorId } as const;
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (hasSpecial(general.role.specialDomestic)) {
            return allow();
        }
        return { kind: 'deny', reason: '특기가 없습니다.' };
    },
});

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ResetSpecialDomesticArgs> {
    public readonly key = 'che_내정특기초기화';
    public readonly name = ACTION_NAME;

    getPreReqTurn(): number {
        return 1;
    }

    getPostReqTurn(): number {
        return 60;
    }

    getProgressText(
        _context: GeneralActionResolveContext<TriggerState>,
        _args: ResetSpecialDomesticArgs,
        term: number,
        termMax: number
    ): string {
        return `새로운 적성을 찾는 중... (${term}/${termMax})`;
    }

    parseArgs(_raw: unknown): ResetSpecialDomesticArgs | null {
        void _raw;
        return {};
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: ResetSpecialDomesticArgs): Constraint[] {
        return [reqGeneralValue()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: ResetSpecialDomesticArgs): Constraint[] {
        return [reqGeneralValue()];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: ResetSpecialDomesticArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const previous = general.meta.prev_types_special;
        const previousTypes = Array.isArray(previous)
            ? previous.filter((value): value is string => typeof value === 'string')
            : [];
        const nextPreviousTypes = [...previousTypes, general.role.specialDomestic!];
        general.meta.prev_types_special =
            nextPreviousTypes.length === DOMESTIC_TRAIT_KEYS.length
                ? [general.role.specialDomestic!]
                : nextPreviousTypes;
        general.role.specialDomestic = null;
        delete general.meta.specAge;
        setMetaNumber(general.meta, 'specage', general.age + 1);
        context.addLog('새로운 내정 특기를 가질 준비가 되었습니다.');
        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_내정특기초기화',
    category: '개인',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
