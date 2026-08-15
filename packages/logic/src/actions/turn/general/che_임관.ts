import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beNeutral,
    existsDestNation,
    reqEnvValue,
    allowJoinAction,
    noPenalty,
    allowJoinDestNation,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type {
    ActionContextBase,
    ActionContextBuilder,
    ActionContextOptions,
} from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';
import { JosaUtil } from '@sammo-ts/common';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';

const ACTION_NAME = '임관';
const ARGS_SCHEMA = z.object({
    destNationId: z.number().int().positive(),
});
export type AppointmentArgs = z.infer<typeof ARGS_SCHEMA>;

interface AppointmentContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation?: Nation;
    destNationGeneralCount: number;
    destCityId: number;
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, AppointmentArgs> {
    public readonly key = 'che_임관';
    public readonly name = ACTION_NAME;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(private readonly env: TurnCommandEnv) {
        this.pipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
    }

    getInheritanceActiveActionAmount(): number {
        return 1;
    }

    parseArgs(raw: unknown): AppointmentArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildPermissionConstraints(_ctx: ConstraintContext, _args: AppointmentArgs): Constraint[] {
        return [reqEnvValue('join_mode', '!=', 'onlyRandom', '랜덤 임관만 가능합니다')];
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: AppointmentArgs): Constraint[] {
        return [
            reqEnvValue('join_mode', '!=', 'onlyRandom', '랜덤 임관만 가능합니다'),
            beNeutral(),
            allowJoinAction(),
            noPenalty('noChosenAssignment'),
        ];
    }

    buildConstraints(_ctx: ConstraintContext, _args: AppointmentArgs): Constraint[] {
        const env = _ctx.env;
        const relYear =
            typeof env.relYear === 'number'
                ? env.relYear
                : (typeof env.year === 'number' ? env.year : 0) -
                  (typeof env.startYear === 'number' ? env.startYear : 0);

        return [
            reqEnvValue('join_mode', '!=', 'onlyRandom', '랜덤 임관만 가능합니다'),
            beNeutral(),
            existsDestNation(),
            allowJoinDestNation(relYear),
            allowJoinAction(),
            noPenalty('noChosenAssignment'),
        ];
    }

    resolve(context: AppointmentContext<TriggerState>, args: AppointmentArgs): GeneralActionOutcome<TriggerState> {
        const destNation = context.destNation;
        const destNationName = destNation?.name ?? `${args.destNationId}`;
        context.addLog(`<D>${destNationName}</>에 임관했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`<D><b>${destNationName}</b></>에 임관`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });
        const josaYi = JosaUtil.pick(context.general.name, '이');
        context.addLog(`<Y>${context.general.name}</>${josaYi} <D><b>${destNationName}</b></>에 <S>임관</>했습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });

        tryApplyUniqueLottery(context, {
            acquireType: '아이템',
            reason: ACTION_NAME,
            nationName: destNationName,
        });

        const effects: GeneralActionOutcome<TriggerState>['effects'] = [
            createGeneralPatchEffect<TriggerState>({
                nationId: args.destNationId,
                officerLevel: 1,
                cityId: context.destCityId,
                troopId: 0,
                experience:
                    context.general.experience +
                    this.pipeline.onCalcStat(
                        context,
                        'experience',
                        context.destNationGeneralCount < this.env.initialNationGenLimit ? 700 : 100
                    ),
                meta: {
                    ...context.general.meta,
                    officer_city: 0,
                    belong: 1,
                },
            }),
        ];
        if (destNation) {
            effects.push(
                createNationPatchEffect(
                    {
                        meta: {
                            ...destNation.meta,
                            gennum: context.destNationGeneralCount + 1,
                        },
                    },
                    destNation.id
                )
            );
        }

        return { effects };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder: ActionContextBuilder<AppointmentArgs> = (
    base: ActionContextBase,
    options: ActionContextOptions<AppointmentArgs>
) => {
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }
    const destNation = worldRef.getNationById(options.actionArgs.destNationId);
    if (!destNation) {
        return null;
    }
    const nationGenerals = worldRef.listGenerals().filter((general) => general.nationId === destNation.id);
    const monarch = nationGenerals.find((general) => general.officerLevel === 12);
    const cachedGeneralCount = destNation.meta.gennum;
    return {
        ...base,
        destNation,
        destNationGeneralCount:
            typeof cachedGeneralCount === 'number' && Number.isFinite(cachedGeneralCount)
                ? cachedGeneralCount
                : nationGenerals.length,
        destCityId: monarch?.cityId ?? destNation.capitalCityId ?? base.general.cityId,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_임관',
    category: '전략',
    reqArg: true,
    availabilityArgs: { destNationId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
