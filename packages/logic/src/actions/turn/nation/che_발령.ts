import type {
    City,
    General,
    GeneralTriggerState,
    TriggerValue,
} from '../../../domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
} from '../../../constraints/types.js';
import {
    alwaysFail,
    beChief,
    existsDestGeneral,
    friendlyDestGeneral,
    notBeNeutral,
    occupiedCity,
    occupiedDestCity,
    suppliedCity,
    suppliedDestCity,
} from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import { createGeneralPatchEffect, createLogEffect } from '../../engine.js';
import { LogCategory, LogFormat, LogScope } from '../../../logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { TurnCommandEnv } from '../commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';

export interface AssignmentArgs {
    destGeneralId: number;
    destCityId: number;
}

export interface AssignmentResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral: General<TriggerState>;
    destCity: City;
    currentYear: number;
    currentMonth: number;
    turnTermMinutes?: number;
    generalTurnTime?: Date;
    destGeneralTurnTime?: Date;
}

export interface AssignmentEnvironment {
    formatCityName?: (city: City) => string;
}

const ACTION_NAME = '발령';

const joinYearMonth = (year: number, month: number): number =>
    year * 12 + month - 1;

const cutTurn = (time: Date, turnTermMinutes: number): number => {
    const turnMs = turnTermMinutes * 60 * 1000;
    return Math.floor(time.getTime() / turnMs);
};

const resolveLastAssignment = (
    context: AssignmentResolveContext
): number => {
    let yearMonth = joinYearMonth(context.currentYear, context.currentMonth);
    const term = context.turnTermMinutes;
    const srcTime = context.generalTurnTime;
    const destTime = context.destGeneralTurnTime;
    if (term && srcTime && destTime) {
        if (cutTurn(srcTime, term) !== cutTurn(destTime, term)) {
            yearMonth += 1;
        }
    }
    return yearMonth;
};

const addMetaValue = (
    meta: Record<string, TriggerValue>,
    key: string,
    value: TriggerValue
): Record<string, TriggerValue> => ({
    ...meta,
    [key]: value,
});

// 발령 결과를 계산한다.
export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    private readonly env: AssignmentEnvironment;

    constructor(env: AssignmentEnvironment) {
        this.env = env;
    }

    resolve(
        context: AssignmentResolveContext<TriggerState>,
        _args: AssignmentArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const destGeneral = context.destGeneral;
        const destCity = context.destCity;
        const cityName = this.env.formatCityName
            ? this.env.formatCityName(destCity)
            : destCity.name;
        const cityJosa = JosaUtil.pick(cityName, '로');
        const generalJosa = JosaUtil.pick(destGeneral.name, '을');
        const yearMonth = resolveLastAssignment(context);

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createGeneralPatchEffect(
                {
                    cityId: destCity.id,
                    meta: addMetaValue(destGeneral.meta, 'last발령', yearMonth),
                },
                destGeneral.id
            ),
        ];

        effects.push(
            createLogEffect(
                `<Y>${context.general.name}</>에 의해 <G><b>${cityName}</b></>${cityJosa} 발령됐습니다.`,
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: destGeneral.id,
                    format: LogFormat.MONTH,
                }
            )
        );
        effects.push(
            createLogEffect(
                `<Y>${destGeneral.name}</>${generalJosa} <G><b>${cityName}</b></>${cityJosa} 발령했습니다.`,
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }
            )
        );

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<
        TriggerState,
        AssignmentArgs,
        AssignmentResolveContext<TriggerState>
    > {
    public readonly key = 'che_발령';
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: AssignmentEnvironment) {
        this.resolver = new ActionResolver(env);
    }

    parseArgs(raw: unknown): AssignmentArgs | null {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        const data = raw as {
            destGeneralId?: unknown;
            destCityId?: unknown;
        };
        if (typeof data.destGeneralId !== 'number') {
            return null;
        }
        if (typeof data.destCityId !== 'number') {
            return null;
        }
        return {
            destGeneralId: data.destGeneralId,
            destCityId: data.destCityId,
        };
    }

    buildConstraints(
        ctx: ConstraintContext,
        _args: AssignmentArgs
    ): Constraint[] {
        void _args;
        if (ctx.destGeneralId === ctx.actorId) {
            return [alwaysFail('본인입니다')];
        }
        return [
            beChief(),
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            existsDestGeneral(),
            friendlyDestGeneral(),
            occupiedDestCity(),
            suppliedDestCity(),
        ];
    }

    resolve(
        context: AssignmentResolveContext<TriggerState>,
        args: AssignmentArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_발령',
    category: '인사',
    reqArg: true,
    args: { destGeneralId: 0, destCityId: 0 },
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition({}),
};
