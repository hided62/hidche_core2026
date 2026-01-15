import type { General, GeneralTriggerState, Troop } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    mustBeTroopLeader,
    notBeNeutral,
    occupiedCity,
    reqTroopMembers,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { increaseMetaNumber } from '@sammo-ts/logic/war/utils.js';

export interface AssemblyArgs {}

export interface AssemblyResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    troop: Troop | null;
    troopMembers: Array<General<TriggerState>>;
}

const ACTION_NAME = '집합';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, AssemblyArgs, AssemblyResolveContext<TriggerState>> {
    public readonly key = 'che_집합';
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): AssemblyArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: AssemblyArgs): Constraint[] {
        return [notBeNeutral(), occupiedCity(), suppliedCity(), mustBeTroopLeader(), reqTroopMembers()];
    }

    resolve(context: AssemblyResolveContext<TriggerState>, _args: AssemblyArgs): GeneralActionOutcome<TriggerState> {
        const city = context.city;
        if (!city) {
            context.addLog('도시 정보가 없어 집합을 진행할 수 없습니다.');
            return { effects: [] };
        }

        const general = context.general;
        const troopName = context.troop?.name ?? '부대';
        const cityName = city.name;
        const josaRo = JosaUtil.pick(cityName, '로');

        context.addLog(`<G><b>${cityName}</b></>에서 집합을 실시했습니다.`);

        const effects: Array<GeneralActionEffect<TriggerState>> = [];
        const targets = context.troopMembers.filter((member) => member.cityId !== city.id);
        for (const member of targets) {
            effects.push(createGeneralPatchEffect({ cityId: city.id } as Partial<General<TriggerState>>, member.id));
            effects.push(
                createLogEffect(`${troopName} 부대원들은 <G><b>${cityName}</b></>${josaRo} 집합되었습니다.`, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                    generalId: member.id,
                })
            );
        }

        general.experience += 70;
        general.dedication += 100;
        increaseMetaNumber(general.meta, 'leadership_exp', 1);

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const troopId = base.general.troopId;
    const troop = options.worldRef?.getTroopById(troopId) ?? null;
    const troopMembers =
        options.worldRef
            ?.listGenerals()
            .filter((member) => member.troopId === troopId && member.id !== base.general.id) ?? [];
    return {
        ...base,
        troop,
        troopMembers,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_집합',
    category: '군사',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
