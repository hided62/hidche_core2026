import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    occupiedCity,
    reqCityTrader,
    reqGeneralGold,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';
import { normalizeResourceActionAmount } from '../resourceAmount.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';

export interface TradeEnvironment {
    exchangeFee?: number;
    maxResourceActionAmount?: number;
    generalActionModules?: TurnCommandEnv['generalActionModules'];
}

const ACTION_NAME = '군량매매';
const DEFAULT_EXCHANGE_FEE = 0.01;
const ARGS_SCHEMA = z.object({
    buyRice: z.boolean(),
    amount: z.number(),
});
export type TradeArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, TradeArgs> {
    public readonly key = 'che_군량매매';
    public readonly name = ACTION_NAME;
    private readonly env: TradeEnvironment;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(env: TradeEnvironment = {}) {
        this.env = env;
        this.pipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
    }

    parseArgs(raw: unknown): TradeArgs | null {
        const parsed = parseArgsWithSchema(ARGS_SCHEMA, raw);
        if (!parsed || !Number.isFinite(parsed.amount)) {
            return null;
        }
        const amount = normalizeResourceActionAmount(parsed.amount, this.env.maxResourceActionAmount ?? 10_000);
        if (amount === null) {
            return null;
        }
        return { buyRice: parsed.buyRice, amount };
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: TradeArgs): Constraint[] {
        return [reqCityTrader(), occupiedCity({ allowNeutral: true }), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, args: TradeArgs): Constraint[] {
        const constraints: Constraint[] = [reqCityTrader(), occupiedCity({ allowNeutral: true }), suppliedCity()];
        if (args.buyRice) {
            constraints.push(reqGeneralGold(() => 1));
        } else {
            constraints.push(reqGeneralRice(() => 1));
        }
        return constraints;
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: TradeArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const city = context.city;
        if (!city) {
            context.addLog('도시 정보가 없습니다.');
            return { effects: [] };
        }
        const tradeRate = (city.meta.trade as number | undefined) ?? 100;
        const rate = tradeRate / 100;
        const fee = this.env.exchangeFee ?? DEFAULT_EXCHANGE_FEE;

        let tax: number;

        if (args.buyRice) {
            const requestedSell = Math.min(args.amount * rate, general.gold);
            tax = requestedSell * fee;
            let sellAmount: number;
            let buyAmount: number;
            if (requestedSell + tax > general.gold) {
                sellAmount = general.gold;
                tax = sellAmount * (fee / (1 + fee));
                const actualSell = sellAmount - tax;
                buyAmount = actualSell / rate;
            } else {
                sellAmount = requestedSell + tax;
                buyAmount = args.amount;
            }
            general.gold = Math.max(0, Math.round(general.gold - sellAmount));
            general.rice = Math.round(general.rice + buyAmount);
            context.addLog(
                `군량 <C>${Math.round(buyAmount).toLocaleString()}</>을 사서 자금 <C>${Math.round(
                    sellAmount
                ).toLocaleString()}</>을 썼습니다.`,
                { format: LogFormat.PLAIN }
            );
        } else {
            const sellAmount = Math.min(args.amount, general.rice);
            const grossBuy = sellAmount * rate;
            tax = grossBuy * fee;
            const buyAmount = grossBuy - tax;
            general.rice = Math.max(0, Math.round(general.rice - sellAmount));
            general.gold = Math.round(general.gold + buyAmount);
            context.addLog(
                `군량 <C>${Math.round(sellAmount).toLocaleString()}</>을 팔아 자금 <C>${Math.round(
                    buyAmount
                ).toLocaleString()}</>을 얻었습니다.`,
                { format: LogFormat.PLAIN }
            );
        }

        // 국고 증가 (세금)
        if (context.nation) {
            const nation = context.nation;
            const currentGold = (nation.gold as number) ?? 0;
            nation.gold = currentGold + Math.trunc(tax);
        }

        // 경험치 및 명성 증가
        general.experience += this.pipeline.onCalcStat(context, 'experience', 30);
        general.dedication += this.pipeline.onCalcStat(context, 'dedication', 50);
        const weightedStats = [
            ['leadership_exp', general.stats.leadership],
            ['strength_exp', general.stats.strength],
            ['intel_exp', general.stats.intelligence],
        ] as const;
        const totalWeight = weightedStats.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
        let pick = context.rng.nextFloat1() * totalWeight;
        let statKey: (typeof weightedStats)[number][0] = weightedStats[weightedStats.length - 1]![0];
        for (const [key, weight] of weightedStats) {
            if (pick <= Math.max(0, weight)) {
                statKey = key;
                break;
            }
            pick -= Math.max(0, weight);
        }
        const statRaw = general.meta[statKey];
        const statExp = typeof statRaw === 'number' ? statRaw : 0;
        general.meta[statKey] = statExp + 1;

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        return { effects: [] };
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_군량매매',
    category: '개인',
    reqArg: true,
    availabilityArgs: {
        buyRice: 'boolean',
        amount: 'number',
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition({
            maxResourceActionAmount: env.maxResourceActionAmount,
            generalActionModules: env.generalActionModules,
        }),
};
