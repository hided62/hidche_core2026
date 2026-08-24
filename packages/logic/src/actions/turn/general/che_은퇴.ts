import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey } from '@sammo-ts/logic/constraints/types.js';
import { allow, unknownOrDeny } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { JosaUtil, LEGACY_RANK_DATA_TYPES, rankDataMetaKey } from '@sammo-ts/common';

export interface RetireArgs {}

const ACTION_NAME = '은퇴';
const ACTION_KEY = 'che_은퇴';

const REQ_AGE = 60;
const hasPendingRandomUnique = (value: unknown): boolean =>
    value === true || value === 1 || (typeof value === 'string' && (value === '1' || value.toLowerCase() === 'true'));

const reqGeneralValue = (): Constraint => ({
    name: 'reqGeneralValue',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const generalKey: RequirementKey = { kind: 'general', id: ctx.actorId };
        const general = view.get(generalKey) as General | null; // Cast to access age
        if (!general) return unknownOrDeny(ctx, [generalKey], '장수 정보가 없습니다.');
        if (general.age >= REQ_AGE) return allow();
        return { kind: 'deny', reason: `나이가 ${REQ_AGE}세 이상이어야 합니다.` };
    },
});

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, RetireArgs> {
    readonly key = ACTION_KEY;

    resolve(context: GeneralActionResolveContext<TriggerState>, _args: RetireArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        const josaYi = JosaUtil.pick(general.name, '이');
        context.addLog(`<Y>${general.name}</>${josaYi} <R>은퇴</>하고 그 자손이 유지를 이어받았습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });
        context.addLog('나이가 들어 <R>은퇴</>하고 자손에게 자리를 물려줍니다.', {
            category: LogCategory.ACTION,
            format: LogFormat.PLAIN,
        });
        context.addLog('나이가 들어 은퇴하고, 자손에게 관직을 물려줌', {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });
        context.addLog('은퇴하였습니다.', {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        const hadPendingRandomUnique = hasPendingRandomUnique(general.meta.inheritRandomUnique);
        const acquiredUnique = tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });
        const refundedPendingRandomUnique =
            hadPendingRandomUnique && !acquiredUnique && !hasPendingRandomUnique(general.meta.inheritRandomUnique);
        const postLotterySpentDynamic = general.meta.inherit_spent_dyn;

        // The lottery can consume a pending inheritance reservation and mutate meta.
        // Build the reborn projection afterwards so the consumed flag is not restored
        // by the action patch while still applying the retirement resets atomically.
        const nextMeta = { ...general.meta };
        for (const key of ['dex1', 'dex2', 'dex3', 'dex4', 'dex5'] as const) {
            const value = typeof nextMeta[key] === 'number' ? nextMeta[key] : 0;
            nextMeta[key] = Math.round(value * 0.5);
        }
        delete nextMeta.specAge;
        delete nextMeta.specAge2;
        nextMeta.specage = 0;
        nextMeta.specage2 = 0;
        nextMeta.inherit_lived_month = 0;
        nextMeta.inherit_active_action = 0;
        for (const type of LEGACY_RANK_DATA_TYPES) {
            nextMeta[rankDataMetaKey(type)] = 0;
        }
        if (refundedPendingRandomUnique && typeof postLotterySpentDynamic === 'number') {
            nextMeta.inherit_spent_dyn = postLotterySpentDynamic;
        }

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    age: 20,
                    stats: {
                        leadership: Math.max(10, Math.round(general.stats.leadership * 0.85)),
                        strength: Math.max(10, Math.round(general.stats.strength * 0.85)),
                        intelligence: Math.max(10, Math.round(general.stats.intelligence * 0.85)),
                    },
                    injury: 0,
                    experience: Math.round(general.experience * 0.5),
                    dedication: Math.round(general.dedication * 0.5),
                    meta: nextMeta,
                },
                general.id
            )
        );

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, RetireArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    getPreReqTurn(): number {
        return 1;
    }

    getPostReqTurn(): number {
        return 0;
    }

    parseArgs(_raw: unknown): RetireArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: RetireArgs): Constraint[] {
        return [reqGeneralValue()];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: RetireArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_은퇴',
    category: '개인',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
