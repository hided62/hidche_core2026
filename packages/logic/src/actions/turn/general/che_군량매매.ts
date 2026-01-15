import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { occupiedCity, reqGeneralGold, reqGeneralRice, suppliedCity } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface TradeEnvironment {
    exchangeFee?: number;
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

    constructor(env: TradeEnvironment = {}) {
        this.env = env;
    }

    parseArgs(raw: unknown): TradeArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: TradeArgs): Constraint[] {
        return [occupiedCity(), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, args: TradeArgs): Constraint[] {
        const constraints: Constraint[] = [occupiedCity(), suppliedCity()];
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

        let buyAmount = 0;
        let sellAmount = 0;
        let tax = 0;

        if (args.buyRice) {
            const requestedSell = Math.min(args.amount * rate, general.gold);
            tax = requestedSell * fee;
            if (requestedSell + tax > general.gold) {
                sellAmount = general.gold;
                tax = sellAmount * (fee / (1 + fee));
                const actualSell = sellAmount - tax;
                buyAmount = actualSell / rate;
            } else {
                sellAmount = requestedSell + tax;
                buyAmount = args.amount;
            }
            general.gold = Math.max(0, general.gold - sellAmount);
            general.rice += buyAmount;
            context.addLog(
                `군량 ${Math.round(buyAmount).toLocaleString()}을 사서 자금 ${Math.round(
                    sellAmount
                ).toLocaleString()}을 썼습니다.`,
                { format: LogFormat.PLAIN }
            );
        } else {
            sellAmount = Math.min(args.amount, general.rice);
            const grossBuy = sellAmount * rate;
            tax = grossBuy * fee;
            buyAmount = grossBuy - tax;
            general.rice = Math.max(0, general.rice - sellAmount);
            general.gold += buyAmount;
            context.addLog(
                `군량 ${Math.round(sellAmount).toLocaleString()}을 팔아 자금 ${Math.round(
                    buyAmount
                ).toLocaleString()}을 얻었습니다.`,
                { format: LogFormat.PLAIN }
            );
        }

        // 국고 증가 (세금)
        if (context.nation) {
            const nation = context.nation;
            const currentGold = (nation.gold as number) ?? 0;
            nation.gold = currentGold + tax;
        }

        // 경험치 및 명성 증가
        general.experience += 30;
        general.dedication += 50;

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
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
