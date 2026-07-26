import type { City, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral, notOccupiedCity, notWanderingNation } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { searchDistance } from '@sammo-ts/logic/world/distance.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import type { GeneralTurnCommandSpec } from './index.js';

const ACTION_NAME = '접경귀환';
const ACTION_KEY = 'che_접경귀환';

export interface BorderReturnArgs {}

type InclusiveRandomGenerator = GeneralActionResolveContext['rng'] & {
    nextIntInclusive?: (maxInclusive: number) => number;
};

const legacyChoiceIndex = (rng: GeneralActionResolveContext['rng'], length: number): number => {
    const inclusive = rng as InclusiveRandomGenerator;
    return inclusive.nextIntInclusive
        ? inclusive.nextIntInclusive(length - 1)
        : rng.nextInt(0, length);
};

export interface BorderReturnResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    map?: MapDefinition;
    allCities?: City[];
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, BorderReturnArgs, BorderReturnResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): BorderReturnArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: BorderReturnArgs): Constraint[] {
        return [notBeNeutral(), notWanderingNation(), notOccupiedCity()];
    }

    resolve(
        context: BorderReturnResolveContext<TriggerState>,
        _args: BorderReturnArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const map = context.map;
        const allCities = context.allCities ?? [];
        if (!nation || !map) {
            context.addLog('3칸 이내에 아국 도시가 없습니다.', {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return { effects: [] };
        }

        const distanceByCity = searchDistance(map, general.cityId, 3);
        const candidates = allCities
            .filter((city) => city.nationId === nation.id && city.supplyState === 1)
            .map((city) => ({ city, distance: distanceByCity[city.id] }))
            .filter((entry) => typeof entry.distance === 'number' && Number.isFinite(entry.distance));

        if (candidates.length === 0) {
            context.addLog('3칸 이내에 아국 도시가 없습니다.', {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return { effects: [] };
        }

        const minDistance = Math.min(...candidates.map((entry) => entry.distance as number));
        const nearestCities = candidates
            .filter((entry) => entry.distance === minDistance)
            .map((entry) => entry.city);

        if (nearestCities.length === 0) {
            context.addLog('3칸 이내에 아국 도시가 없습니다.', {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            return { effects: [] };
        }

        const targetCity = nearestCities[legacyChoiceIndex(context.rng, nearestCities.length)]!;
        const josaRo = JosaUtil.pick(targetCity.name, '로');
        context.addLog(`<G><b>${targetCity.name}</b></>${josaRo} 접경귀환했습니다.`, {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>({
                    cityId: targetCity.id,
                }),
            ],
        };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => ({
    ...base,
    map: options.map,
    allCities: options.worldRef?.listCities() ?? [],
});

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '인사',
    reqArg: false,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
