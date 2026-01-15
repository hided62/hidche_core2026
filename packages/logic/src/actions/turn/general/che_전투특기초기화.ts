import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { allow, unknownOrDeny, readGeneral } from '@sammo-ts/logic/constraints/helpers.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { setMetaNumber } from '@sammo-ts/logic/war/utils.js';

export interface ResetSpecialWarArgs {}

const ACTION_NAME = '전투 특기 초기화';

const hasSpecial = (value: string | null | undefined): boolean =>
    value !== null && value !== undefined && value !== 'None';

const reqWarSpecial = (): Constraint => ({
    name: 'ReqGeneralWarSpecial',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const general = readGeneral(ctx, view);
        if (!general) {
            const req = { kind: 'general', id: ctx.actorId } as const;
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (hasSpecial(general.role.specialWar)) {
            return allow();
        }
        return { kind: 'deny', reason: '특기가 없습니다.' };
    },
});

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ResetSpecialWarArgs> {
    public readonly key = 'che_전투특기초기화';
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): ResetSpecialWarArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: ResetSpecialWarArgs): Constraint[] {
        return [reqWarSpecial()];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: ResetSpecialWarArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        general.role.specialWar = null;
        setMetaNumber(general.meta, 'specAge2', general.age + 1);
        context.addLog('새로운 전투 특기를 가질 준비가 되었습니다.');
        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_전투특기초기화',
    category: '개인',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
