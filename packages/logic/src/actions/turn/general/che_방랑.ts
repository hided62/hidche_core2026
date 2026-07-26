import type { City, General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { JosaUtil } from '@sammo-ts/common';
import type { Constraint, ConstraintContext, RequirementKey } from '@sammo-ts/logic/constraints/types.js';
import {
    allow,
    notWanderingNation,
    unknownOrDeny,
    notOpeningPart,
    allowDiplomacyStatus,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import {
    createGeneralPatchEffect,
    createNationPatchEffect,
    createCityPatchEffect,
    createDiplomacyPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface WanderArgs {}

const ACTION_NAME = '방랑';
const ACTION_KEY = 'che_방랑';

export interface WanderResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    nationCities?: City[];
    nationGenerals?: General<TriggerState>[];
    diplomacyList?: Array<{ fromNationId: number; toNationId: number; state: number }>;
}

const beLord = (): Constraint => ({
    name: 'BeLord',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const generalKey: RequirementKey = { kind: 'general', id: ctx.actorId };
        const general = view.get(generalKey) as General | null;
        if (!general) return unknownOrDeny(ctx, [generalKey], '장수 정보가 없습니다.');
        if (general.officerLevel === 12) return allow();
        return { kind: 'deny', reason: '군주가 아닙니다.' };
    },
});

// Helper: DeleteConflict (Stub logic by clearing conflict meta/state on cities)
// Legacy `DeleteConflict` logic: update city set conflict='{}' where nation=...
// Also removes war records?
// We will simply clear 'conflict' on owned cities.

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, WanderArgs> {
    readonly key = ACTION_KEY;

    resolve(context: WanderResolveContext<TriggerState>, _args: WanderArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const effects: GeneralActionEffect<TriggerState>[] = [];

        if (!nation) {
            throw new Error('Wander requires a nation context.');
        }
        // 1. Logs

        context.addLog(`영토를 버리고 방랑의 길을 떠납니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        const josaYi = JosaUtil.pick(general.name, '이');
        const josaUn = JosaUtil.pick(general.name, '은');
        const josaUl = JosaUtil.pick(nation.name, '을');
        context.addLog(`<Y>${general.name}</>${josaYi} 방랑의 길을 떠납니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.ACTION,
            format: LogFormat.RAWTEXT,
        });
        context.addLog(`<R><b>【방랑】</b></><D><b>${general.name}</b></>${josaUn} <R>방랑</>의 길을 떠납니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            format: LogFormat.RAWTEXT,
        });
        context.addLog(`<D><b>${nation.name}</b></>${josaUl} 버리고 방랑`, {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        // 2. Nation Update
        effects.push(
            createNationPatchEffect(
                {
                    ...nation,
                    name: general.name,
                    color: '#330000', // Default dark red for wanderer
                    level: 0,
                    typeCode: 'None',
                    meta: { ...nation.meta, tech: 0 },
                    capitalCityId: 0,
                },
                nation.id
            )
        );

        // 3. General Update (Leader)
        // makelimit=12, officer_city=0
        // Update self
        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    meta: {
                        ...general.meta,
                        makelimit: 12,
                        officer_city: 0,
                    },
                },
                general.id
            )
        );

        // 4. Update Other Generals
        if (context.nationGenerals) {
            for (const other of context.nationGenerals) {
                if (other.nationId !== nation.id) continue;
                if (other.id === general.id) continue;

                // legacy: officer_level=1 (if < 12), officer_city=0
                // leader is handled above (level 12)

                if (other.officerLevel < 12) {
                    effects.push(
                        createGeneralPatchEffect(
                            {
                                ...other,
                                officerLevel: 1,
                                meta: {
                                    ...other.meta,
                                    makelimit: 12,
                                    officer_city: 0,
                                },
                            },
                            other.id
                        )
                    );
                }
            }
        }

        // 5. Update Cities
        if (context.nationCities) {
            for (const city of context.nationCities) {
                if (city.nationId !== nation.id) continue;

                effects.push(
                    createCityPatchEffect(
                        {
                            ...city,
                            nationId: 0,
                            frontState: 0,
                            conflict: {},
                        },
                        city.id
                    )
                );
            }
        }

        // 6. Diplomacy (Reset treaties)
        if (context.diplomacyList) {
            for (const rel of context.diplomacyList) {
                if (rel.fromNationId === nation.id || rel.toNationId === nation.id) {
                    // State 2 (Neutral?) Legacy: 'state'=>2, 'term'=>0.
                    effects.push(
                        createDiplomacyPatchEffect(
                            rel.fromNationId,
                            rel.toNationId,
                            { state: 2, term: 0 } // Assuming patch accepts full object or fields
                            // Actually `createDiplomacyPatchEffect` 3rd arg is partial.
                            // But we need to verify `DiplomacyState` enum.
                        )
                    );
                }
            }
        }

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, WanderArgs, WanderResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    getInheritanceActiveActionAmount(): number {
        return 1;
    }
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(_raw: unknown): WanderArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: WanderArgs): Constraint[] {
        const relYear = typeof _ctx.env.relYear === 'number' ? _ctx.env.relYear : 0;
        const openingPartYear = typeof _ctx.env.openingPartYear === 'number' ? _ctx.env.openingPartYear : 0;
        return [
            beLord(),
            notWanderingNation(),
            notOpeningPart(relYear, openingPartYear),
            allowDiplomacyStatus([2, 7], '방랑할 수 없는 외교상태입니다.'),
        ];
    }

    resolve(context: WanderResolveContext<TriggerState>, args: WanderArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    return {
        ...base,
        nationCities: options.worldRef?.listCities() ?? [], // Filter in resolver or use optimized getter
        nationGenerals: options.worldRef?.listGenerals() ?? [],
        diplomacyList: options.worldRef?.listDiplomacy() ?? [],
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_방랑',
    category: '군사',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
