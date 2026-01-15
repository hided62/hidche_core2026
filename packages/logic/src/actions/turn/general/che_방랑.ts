import type { City, General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey } from '@sammo-ts/logic/constraints/types.js';
import { allow, notWanderingNation, unknownOrDeny } from '@sammo-ts/logic/constraints/presets.js';
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
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
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
        // TODO: Global logs

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
                    capitalCityId: null,
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
                    // meta: { ...general.meta, makelimit: 12 }, // If used. Legacy uses makelimit column. New entity might not have it.
                    // If `makelimit` is not in entity, ignore for now or check meta.
                    // officerLevel is already 12.
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
                                // officer_city? logic probably means unassigned.
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
                            // conflict: {} // Legacy clears conflict.
                            // Assuming conflict is stored in meta or handled separately.
                            // If conflict is part of state, reset it.
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
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(_raw: unknown): WanderArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: WanderArgs): Constraint[] {
        return [beLord(), notWanderingNation()];
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
