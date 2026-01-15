import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import { notBeNeutral, reqGeneralCrew, reqGeneralGold, reqGeneralRice } from '@sammo-ts/logic/constraints/presets.js';
import { allow, unknownOrDeny, readGeneral } from '@sammo-ts/logic/constraints/helpers.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { getMetaNumber, setMetaNumber, increaseMetaNumber } from '@sammo-ts/logic/war/utils.js';

export interface DrillArgs {}

export interface DrillContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    unitSet?: UnitSetDefinition | null;
}

export interface DrillEnvironment {
    develCost?: number;
    defaultTrainLow?: number;
    defaultAtmosLow?: number;
}

type DrillPick = 'success' | 'normal' | 'fail';

const ACTION_NAME = '단련';

const resolveArmTypeName = (unitSet: UnitSetDefinition, armType: number): string =>
    unitSet.armTypes?.[String(armType)] ?? `병종${armType}`;

const pickByWeight = <T extends string>(rng: DrillContext['rng'], weights: Record<T, number>): T => {
    const entries = Object.entries(weights) as Array<[T, number]>;
    const first = entries[0];
    if (!first) {
        throw new Error('Empty weights');
    }
    let total = 0;
    for (const [, weight] of entries) {
        if (weight > 0) {
            total += weight;
        }
    }
    if (total <= 0) {
        return first[0];
    }
    let cursor = rng.nextFloat() * total;
    for (const [key, weight] of entries) {
        if (weight <= 0) {
            continue;
        }
        cursor -= weight;
        if (cursor <= 0) {
            return key;
        }
    }
    const last = entries[entries.length - 1];
    return last ? last[0] : first[0];
};

const reqGeneralStat = (key: 'train' | 'atmos', label: string, minValue: number): Constraint => ({
    name: `ReqGeneral${label}`,
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const general = readGeneral(ctx, view);
        if (!general) {
            const req = { kind: 'general', id: ctx.actorId } as const;
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general[key] >= minValue) {
            return allow();
        }
        const josa = JosaUtil.pick(label, '이');
        return { kind: 'deny', reason: `${label}${josa} 부족합니다.` };
    },
});

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DrillArgs, DrillContext<TriggerState>> {
    public readonly key = 'che_단련';
    public readonly name = ACTION_NAME;
    private readonly env: DrillEnvironment;

    constructor(env: DrillEnvironment = {}) {
        this.env = env;
    }

    parseArgs(_raw: unknown): DrillArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: DrillArgs): Constraint[] {
        const trainLow = this.env.defaultTrainLow ?? 40;
        const atmosLow = this.env.defaultAtmosLow ?? 40;
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number => this.env.develCost ?? 0;
        const getRequiredRice = (_context: ConstraintContext, _view: StateView): number => this.env.develCost ?? 0;
        return [
            notBeNeutral(),
            reqGeneralCrew(),
            reqGeneralStat('train', '훈련', trainLow),
            reqGeneralStat('atmos', '사기', atmosLow),
            reqGeneralGold(getRequiredGold),
            reqGeneralRice(getRequiredRice),
        ];
    }

    resolve(context: DrillContext<TriggerState>, _args: DrillArgs): GeneralActionOutcome<TriggerState> {
        if (!context.unitSet) {
            context.addLog('병종 정보를 확인할 수 없어 단련을 진행할 수 없습니다.');
            return { effects: [] };
        }

        const general = context.general;
        const crewType = context.unitSet.crewTypes?.find((entry) => entry.id === general.crewTypeId);
        if (!crewType) {
            context.addLog('병종 정보를 확인할 수 없어 단련을 진행할 수 없습니다.');
            return { effects: [] };
        }

        const pick = pickByWeight<DrillPick>(context.rng, {
            success: 0.34,
            normal: 0.33,
            fail: 0.33,
        });
        const multiplier = pick === 'success' ? 3 : pick === 'normal' ? 2 : 1;

        const baseScore = Math.round((general.crew * general.train * general.atmos) / 20 / 10000);
        const score = baseScore * multiplier;
        const armTypeName = resolveArmTypeName(context.unitSet, crewType.armType);
        const logPrefix = pick === 'success' ? '단련이 일취월장하여' : pick === 'fail' ? '단련이 지지부진하여' : '';
        const logText = logPrefix
            ? `${logPrefix} ${armTypeName} 숙련도가 ${score} 향상되었습니다.`
            : `${armTypeName} 숙련도가 ${score} 향상되었습니다.`;

        const dexKey = `dex${crewType.armType}`;
        const nextDex = getMetaNumber(general.meta, dexKey, 0) + score;
        setMetaNumber(general.meta, dexKey, nextDex);

        const expGain = general.crew / 400;
        general.experience += expGain;

        const statKey = pickByWeight(context.rng, {
            leadership_exp: general.stats.leadership,
            strength_exp: general.stats.strength,
            intel_exp: general.stats.intelligence,
        });
        increaseMetaNumber(general.meta, statKey, 1);

        const cost = this.env.develCost ?? 0;
        general.gold = Math.max(0, general.gold - cost);
        general.rice = Math.max(0, general.rice - cost);

        context.addLog(logText);

        return { effects: [] };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => ({
    ...base,
    unitSet: options.unitSet ?? null,
});

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_단련',
    category: '군사',
    reqArg: false,

    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({
            develCost: env.develCost,
        }),
};
