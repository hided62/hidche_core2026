import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey } from '@sammo-ts/logic/constraints/types.js';
import { allowJoinAction, beNeutral, reqEnvValue, unknownOrDeny } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

const ACTION_NAME = '장수를 따라 임관';
const ACTION_KEY = 'che_장수대상임관';
const ARGS_SCHEMA = z.object({
    destGeneralID: z.number().int().positive(),
});
export type FollowAppointmentArgs = z.infer<typeof ARGS_SCHEMA>;

export interface FollowAppointmentResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral?: General<TriggerState>;
    destNation?: Nation;
    destNationGeneralCount?: number;
    initialNationGenLimit?: number;
}

const existsDestNation = (destGeneralID: number): Constraint => ({
    name: 'existsDestNation',
    requires: () => [{ kind: 'destGeneral', id: destGeneralID }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'destGeneral', id: destGeneralID };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '국가 정보가 없습니다.');
        }
        const destGeneral = view.get(req) as General | null;
        if (!destGeneral || destGeneral.nationId <= 0) {
            return { kind: 'deny', reason: '국가 정보가 없습니다.' };
        }
        return { kind: 'allow' };
    },
});

const allowJoinDestNation = (destGeneralID: number): Constraint => ({
    name: 'allowJoinDestNation',
    requires: () => [
        { kind: 'destGeneral', id: destGeneralID },
        { kind: 'generalList' },
        { kind: 'nationList' },
        { kind: 'env', key: 'relYear' },
        { kind: 'env', key: 'openingPartYear' },
        { kind: 'env', key: 'initialNationGenLimit' },
        { kind: 'env', key: 'maxGeneral' },
    ],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'destGeneral', id: destGeneralID };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '국가 정보가 없습니다.');
        }
        const destGeneral = view.get(req) as General | null;
        if (!destGeneral || destGeneral.nationId <= 0) {
            return { kind: 'deny', reason: '국가 정보가 없습니다.' };
        }

        const listReq: RequirementKey = { kind: 'generalList' };
        if (!view.has(listReq)) {
            return unknownOrDeny(ctx, [listReq], '장수 정보가 없습니다.');
        }
        const generals = view.get(listReq) as General[] | null;
        if (!generals) {
            return unknownOrDeny(ctx, [listReq], '장수 정보가 없습니다.');
        }

        const nationListReq: RequirementKey = { kind: 'nationList' };
        if (!view.has(nationListReq)) {
            return unknownOrDeny(ctx, [nationListReq], '국가 정보가 없습니다.');
        }
        const nations = view.get(nationListReq) as Nation[] | null;
        if (!nations) {
            return unknownOrDeny(ctx, [nationListReq], '국가 정보가 없습니다.');
        }
        const destNation = nations.find((nation) => nation.id === destGeneral.nationId);
        if (!destNation) {
            return { kind: 'deny', reason: '국가 정보가 없습니다.' };
        }

        const relYear =
            typeof view.get({ kind: 'env', key: 'relYear' }) === 'number'
                ? (view.get({ kind: 'env', key: 'relYear' }) as number)
                : 0;
        const openingPartYear =
            typeof view.get({ kind: 'env', key: 'openingPartYear' }) === 'number'
                ? (view.get({ kind: 'env', key: 'openingPartYear' }) as number)
                : 3;
        const initialNationGenLimit =
            typeof view.get({ kind: 'env', key: 'initialNationGenLimit' }) === 'number'
                ? (view.get({ kind: 'env', key: 'initialNationGenLimit' }) as number)
                : 10;
        const maxGeneral =
            typeof view.get({ kind: 'env', key: 'maxGeneral' }) === 'number'
                ? (view.get({ kind: 'env', key: 'maxGeneral' }) as number)
                : 500;

        const currentCount = generals.filter((general) => general.nationId === destNation.id).length;

        if (destNation.level === 0) {
            return { kind: 'allow' };
        }

        if (relYear < openingPartYear) {
            if (currentCount < initialNationGenLimit) {
                return { kind: 'allow' };
            }
            return { kind: 'deny', reason: '초반 등용 제한 인원을 초과했습니다.' };
        }

        if (currentCount < maxGeneral) {
            return { kind: 'allow' };
        }
        return { kind: 'deny', reason: '등용 제한 인원을 초과했습니다.' };
    },
});

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<
    TriggerState,
    FollowAppointmentArgs,
    FollowAppointmentResolveContext<TriggerState>
> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    getInheritanceActiveActionAmount(): number {
        return 1;
    }

    parseArgs(raw: unknown): FollowAppointmentArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: FollowAppointmentArgs): Constraint[] {
        return [reqEnvValue('join_mode', '!=', 'onlyRandom', '랜덤 임관만 가능합니다'), beNeutral(), allowJoinAction()];
    }

    buildConstraints(ctx: ConstraintContext, args: FollowAppointmentArgs): Constraint[] {
        void ctx;
        return [
            reqEnvValue('join_mode', '!=', 'onlyRandom', '랜덤 임관만 가능합니다'),
            beNeutral(),
            existsDestNation(args.destGeneralID),
            allowJoinDestNation(args.destGeneralID),
            allowJoinAction(),
        ];
    }

    resolve(
        context: FollowAppointmentResolveContext<TriggerState>,
        _args: FollowAppointmentArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const destGeneral = context.destGeneral;
        const destNation = context.destNation;
        if (!destNation) {
            throw new Error('임관 대상 국가 정보가 없습니다.');
        }

        const targetCityId = destGeneral?.cityId ?? destNation.capitalCityId ?? general.cityId;
        const josaYi = JosaUtil.pick(general.name, '이');

        context.addLog(`<D>${destNation.name}</>에 임관했습니다.`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`<D><b>${destNation.name}</b></>에 임관`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
        });
        context.addLog(`<Y>${general.name}</>${josaYi} <D><b>${destNation.name}</b></>에 <S>임관</>했습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.ACTION,
        });

        const initialNationGenLimit = context.initialNationGenLimit ?? 10;
        const destNationGeneralCount = context.destNationGeneralCount ?? 0;
        const expGain = destNationGeneralCount < initialNationGenLimit ? 700 : 100;

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>({
                    nationId: destNation.id,
                    officerLevel: 1,
                    cityId: targetCityId,
                    troopId: 0,
                    experience: general.experience + expGain,
                    meta: {
                        ...general.meta,
                        belong: 1,
                        officer_city: 0,
                        officerCity: 0,
                    },
                }),
                createNationPatchEffect(
                    {
                        meta: {
                            ...destNation.meta,
                            gennum:
                                typeof destNation.meta.gennum === 'number'
                                    ? destNation.meta.gennum + 1
                                    : destNationGeneralCount + 1,
                        },
                    },
                    destNation.id
                ),
            ],
        };
    }
}

export const actionContextBuilder: ActionContextBuilder<FollowAppointmentArgs> = (base, options) => {
    const destGeneralID = options.actionArgs.destGeneralID;
    if (typeof destGeneralID !== 'number') {
        return null;
    }
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }

    const destGeneral = worldRef.getGeneralById(destGeneralID) ?? undefined;
    const destNation = destGeneral ? (worldRef.getNationById(destGeneral.nationId) ?? undefined) : undefined;
    if (!destGeneral || !destNation) {
        return null;
    }

    const currentCount = worldRef.listGenerals().filter((general) => general.nationId === destNation.id).length;

    const constValues = (options.scenarioConfig.const ?? {}) as Record<string, unknown>;
    const initialNationGenLimitRaw = constValues.initialNationGenLimit;
    const initialNationGenLimit =
        typeof initialNationGenLimitRaw === 'number' && Number.isFinite(initialNationGenLimitRaw)
            ? Math.floor(initialNationGenLimitRaw)
            : 10;

    return {
        ...base,
        destGeneral,
        destNation,
        destNationGeneralCount: currentCount,
        initialNationGenLimit,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '인사',
    reqArg: true,
    availabilityArgs: {
        destGeneralID: 'number',
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
