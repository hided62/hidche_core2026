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
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface RetireArgs {}

const ACTION_NAME = '은퇴';
const ACTION_KEY = 'che_은퇴';

const REQ_AGE = 60;

const reqAge = (): Constraint => ({
    name: 'ReqAge',
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

        // Logs
        context.addLog(`은퇴하였습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        // Rebirth Logic (Simulated)
        // 1. Reset Stats (Randomize slightly?)
        // Let's keep total stat points but re-distribute or small variation?
        // Legacy: complete re-roll usually.
        // Simple implementation: Random re-roll around average 70?

        const rng = context.rng;
        const newLead = rng.nextInt(30, 90);
        const newStr = rng.nextInt(30, 90);
        const newIntel = rng.nextInt(30, 90);

        // 2. Reset Age
        const newAge = 20;

        // 3. Reset Exp/Ded
        const newExp = 0;
        const newDed = 0;

        // 4. Reset Meta (Inheritance points?)
        // Legacy: increases inheritance point.
        // We'll increment inheritance point in meta.
        const inheritance =
            (typeof general.meta.inheritance_point === 'number' ? general.meta.inheritance_point : 0) + 1;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    age: newAge,
                    stats: {
                        leadership: newLead,
                        strength: newStr,
                        intelligence: newIntel,
                    },
                    experience: newExp,
                    dedication: newDed,
                    meta: {
                        ...general.meta,
                        inheritance_point: inheritance,
                        // Clear other temp vars?
                    },
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

    parseArgs(_raw: unknown): RetireArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: RetireArgs): Constraint[] {
        return [reqAge()];
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
