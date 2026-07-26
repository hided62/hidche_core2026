import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    allowDiplomacyBetweenStatus,
    availableStrategicCommand,
    beChief,
    existsDestNation,
    occupiedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import { allow, unknownOrDeny } from '@sammo-ts/logic/constraints/helpers.js';
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
} from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { JosaUtil } from '@sammo-ts/common';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

export type CounterStrategyArgs = z.infer<typeof ARGS_SCHEMA>;

export interface CounterStrategyResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation: Nation;
    friendlyGenerals: Array<General<TriggerState>>;
    destNationGenerals: Array<General<TriggerState>>;
    currentYearMonth: number;
}

const ACTION_NAME = '피장파장';
const TARGET_DELAY = 60;
const PRE_REQ_TURN = 1;
const EXP_DED_GAIN = 5 * (PRE_REQ_TURN + 1);

const STRATEGIC_COMMAND_KEYS = [
    'che_필사즉생',
    'che_백성동원',
    'che_수몰',
    'che_허보',
    'che_의병모집',
    'che_이호경식',
    'che_급습',
    'che_피장파장',
] as const;

const STRATEGIC_COMMANDS: Record<(typeof STRATEGIC_COMMAND_KEYS)[number], string> = {
    che_필사즉생: '필사즉생',
    che_백성동원: '백성동원',
    che_수몰: '수몰',
    che_허보: '허보',
    che_의병모집: '의병모집',
    che_이호경식: '이호경식',
    che_급습: '급습',
    che_피장파장: '피장파장',
};

const ARGS_SCHEMA = z.object({
    destNationId: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().positive()
    ),
    commandType: z
        .enum(STRATEGIC_COMMAND_KEYS)
        .refine((value) => value !== 'che_피장파장', '같은 전략은 선택할 수 없습니다.'),
});

const reqValidStrategicCommandType = (): Constraint => ({
    name: 'reqValidStrategicCommandType',
    requires: () => [{ kind: 'arg', key: 'commandType' }],
    test: (ctx) => {
        const commandType = ctx.args.commandType;
        if (typeof commandType !== 'string') {
            return unknownOrDeny(ctx, [{ kind: 'arg', key: 'commandType' }], '전략 정보가 없습니다.');
        }
        if (!Object.prototype.hasOwnProperty.call(STRATEGIC_COMMANDS, commandType)) {
            return { kind: 'deny', reason: '전략 정보가 올바르지 않습니다.' };
        }
        if (commandType === 'che_피장파장') {
            return { kind: 'deny', reason: '같은 전략은 선택할 수 없습니다.' };
        }
        return allow();
    },
});

const alwaysFail = (commandType: CounterStrategyArgs['commandType']): Constraint => ({
    // Legacy inserts AlwaysFail when the selected strategy is still cooling down.
    name: 'alwaysFail',
    requires: (ctx) => (ctx.nationId !== undefined ? [{ kind: 'nation', id: ctx.nationId }] : []),
    test: (ctx, view) => {
        if (ctx.nationId === undefined) {
            return { kind: 'deny', reason: '국가 정보가 없습니다.' };
        }
        const nation = view.get({ kind: 'nation', id: ctx.nationId }) as Nation | undefined;
        if (!nation) {
            return { kind: 'deny', reason: '국가 정보가 없습니다.' };
        }
        const raw = nation.meta[`next_execute_${STRATEGIC_COMMANDS[commandType]}`];
        const nextAvailable = typeof raw === 'number' ? raw : Number(raw ?? 0);
        const year = Number(ctx.env.currentYear ?? ctx.env.year);
        const month = Number(ctx.env.currentMonth ?? ctx.env.month);
        if (!Number.isFinite(year) || !Number.isFinite(month)) {
            return { kind: 'unknown', missing: [{ kind: 'env', key: 'currentYear' }] };
        }
        const currentYearMonth = Math.floor(year) * 12 + Math.floor(month) - 1;
        if (Number.isFinite(nextAvailable) && nextAvailable > currentYearMonth) {
            return { kind: 'deny', reason: '해당 전략을 아직 사용할 수 없습니다' };
        }
        return allow();
    },
});

