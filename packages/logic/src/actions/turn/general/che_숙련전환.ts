import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral, occupiedCity, reqGeneralGold, reqGeneralRice } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { getMetaNumber, setMetaNumber, increaseMetaNumber } from '@sammo-ts/logic/war/utils.js';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface DexTransferContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    unitSet?: UnitSetDefinition | null;
}

export interface DexTransferEnvironment {
    develCost?: number;
}

const ACTION_NAME = '숙련전환';
const DECREASE_COEFF = 0.4;
const CONVERT_COEFF = 0.9;
const ARGS_SCHEMA = z
    .object({
        srcArmType: z.number().int().positive(),
        destArmType: z.number().int().positive(),
    })
    .refine((data) => data.srcArmType !== data.destArmType);
export type DexTransferArgs = z.infer<typeof ARGS_SCHEMA>;

const resolveArmTypeName = (unitSet: UnitSetDefinition | null | undefined, armType: number): string =>
    unitSet?.armTypes?.[String(armType)] ?? `병종${armType}`;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DexTransferArgs, DexTransferContext<TriggerState>> {
    public readonly key = 'che_숙련전환';
    public readonly name = ACTION_NAME;
    private readonly env: DexTransferEnvironment;

    constructor(env: DexTransferEnvironment = {}) {
        this.env = env;
    }

    parseArgs(raw: unknown): DexTransferArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildConstraints(_ctx: ConstraintContext, _args: DexTransferArgs): Constraint[] {
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number => this.env.develCost ?? 0;
        const getRequiredRice = (_context: ConstraintContext, _view: StateView): number => this.env.develCost ?? 0;
        return [notBeNeutral(), occupiedCity(), reqGeneralGold(getRequiredGold), reqGeneralRice(getRequiredRice)];
    }

    resolve(context: DexTransferContext<TriggerState>, args: DexTransferArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const srcKey = `dex${args.srcArmType}`;
        const destKey = `dex${args.destArmType}`;
        const srcDex = getMetaNumber(general.meta, srcKey, 0);
        const cutDex = Math.trunc(srcDex * DECREASE_COEFF);
        const addDex = Math.trunc(cutDex * CONVERT_COEFF);

        setMetaNumber(general.meta, srcKey, srcDex - cutDex);
        setMetaNumber(general.meta, destKey, getMetaNumber(general.meta, destKey, 0) + addDex);

        const srcName = resolveArmTypeName(context.unitSet, args.srcArmType);
        const destName = resolveArmTypeName(context.unitSet, args.destArmType);
        const cutJosa = JosaUtil.pick(String(cutDex), '을');
        const addJosa = JosaUtil.pick(String(addDex), '으로');

        const cost = this.env.develCost ?? 0;
        general.gold = Math.max(0, general.gold - cost);
        general.rice = Math.max(0, general.rice - cost);
        general.experience += 10;
        increaseMetaNumber(general.meta, 'leadership_exp', 2);

        context.addLog(`${srcName} 숙련 ${cutDex}${cutJosa} ${destName} 숙련 ${addDex}${addJosa} 전환했습니다.`);

        return { effects: [] };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => ({
    ...base,
    unitSet: options.unitSet ?? null,
});

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_숙련전환',
    category: '군사',
    reqArg: true,
    availabilityArgs: { srcArmType: 0, destArmType: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition({ develCost: env.develCost }),
};
