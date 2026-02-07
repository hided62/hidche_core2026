import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    alwaysFail,
    reqCityCapacity,
    reqCityTrader,
    reqGeneralGold,
    reqGeneralRice,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type {
    TurnCommandEnv,
    TurnCommandItemCatalogEntry,
} from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';

const ACTION_NAME = '장비매매';
const ACTION_KEY = 'che_장비매매';
const ITEM_TYPES = ['horse', 'weapon', 'book', 'item'] as const;

type ItemType = (typeof ITEM_TYPES)[number];

const ARGS_SCHEMA = z.object({
    itemType: z.enum(ITEM_TYPES),
    itemCode: z.string().min(1),
});
export type TradeItemArgs = z.infer<typeof ARGS_SCHEMA>;

const ITEM_TYPE_NAME: Record<ItemType, string> = {
    horse: '명마',
    weapon: '무기',
    book: '서적',
    item: '도구',
};

const readItem = (
    catalog: Record<string, TurnCommandItemCatalogEntry> | undefined,
    itemCode: string
): TurnCommandItemCatalogEntry | null => {
    if (!catalog || itemCode === 'None') {
        return null;
    }
    return catalog[itemCode] ?? null;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, TradeItemArgs> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(raw: unknown): TradeItemArgs | null {
        const args = parseArgsWithSchema(ARGS_SCHEMA, raw);
        if (!args) {
            return null;
        }
        const { itemType, itemCode } = args;
        if (itemCode === 'None') {
            return args;
        }
        const item = readItem(this.env.itemCatalog, itemCode);
        if (!item) {
            return null;
        }
        if (item.slot !== itemType || !item.buyable) {
            return null;
        }
        return args;
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: TradeItemArgs): Constraint[] {
        return [reqCityTrader()];
    }

    buildConstraints(_ctx: ConstraintContext, args: TradeItemArgs): Constraint[] {
        const selectedItem = readItem(this.env.itemCatalog, args.itemCode);
        const reqSecu = selectedItem?.reqSecu ?? 0;
        const reqGold = selectedItem?.cost ?? 0;

        const constraints: Constraint[] = [
            reqCityTrader(),
            reqCityCapacity('security', '치안 수치', reqSecu),
            reqGeneralGold(() => reqGold),
            reqGeneralRice(() => 0),
        ];

        if (args.itemCode === 'None') {
            constraints.push({
                name: 'reqGeneralValue',
                requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
                test: (ctx, view) => {
                    const req = { kind: 'general', id: ctx.actorId } as const;
                    const general = view.get(req) as GeneralActionResolveContext<TriggerState>['general'] | null;
                    if (!general) {
                        return { kind: 'deny', reason: '장수 정보가 없습니다.' };
                    }
                    if (general.role.items[args.itemType] !== null) {
                        return { kind: 'allow' };
                    }
                    return { kind: 'deny', reason: `${ITEM_TYPE_NAME[args.itemType]}이 없습니다.` };
                },
            });
            return constraints;
        }

        constraints.push({
            name: 'AlwaysFail',
            requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
            test: (ctx, view) => {
                const req = { kind: 'general', id: ctx.actorId } as const;
                const general = view.get(req) as GeneralActionResolveContext<TriggerState>['general'] | null;
                if (!general) {
                    return { kind: 'deny', reason: '장수 정보가 없습니다.' };
                }
                const currentItemCode = general.role.items[args.itemType];
                if (currentItemCode === args.itemCode) {
                    return alwaysFail('이미 가지고 있습니다.').test(ctx, view);
                }

                if (currentItemCode) {
                    const currentItem = readItem(this.env.itemCatalog, currentItemCode);
                    if (currentItem && !currentItem.buyable) {
                        return alwaysFail('이미 진귀한 것을 가지고 있습니다.').test(ctx, view);
                    }
                }
                return { kind: 'allow' };
            },
        });

        return constraints;
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: TradeItemArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;

        const itemType = args.itemType;
        const requestedItemCode = args.itemCode;
        const currentItemCode = general.role.items[itemType];

        const buying = requestedItemCode !== 'None';
        const finalItemCode = buying ? requestedItemCode : currentItemCode;
        if (!finalItemCode) {
            throw new Error('판매할 아이템이 없습니다.');
        }

        const item = readItem(this.env.itemCatalog, finalItemCode);
        const itemName = item?.name ?? finalItemCode;
        const itemRawName = item?.rawName ?? itemName;
        const itemCost = item?.cost ?? 0;
        const josaUl = JosaUtil.pick(itemRawName, '을');

        const nextGold = buying ? Math.max(0, general.gold - itemCost) : general.gold + Math.floor(itemCost / 2);
        const nextRole = {
            ...general.role,
            items: {
                ...general.role.items,
                [itemType]: buying ? finalItemCode : null,
            },
        };

        if (buying) {
            context.addLog(`<C>${itemName}</>${josaUl} 구입했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
        } else {
            context.addLog(`<C>${itemName}</>${josaUl} 판매했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
        }

        if (!buying && item && !item.buyable && nation) {
            const josaYi = JosaUtil.pick(general.name, '이');
            context.addLog(`<Y>${general.name}</>${josaYi} <C>${itemName}</>${josaUl} 판매했습니다!`, {
                scope: LogScope.SYSTEM,
                category: LogCategory.ACTION,
            });
            context.addLog(`<R><b>【판매】</b></><D><b>${nation.name}</b></>의 <Y>${general.name}</>${josaYi} <C>${itemName}</>${josaUl} 판매했습니다!`, {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
            });
        }

        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });

        return {
            effects: [
                createGeneralPatchEffect<TriggerState>({
                    gold: nextGold,
                    experience: general.experience + 10,
                    role: nextRole,
                }),
            ],
        };
    }
}

export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: ACTION_KEY,
    category: '개인',
    reqArg: true,
    availabilityArgs: {
        itemType: 'string',
        itemCode: 'string',
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
