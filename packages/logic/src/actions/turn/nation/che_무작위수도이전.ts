import type { GeneralTriggerState, Nation, City, General } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import { beMonarch, occupiedCity, suppliedCity } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import {
    createLogEffect,
    createNationPatchEffect,
    createCityPatchEffect,
    createGeneralPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';

export interface RandomMoveCapitalArgs {}

export interface RandomMoveCapitalResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    neutralCandidateCities: City[];
    nationGenerals: General<TriggerState>[];
}

const ACTION_NAME = '무작위 수도 이전';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<
    TriggerState,
    RandomMoveCapitalArgs,
    RandomMoveCapitalResolveContext<TriggerState>
> {
    public readonly key = 'che_무작위수도이전';
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): RandomMoveCapitalArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: RandomMoveCapitalArgs): Constraint[] {
        return [
            occupiedCity(),
            beMonarch(),
            suppliedCity(),
            {
                name: 'canRandomMoveCapital',
                requires: (ctx) => [{ kind: 'nation', id: ctx.nationId! }],
                test: (ctx: ConstraintContext, view: StateView) => {
                    const nation = view.get({ kind: 'nation', id: ctx.nationId! }) as Nation | undefined;
                    const canMoveRaw = nation?.meta[`can_무작위수도이전`];
                    const canMove = (typeof canMoveRaw === 'number' ? canMoveRaw : 0) > 0;
                    if (!canMove) return { kind: 'deny', reason: '더이상 변경이 불가능합니다.' };
                    return { kind: 'allow' };
                },
            },
        ];
    }

    resolve(
        context: RandomMoveCapitalResolveContext<TriggerState>,
        _args: RandomMoveCapitalArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, neutralCandidateCities, nationGenerals, rng } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        if (neutralCandidateCities.length === 0) {
            return {
                effects: [
                    createLogEffect(`이동할 수 있는 도시가 없습니다.`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const destCity = neutralCandidateCities[rng.nextInt(0, neutralCandidateCities.length)]!;
        const oldCityId = nation.capitalCityId;
        const generalName = general.name;
        const nationName = nation.name;
        const destCityName = destCity.name;

        const josaRo = JosaUtil.pick(destCityName, '로');
        const josaYi = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(nationName, '이');

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createNationPatchEffect(
                {
                    capitalCityId: destCity.id,
                    meta: {
                        ...nation.meta,
                        can_무작위수도이전: Number(nation.meta.can_무작위수도이전 ?? 0) - 1,
                    },
                },
                nation.id
            ),
            // Set new capital
            createCityPatchEffect(
                {
                    nationId: nation.id,
                },
                destCity.id
            ),
            // Set old capital to neutral
            createCityPatchEffect(
                {
                    nationId: 0,
                    frontState: 0,
                },
                oldCityId!
            ),
            // Global Action Log
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <G><b>${destCityName}</b></>${josaRo} <M>수도 이전</}하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                }
            ),
            // Global History Log
            createLogEffect(
                `<S><b>【${ACTION_NAME}】</b></><D><b>${nationName}</b></>${josaYiNation} <G><b>${destCityName}</b></>${josaRo} <M>수도 이전</}하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // Actor Nation History Log
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <G><b>${destCityName}</b></>${josaRo} <M>${ACTION_NAME}</} `,
                {
                    scope: LogScope.NATION,
                    nationId: nation.id,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // General Action Log
            createLogEffect(`<G><b>${destCityName}</b></>${josaRo} 국가를 옮겼습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
        ];

        // Move all generals to new capital
        for (const targetGeneral of nationGenerals) {
            effects.push(
                createGeneralPatchEffect(
                    {
                        cityId: destCity.id,
                    },
                    targetGeneral.id
                )
            );

            if (targetGeneral.id !== general.id) {
                effects.push(
                    createLogEffect(`국가 수도를 <G><b>${destCityName}</b></>${josaRo} 옮겼습니다.`, {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        generalId: targetGeneral.id,
                        format: LogFormat.PLAIN,
                    })
                );
            }
        }

        general.experience += 10;
        general.dedication += 10;

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const worldRef = options.worldRef;
    if (!worldRef) return null;

    const allCities = worldRef.listCities();
    const neutralCandidateCities = allCities.filter((c) => c.nationId === 0 && c.level >= 5 && c.level <= 6);
    const nationGenerals = worldRef.listGenerals().filter((g) => g.nationId === base.general.nationId);

    return {
        ...base,
        neutralCandidateCities,
        nationGenerals,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_무작위수도이전',
    category: '국가',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
