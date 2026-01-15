import type { City, GeneralTriggerState, Nation, TriggerValue } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    disallowDiplomacyBetweenStatus,
    occupiedCity,
    occupiedDestCity,
    suppliedCity,
    suppliedDestCity,
} from '@sammo-ts/logic/constraints/presets.js';
import { allow, unknownOrDeny } from '@sammo-ts/logic/constraints/helpers.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createCityPatchEffect, createLogEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { JosaUtil } from '@sammo-ts/common';
import type { NationTurnCommandSpec } from './index.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destCityId: z.preprocess(
        (value) => (typeof value === 'number' ? Math.floor(value) : value),
        z.number().int().positive()
    ),
});
export type ScorchedEarthArgs = z.infer<typeof ARGS_SCHEMA>;

export interface ScorchedEarthResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    destNation: Nation | null;
}

const ACTION_NAME = '초토화';
const PRE_REQ_TURN = 2;
const POST_REQ_TURN = 24;

const requireNoDiplomacyLimit = (): Constraint => ({
    name: 'requireNoDiplomacyLimit',
    requires: (ctx) => (ctx.nationId !== undefined ? [{ kind: 'nation', id: ctx.nationId }] : []),
    test: (ctx: ConstraintContext, view: StateView) => {
        const nationId = ctx.nationId;
        if (nationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const nation = view.get({ kind: 'nation', id: nationId }) as Nation | null;
        if (!nation) {
            return unknownOrDeny(ctx, [{ kind: 'nation', id: nationId }], '국가 정보가 없습니다.');
        }
        const surlimit = typeof nation.meta?.surlimit === 'number' ? Number(nation.meta.surlimit) : 0;
        if (surlimit > 0) {
            return { kind: 'deny', reason: '외교제한 턴이 남아있습니다.' };
        }
        return allow();
    },
});

const notCapitalCity = (destCityId: number): Constraint => ({
    name: 'notCapitalCity',
    requires: (ctx) => (ctx.nationId !== undefined ? [{ kind: 'nation', id: ctx.nationId }] : []),
    test: (ctx: ConstraintContext, view: StateView) => {
        const nationId = ctx.nationId;
        if (nationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const nation = view.get({ kind: 'nation', id: nationId }) as Nation | null;
        if (!nation) {
            return unknownOrDeny(ctx, [{ kind: 'nation', id: nationId }], '국가 정보가 없습니다.');
        }
        if (nation.capitalCityId === destCityId) {
            return { kind: 'deny', reason: '수도입니다.' };
        }
        return allow();
    },
});

const calcReturnAmount = (destCity: City): number => {
    let amount = destCity.population / 5;
    const resourcePairs: Array<[number, number]> = [
        [destCity.agriculture, destCity.agricultureMax],
        [destCity.commerce, destCity.commerceMax],
        [destCity.security, destCity.securityMax],
    ];
    for (const [current, max] of resourcePairs) {
        if (max <= 0) {
            continue;
        }
        amount *= (current - max * 0.5) / max + 0.8;
    }
    return Math.max(0, Math.floor(amount));
};

const calcReducedValue = (current: number, max: number, ratio: number): number => {
    if (max <= 0) {
        return Math.max(0, Math.floor(current * ratio));
    }
    return Math.max(Math.floor(max * 0.1), Math.floor(current * ratio));
};

// 초토화 실행을 위한 정의/제약을 구성한다.
export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, ScorchedEarthArgs, ScorchedEarthResolveContext<TriggerState>> {
    public readonly key = 'che_초토화';
    public readonly name = ACTION_NAME;

    parseArgs(raw: unknown): ScorchedEarthArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: ScorchedEarthArgs): Constraint[] {
        return [occupiedCity(), beChief(), suppliedCity(), requireNoDiplomacyLimit()];
    }

    buildConstraints(_ctx: ConstraintContext, args: ScorchedEarthArgs): Constraint[] {
        void _ctx;
        return [
            occupiedCity(),
            occupiedDestCity(),
            beChief(),
            suppliedCity(),
            suppliedDestCity(),
            notCapitalCity(args.destCityId),
            requireNoDiplomacyLimit(),
            disallowDiplomacyBetweenStatus({
                0: '평시에만 가능합니다.',
            }),
        ];
    }

    resolve(
        context: ScorchedEarthResolveContext<TriggerState>,
        _args: ScorchedEarthArgs
    ): GeneralActionOutcome<TriggerState> {
        void _args;
        const { general, nation, destCity } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const generalName = general.name;
        const nationName = nation.name;
        const destCityName = destCity.name;
        const josaUl = JosaUtil.pick(destCityName, '을');
        const josaYi = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(nationName, '이');

        const rewardAmount = calcReturnAmount(destCity);
        const nextSurlimit = Number(nation.meta.surlimit ?? 0) + POST_REQ_TURN;
        const nextAux: Record<string, TriggerValue> = {
            ...nation.meta,
            surlimit: nextSurlimit,
        };

        if (destCity.level >= 8) {
            const current = typeof nation.meta.did_특성초토화 === 'number' ? Number(nation.meta.did_특성초토화) : 0;
            nextAux.did_특성초토화 = current + 1;
        }

        const reducedPopulation = calcReducedValue(destCity.population, destCity.populationMax, 0.2);
        const reducedAgri = calcReducedValue(destCity.agriculture, destCity.agricultureMax, 0.2);
        const reducedComm = calcReducedValue(destCity.commerce, destCity.commerceMax, 0.2);
        const reducedSecu = calcReducedValue(destCity.security, destCity.securityMax, 0.2);
        const reducedDef = calcReducedValue(destCity.defence, destCity.defenceMax, 0.2);
        const reducedWall = Math.max(Math.floor(destCity.wallMax * 0.1), Math.floor(destCity.wall * 0.5));
        const trust = typeof destCity.meta?.trust === 'number' ? Number(destCity.meta.trust) : 0;

        const expGain = 5 * (PRE_REQ_TURN + 1);
        general.experience = Math.max(0, Math.floor(general.experience * 0.9)) + expGain;
        general.dedication += expGain;

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createCityPatchEffect(
                {
                    nationId: 0,
                    frontState: 0,
                    population: reducedPopulation,
                    agriculture: reducedAgri,
                    commerce: reducedComm,
                    security: reducedSecu,
                    defence: reducedDef,
                    wall: reducedWall,
                    meta: {
                        ...destCity.meta,
                        trust: Math.max(50, trust),
                    },
                },
                destCity.id
            ),
            createNationPatchEffect(
                {
                    gold: nation.gold + rewardAmount,
                    rice: nation.rice + rewardAmount,
                    meta: nextAux,
                },
                nation.id
            ),
            createLogEffect(`<G><b>${destCityName}</b></>${josaUl} ${ACTION_NAME}했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
            createLogEffect(`<G><b>${destCityName}</b></>${josaUl} <M>${ACTION_NAME}</> 명령`, {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <G><b>${destCityName}</b></>${josaUl} <M>${ACTION_NAME}</> 명령`,
                {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <G><b>${destCityName}</b></>${josaUl} <M>${ACTION_NAME}</>하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                }
            ),
            createLogEffect(
                `<S><b>【${ACTION_NAME}】</b></><D><b>${nationName}</b></>${josaYiNation} <G><b>${destCityName}</b></>${josaUl} <M>${ACTION_NAME}</>하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
        ];

        return { effects };
    }
}

// 예약 턴 실행에 필요한 대상 도시 정보를 구성한다.
export const actionContextBuilder: ActionContextBuilder<ScorchedEarthArgs> = (base, options) => {
    const destCityId = options.actionArgs.destCityId;
    if (typeof destCityId !== 'number') {
        return null;
    }
    const worldRef = options.worldRef;
    if (!worldRef) {
        return null;
    }
    const destCity = worldRef.getCityById(destCityId);
    if (!destCity) {
        return null;
    }
    const destNation = worldRef.getNationById(destCity.nationId);
    return {
        ...base,
        destCity,
        destNation: destNation ?? null,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_초토화',
    category: '특수',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
