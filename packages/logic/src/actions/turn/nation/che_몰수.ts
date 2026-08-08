import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    existsDestGeneral,
    friendlyDestGeneral,
    notBeNeutral,
    notOpeningPart,
    occupiedCity,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import {
    createGeneralPatchEffect,
    createLogEffect,
    createMessageEffect,
    createNationPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { NationTurnCommandSpec } from './index.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { clamp } from 'es-toolkit';
import { z } from 'zod';
import { parseArgsWithSchema } from '../parseArgs.js';
import { normalizeResourceActionAmount } from '../resourceAmount.js';

const ARGS_SCHEMA = z.object({
    isGold: z.boolean(),
    amount: z.number(),
    destGeneralID: z.number(),
});
export type SeizureArgs = z.infer<typeof ARGS_SCHEMA>;

export interface SeizureResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destGeneral: General<TriggerState>;
    messageTime: Date;
}

const ACTION_NAME = '몰수';
const NPC_SEIZURE_MESSAGE_PROB = 0.01;
const NPC_SEIZURE_MESSAGES = [
    '몰수를 하다니... 이것이 윗사람이 할 짓이란 말입니까...',
    '사유재산까지 몰수해가면서 이 나라가 잘 될거라 믿습니까? 정말 이해할 수가 없군요...',
    '내 돈 내놔라! 내 돈! 몰수가 웬 말이냐!',
    '몰수해간 내 자금... 언젠가 몰래 다시 빼내올 것이다...',
    '몰수로 인한 사기 저하는 몰수로 얻은 물자보다 더 손해란걸 모른단 말인가!',
] as const;

type InclusiveRandomGenerator = GeneralActionResolveContext['rng'] & {
    nextIntInclusive?: (maxInclusive: number) => number;
};

const pickLegacyNpcMessage = (rng: GeneralActionResolveContext['rng']): string => {
    const inclusive = rng as InclusiveRandomGenerator;
    const index = inclusive.nextIntInclusive
        ? inclusive.nextIntInclusive(NPC_SEIZURE_MESSAGES.length - 1)
        : rng.nextInt(0, NPC_SEIZURE_MESSAGES.length);
    return NPC_SEIZURE_MESSAGES[index]!;
};

const resolveGeneralIcon = (general: General): string => {
    const runtimePicture = (general as General & { picture?: unknown }).picture;
    const rawPicture = runtimePicture ?? general.meta.picture;
    const picture =
        (typeof rawPicture === 'string' && rawPicture !== '') || typeof rawPicture === 'number'
            ? String(rawPicture)
            : 'default.jpg';
    return `https://sam-image.hided.net/icons/${picture}`;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SeizureArgs, SeizureResolveContext<TriggerState>> {
    public readonly key = 'che_몰수';
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

    parseArgs(raw: unknown): SeizureArgs | null {
        const data = parseArgsWithSchema(ARGS_SCHEMA, raw);
        if (!data) {
            return null;
        }
        const amount = normalizeResourceActionAmount(data.amount, this.env.maxResourceActionAmount);
        if (amount === null) {
            return null;
        }
        return {
            ...data,
            amount,
        };
    }

    buildMinConstraints(ctx: ConstraintContext, _args: SeizureArgs): Constraint[] {
        const relYear = typeof ctx.env.relYear === 'number' ? ctx.env.relYear : 0;
        const openingPartYear = typeof ctx.env.openingPartYear === 'number' ? ctx.env.openingPartYear : 0;
        return [notBeNeutral(), occupiedCity(), beChief(), notOpeningPart(relYear, openingPartYear), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, args: SeizureArgs): Constraint[] {
        const relYear = typeof _ctx.env.relYear === 'number' ? _ctx.env.relYear : 0;
        const openingPartYear = typeof _ctx.env.openingPartYear === 'number' ? _ctx.env.openingPartYear : 0;
        return [
            notBeNeutral(),
            occupiedCity(),
            beChief(),
            notOpeningPart(relYear, openingPartYear),
            suppliedCity(),
            existsDestGeneral(),
            friendlyDestGeneral(),
            {
                name: 'notSelfDestGeneral',
                requires: () => [],
                test: (ctx: ConstraintContext) => {
                    if (ctx.actorId === args.destGeneralID) {
                        return { kind: 'deny', reason: '본인입니다' };
                    }
                    return { kind: 'allow' };
                },
            },
        ];
    }

    resolve(context: SeizureResolveContext<TriggerState>, args: SeizureArgs): GeneralActionOutcome<TriggerState> {
        const { nation, destGeneral } = context;
        if (!nation) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const resKey = args.isGold ? 'gold' : 'rice';
        const resName = args.isGold ? '금' : '쌀';

        const actualAmount = clamp(args.amount, 0, destGeneral[resKey] ?? 0);

        const amountText = actualAmount.toLocaleString();
        const josaUl = actualAmount === 0 ? '를' : JosaUtil.pick(amountText, '을');
        const destGeneralName = destGeneral.name;

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createGeneralPatchEffect(
                {
                    [resKey]: destGeneral[resKey] - actualAmount,
                },
                destGeneral.id
            ),
            createNationPatchEffect(
                {
                    [resKey]: nation[resKey] + actualAmount,
                },
                nation.id
            ),
            // Actor General Action Log
            createLogEffect(`<Y>${destGeneralName}</>에게서 ${resName} <C>${amountText}</>${josaUl} 몰수했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
            // Target General Action Log
            createLogEffect(`${resName} ${amountText}${josaUl} 몰수 당했습니다.`, {
                scope: LogScope.GENERAL,
                generalId: destGeneral.id,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
            }),
        ];

        if (
            destGeneral.npcState >= 2 &&
            context.rng.nextBool(this.env.npcSeizureMessageProb ?? NPC_SEIZURE_MESSAGE_PROB)
        ) {
            const target = {
                generalId: destGeneral.id,
                generalName: destGeneral.name,
                nationId: nation.id,
                nationName: nation.name,
                color: nation.color,
                icon: resolveGeneralIcon(destGeneral),
            };
            effects.push(
                createMessageEffect({
                    msgType: 'public',
                    src: target,
                    dest: target,
                    text: pickLegacyNpcMessage(context.rng),
                    time: context.messageTime,
                    validUntil: new Date('9999-12-31T00:00:00.000Z'),
                })
            );
        }

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder<SeizureArgs> = (base, options) => {
    const destGeneralId = options.actionArgs.destGeneralID;
    if (typeof destGeneralId !== 'number') return null;

    const worldRef = options.worldRef;
    if (!worldRef) return null;

    const destGeneral = worldRef.getGeneralById(destGeneralId);
    if (!destGeneral) return null;

    return {
        ...base,
        destGeneral,
        messageTime: base.general.turnTime,
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_몰수',
    category: '인사',
    reqArg: true,
    availabilityArgs: { isGold: false, amount: 0, destGeneralID: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