// 피장파장 실행 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, CounterStrategyArgs> {
    readonly key = 'che_피장파장';
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(
        modules: Array<GeneralActionModule<TriggerState> | null | undefined> = [],
        private readonly initialNationGenLimit = 10
    ) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    getTargetPostReqTurn(context: CounterStrategyResolveContext<TriggerState>): number {
        const genCount = Math.max(context.friendlyGenerals.length, this.initialNationGenLimit);
        const base = Math.round(Math.sqrt(genCount * 2) * 10);
        const triggered = Math.round(this.pipeline.onCalcStrategic(context, ACTION_NAME, 'delay', base));
        return Math.max(triggered, Math.round(TARGET_DELAY * 1.2));
    }

    resolve(
        context: CounterStrategyResolveContext<TriggerState>,
        args: CounterStrategyArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, destNation } = context;
        const generalName = general.name;
        const generalJosa = JosaUtil.pick(generalName, '이');
        const nationName = nation?.name ?? '아국';
        const destNationName = destNation.name;
        const targetCommandName = STRATEGIC_COMMANDS[args.commandType] ?? args.commandType;
        const currentYearMonth = Number.isFinite(context.currentYearMonth) ? context.currentYearMonth : 0;
        const actionName = ACTION_NAME;
        const actionJosa = JosaUtil.pick(actionName, '을');

        general.experience += EXP_DED_GAIN;
        general.dedication += EXP_DED_GAIN;

        context.addLog(`<G><b>${targetCommandName}</b></> 전략의 ${actionName} 발동!`, {
            format: LogFormat.MONTH,
        });
        context.addLog(
            `<D><b>${destNationName}</b></>에 <G><b>${targetCommandName}</b></> <M>${ACTION_NAME}</>${actionJosa} 발동`,
            {
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }
        );

        const effects: Array<GeneralActionEffect<TriggerState>> = [];
        const broadcastMessage = `<Y>${generalName}</>${generalJosa} <G><b>${destNationName}</b></>에 <G><b>${targetCommandName}</b></> 전략의 <M>${ACTION_NAME}</>${actionJosa} 발동하였습니다.`;
        const destBroadcastMessage = `아국에 <G><b>${targetCommandName}</b></> 전략의 <M>${ACTION_NAME}</>${JosaUtil.pick(
            ACTION_NAME,
            '이'
        )} 발동되었습니다.`;

        for (const target of context.friendlyGenerals) {
            if (target.id === general.id) {
                continue;
            }
            effects.push(
                createLogEffect(broadcastMessage, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                })
            );
        }

        for (const target of context.destNationGenerals) {
            effects.push(
                createLogEffect(destBroadcastMessage, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: target.id,
                    format: LogFormat.PLAIN,
                })
            );
        }

        if (nation) {
            nation.meta = {
                ...(nation.meta as object),
                [`next_execute_${targetCommandName}`]: currentYearMonth + this.getTargetPostReqTurn(context),
            };
            effects.push(
                createLogEffect(broadcastMessage, {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    nationId: nation.id,
                    format: LogFormat.YEAR_MONTH,
                })
            );
        }

        const destMeta = destNation.meta;
        const destKey = `next_execute_${targetCommandName}`;
        const destRaw = destMeta[destKey];
        const destNext = typeof destRaw === 'number' ? destRaw : Number(destRaw ?? 0);
        effects.push(
            createNationPatchEffect(
                {
                    meta: {
                        ...destMeta,
                        [destKey]: Math.max(Number.isFinite(destNext) ? destNext : 0, currentYearMonth) + TARGET_DELAY,
                    },
                },
                destNation.id
            )
        );

        effects.push(
            createLogEffect(
                `<D><b>${nationName}</b></>의 <Y>${generalName}</>${generalJosa} 아국에 <G><b>${targetCommandName}</b></> <M>${ACTION_NAME}</>${actionJosa} 발동`,
                {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    nationId: destNation.id,
                    format: LogFormat.PLAIN,
                }
            )
        );

        if (nation?.id !== undefined) {
            effects.push(
                createLogEffect(
                    `<Y>${generalName}</>${generalJosa} <D><b>${destNationName}</b></>에 <G><b>${targetCommandName}</b></> <M>${ACTION_NAME}</>${actionJosa} 발동`,
                    {
                        scope: LogScope.NATION,
                        category: LogCategory.HISTORY,
                        nationId: nation.id,
                        format: LogFormat.YEAR_MONTH,
                    }
                )
            );
        }

        return { effects };
    }
}

// 피장파장 실행을 위한 정의/제약을 구성한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, CounterStrategyArgs, CounterStrategyResolveContext<TriggerState>> {
    public readonly key = 'che_피장파장';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined> = [], initialNationGenLimit = 10) {
        this.resolver = new ActionResolver(modules, initialNationGenLimit);
    }

    parseArgs(raw: unknown): CounterStrategyArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: CounterStrategyArgs): Constraint[] {
        return [occupiedCity(), beChief()];
    }

    buildConstraints(_ctx: ConstraintContext, _args: CounterStrategyArgs): Constraint[] {
        void _ctx;
        void _args;
        return [
            occupiedCity(),
            beChief(),
            existsDestNation(),
            allowDiplomacyBetweenStatus([0, 1], '선포, 전쟁중인 상대국에게만 가능합니다.'),
            availableStrategicCommand(),
            reqValidStrategicCommandType(),
            alwaysFail(_args.commandType),
        ];
    }

    getPreReqTurn(): number {
        return PRE_REQ_TURN;
    }

    getPostReqTurn(): number {
        return 8;
    }

    resolve(
        context: CounterStrategyResolveContext<TriggerState>,
        args: CounterStrategyArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

// 예약 턴 실행에 필요한 대상 국가/장수 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder<CounterStrategyArgs> = (base, options) => {
    const destNationId = options.actionArgs.destNationId;
    if (typeof destNationId !== 'number') {
        return null;
    }
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }
    const destNation = worldRef.getNationById(destNationId);
    if (!destNation) {
        return null;
    }
    const generals = worldRef.listGenerals();
    const friendlyGenerals = generals.filter((general) => general.nationId === base.general.nationId);
    const destNationGenerals = generals.filter((general) => general.nationId === destNationId);
    return {
        ...base,
        destNation,
        friendlyGenerals,
        destNationGenerals,
        currentYearMonth: options.world.currentYear * 12 + options.world.currentMonth - 1,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_피장파장',
    category: '전략',
    reqArg: true,
    availabilityArgs: { destNationId: 0, commandType: '' },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition(env.generalActionModules ?? [], env.initialNationGenLimit),
};
