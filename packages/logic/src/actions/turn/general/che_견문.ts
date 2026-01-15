import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { defaultActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { increaseMetaNumber } from '@sammo-ts/logic/war/utils.js';

export interface SightseeingArgs {}

const ACTION_NAME = '견문';

const IncExp = 0x1;
const IncHeavyExp = 0x2;
const IncLeadership = 0x10;
const IncStrength = 0x20;
const IncIntel = 0x40;
const IncGold = 0x100;
const IncRice = 0x200;
const DecGold = 0x400;
const DecRice = 0x800;
const Wounded = 0x1000;
const HeavyWounded = 0x2000;

const SIGHTSEEING_MESSAGES: Array<{
    flags: number;
    texts: string[];
    weight: number;
}> = [
    {
        flags: IncExp,
        texts: [
            '아무일도 일어나지 않았습니다.',
            '명사와 설전을 벌였으나 망신만 당했습니다.',
            '동네 장사와 힘겨루기를 했지만 망신만 당했습니다.',
        ],
        weight: 1,
    },
    {
        flags: IncHeavyExp,
        texts: ['주점에서 사람들과 어울려 술을 마셨습니다.', '위기에 빠진 사람을 구해주었습니다.'],
        weight: 1,
    },
    {
        flags: IncHeavyExp | IncLeadership,
        texts: ['백성들에게 현인의 가르침을 설파했습니다.', '어느 집의 도망친 가축을 되찾아 주었습니다.'],
        weight: 2,
    },
    {
        flags: IncHeavyExp | IncStrength,
        texts: ['동네 장사와 힘겨루기를 하여 멋지게 이겼습니다.', '어느 집의 무너진 울타리를 고쳐주었습니다.'],
        weight: 2,
    },
    {
        flags: IncHeavyExp | IncIntel,
        texts: ['어느 명사와 설전을 벌여 멋지게 이겼습니다.', '거리에서 글 모르는 아이들을 모아 글을 가르쳤습니다.'],
        weight: 2,
    },
    {
        flags: IncExp | IncGold,
        texts: ['지나가는 행인에게서 금을 :goldAmount: 받았습니다.'],
        weight: 1,
    },
    {
        flags: IncExp | IncRice,
        texts: ['지나가는 행인에게서 쌀을 :riceAmount: 받았습니다.'],
        weight: 1,
    },
    {
        flags: IncExp | DecGold,
        texts: ['산적을 만나 금 :goldAmount:을 빼앗겼습니다.', '돈을 :goldAmount: 빌려주었다가 떼어먹혔습니다.'],
        weight: 1,
    },
    {
        flags: IncExp | DecRice,
        texts: ['쌀을 :riceAmount: 빌려주었다가 떼어먹혔습니다.'],
        weight: 1,
    },
    {
        flags: IncExp | Wounded,
        texts: ['호랑이에게 물려 다쳤습니다.', '곰에게 할퀴어 다쳤습니다.'],
        weight: 1,
    },
    {
        flags: IncHeavyExp | Wounded,
        texts: ['위기에 빠진 사람을 구해주다가 다쳤습니다.'],
        weight: 1,
    },
    {
        flags: IncExp | HeavyWounded,
        texts: ['호랑이에게 물려 크게 다쳤습니다.', '곰에게 할퀴어 크게 다쳤습니다.'],
        weight: 1,
    },
    {
        flags: IncHeavyExp | Wounded | HeavyWounded,
        texts: ['위기에 빠진 사람을 구하다가 죽을뻔 했습니다.'],
        weight: 1,
    },
    {
        flags: IncHeavyExp | IncStrength | IncGold,
        texts: ['산적과 싸워 금 :goldAmount:을 빼앗았습니다.'],
        weight: 1,
    },
    {
        flags: IncHeavyExp | IncStrength | IncRice,
        texts: ['호랑이를 잡아 고기 :riceAmount:을 얻었습니다.', '곰을 잡아 고기 :riceAmount:을 얻었습니다.'],
        weight: 1,
    },
    {
        flags: IncHeavyExp | IncIntel | IncGold,
        texts: ['돈을 빌려주었다가 이자 :goldAmount:을 받았습니다.'],
        weight: 1,
    },
    {
        flags: IncHeavyExp | IncIntel | IncRice,
        texts: ['쌀을 빌려주었다가 이자 :riceAmount:을 받았습니다.'],
        weight: 1,
    },
];

const pickByWeight = (rng: GeneralActionResolveContext['rng']): { flags: number; text: string } => {
    if (SIGHTSEEING_MESSAGES.length === 0) {
        return { flags: 0, text: '' };
    }
    const total = SIGHTSEEING_MESSAGES.reduce((sum, entry) => sum + Math.max(entry.weight, 0), 0);
    const base = SIGHTSEEING_MESSAGES[0];
    if (!base) {
        return { flags: 0, text: '' };
    }
    if (total <= 0) {
        const text = base.texts[0] ?? '';
        return { flags: base.flags, text };
    }
    let cursor = rng.nextFloat() * total;
    for (const entry of SIGHTSEEING_MESSAGES) {
        const weight = Math.max(entry.weight, 0);
        cursor -= weight;
        if (cursor <= 0) {
            const index = rng.nextInt(0, entry.texts.length);
            const text = entry.texts[index] ?? entry.texts[0] ?? '';
            return { flags: entry.flags, text };
        }
    }
    const fallback = SIGHTSEEING_MESSAGES[SIGHTSEEING_MESSAGES.length - 1];
    if (!fallback) {
        return { flags: 0, text: '' };
    }
    const index = rng.nextInt(0, fallback.texts.length);
    const text = fallback.texts[index] ?? fallback.texts[0] ?? '';
    return { flags: fallback.flags, text };
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SightseeingArgs> {
    public readonly key = 'che_견문';
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): SightseeingArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: SightseeingArgs): Constraint[] {
        return [];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: SightseeingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const picked = pickByWeight(context.rng);
        let message = picked.text;
        let exp = 0;

        if (picked.flags & IncExp) {
            exp += 30;
        }
        if (picked.flags & IncHeavyExp) {
            exp += 60;
        }
        if (picked.flags & IncLeadership) {
            increaseMetaNumber(general.meta, 'leadership_exp', 2);
        }
        if (picked.flags & IncStrength) {
            increaseMetaNumber(general.meta, 'strength_exp', 2);
        }
        if (picked.flags & IncIntel) {
            increaseMetaNumber(general.meta, 'intel_exp', 2);
        }
        if (picked.flags & IncGold) {
            general.gold += 300;
            message = message.replace(':goldAmount:', '300');
        }
        if (picked.flags & IncRice) {
            general.rice += 300;
            message = message.replace(':riceAmount:', '300');
        }
        if (picked.flags & DecGold) {
            general.gold = Math.max(0, general.gold - 200);
            message = message.replace(':goldAmount:', '200');
        }
        if (picked.flags & DecRice) {
            general.rice = Math.max(0, general.rice - 200);
            message = message.replace(':riceAmount:', '200');
        }
        if (picked.flags & Wounded) {
            const delta = context.rng.nextInt(10, 21);
            general.injury = Math.min(80, general.injury + delta);
        }
        if (picked.flags & HeavyWounded) {
            const delta = context.rng.nextInt(20, 51);
            general.injury = Math.min(80, general.injury + delta);
        }

        general.experience += exp;

        context.addLog(message);

        return { effects: [] };
    }
}

// 예약 턴 실행은 기본 컨텍스트만 사용한다.
export const actionContextBuilder = defaultActionContextBuilder;

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_견문',
    category: '개인',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
