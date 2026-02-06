import type { RandomGenerator } from '@sammo-ts/common';
import { asRecord, JosaUtil } from '@sammo-ts/common';
import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { beNeutral, allowJoinAction } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { resolveStartYear } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';

export interface RandomAppointmentArgs {}

interface CandidateNation<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    nation: Nation;
    generals: General<TriggerState>[];
    generalCount: number;
    monarchCityId: number | null;
}

export interface RandomAppointmentResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    candidateNations: Array<CandidateNation<TriggerState>>;
    relYear: number;
    initialNationGenLimit: number;
}

const ACTION_NAME = '무작위 국가로 임관';

const TALK_LIST = [
    '어쩌다 보니',
    '인연이 닿아',
    '발길이 닿는 대로',
    '소문을 듣고',
    '점괘에 따라',
    '천거를 받아',
    '유명한',
    '뜻을 펼칠 곳을 찾아',
    '고향에 가까운',
    '천하의 균형을 맞추기 위해',
    '오랜 은거를 마치고',
];

const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const readMetaBool = (meta: Record<string, unknown>, key: string, fallback = false): boolean => {
    const raw = meta[key];
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (typeof raw === 'number') {
        return raw !== 0;
    }
    if (typeof raw === 'string') {
        const lowered = raw.toLowerCase();
        if (lowered === 'true' || lowered === '1') {
            return true;
        }
        if (lowered === 'false' || lowered === '0') {
            return false;
        }
    }
    return fallback;
};

const pickUsingWeightPair = <T>(rng: RandomGenerator, items: Array<[T, number]>): T | null => {
    if (items.length === 0) {
        return null;
    }
    let total = 0;
    for (const [, weight] of items) {
        if (weight > 0) {
            total += weight;
        }
    }
    if (total <= 0) {
        return items[0]?.[0] ?? null;
    }
    let cursor = rng.nextFloat1() * total;
    for (const [item, weight] of items) {
        if (weight <= 0) {
            continue;
        }
        cursor -= weight;
        if (cursor <= 0) {
            return item;
        }
    }
    return items[items.length - 1]?.[0] ?? null;
};

const calcNationPower = <TriggerState extends GeneralTriggerState>(generals: General<TriggerState>[]): number => {
    if (generals.length === 0) {
        return 0;
    }
    let warPower = 0;
    let develPower = 0;
    for (const general of generals) {
        const leadership = general.stats.leadership;
        if (leadership >= 40) {
            const coef = general.npcState < 2 ? 1.15 : 1;
            warPower += coef * leadership;
        }
        const base = Math.sqrt(general.stats.intelligence * general.stats.strength) * 2 + leadership / 2;
        develPower += base / 5;
    }
    return warPower + develPower;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, RandomAppointmentArgs, RandomAppointmentResolveContext<TriggerState>> {
    public readonly key = 'che_랜덤임관';
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): RandomAppointmentArgs | null {
        return {};
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: RandomAppointmentArgs): Constraint[] {
        return [];
    }

    buildConstraints(_ctx: ConstraintContext, _args: RandomAppointmentArgs): Constraint[] {
        return [beNeutral(), allowJoinAction()];
    }

    resolve(
        context: RandomAppointmentResolveContext<TriggerState>,
        _args: RandomAppointmentArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, rng, candidateNations } = context;
        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        if (candidateNations.length === 0) {
            effects.push(
                createLogEffect('임관 가능한 국가가 없습니다.', {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                })
            );
            return { effects, alternative: { commandKey: 'che_인재탐색', args: {} } };
        }

        const weightedCandidates = candidateNations.map((candidate) => {
            let power = calcNationPower(candidate.generals);
            if (general.npcState < 2 && candidate.nation.name.startsWith('ⓤ')) {
                power *= 100;
            }
            const normalized = power > 0 ? power : 1;
            const weight = Math.pow(1 / normalized, 3);
            return [candidate, weight] as [CandidateNation<TriggerState>, number];
        });

        const picked = pickUsingWeightPair(rng, weightedCandidates);
        if (!picked) {
            effects.push(
                createLogEffect('임관 가능한 국가가 없습니다.', {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                })
            );
            return { effects, alternative: { commandKey: 'che_인재탐색', args: {} } };
        }

        const destNation = picked.nation;
        const destNationName = destNation.name;
        const destCityId = picked.monarchCityId ?? destNation.capitalCityId ?? general.cityId;
        const generalName = general.name;
        const josaYi = JosaUtil.pick(generalName, '이');
        const talk = TALK_LIST[rng.nextInt(0, TALK_LIST.length)] ?? TALK_LIST[0]!;

        const meta = {
            ...general.meta,
            belong: 1,
            officer_city: 0,
            officerCity: 0,
        };

        const expGain =
            context.initialNationGenLimit > 0 && picked.generalCount < context.initialNationGenLimit ? 700 : 100;

        effects.push(
            createGeneralPatchEffect<TriggerState>({
                nationId: destNation.id,
                officerLevel: 1,
                cityId: destCityId,
                troopId: 0,
                experience: general.experience + expGain,
                meta,
            }),
            createLogEffect(`<D>${destNationName}</>에 랜덤 임관했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
            createLogEffect(`<D><b>${destNationName}</b></>에 랜덤 임관`, {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            createLogEffect(
                `<Y>${generalName}</>${josaYi} ${talk} <D><b>${destNationName}</b></>에 <S>임관</>했습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                }
            )
        );

        tryApplyUniqueLottery(context, { acquireType: '랜덤 임관', reason: ACTION_NAME });

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const worldRef = options.worldRef;
    const startYear = resolveStartYear(options.world, options.scenarioMeta);
    const relYear = Math.max(options.world.currentYear - startYear, 0);
    if (!worldRef) {
        return { ...base, candidateNations: [], relYear, initialNationGenLimit: 0 };
    }

    const constValues = asRecord(options.scenarioConfig.const);
    const initialNationGenLimit = resolveNumber(constValues, ['initialNationGenLimit'], 0);
    const defaultMaxGeneral = resolveNumber(constValues, ['defaultMaxGeneral', 'maxGeneral'], 0);
    const genLimit = relYear < 3 && initialNationGenLimit > 0 ? initialNationGenLimit : defaultMaxGeneral;

    const generals = worldRef.listGenerals();
    const generalsByNation = new Map<number, General[]>();
    const monarchCityByNation = new Map<number, number>();

    for (const general of generals) {
        if (general.nationId <= 0) {
            continue;
        }
        const list = generalsByNation.get(general.nationId) ?? [];
        list.push(general as General);
        generalsByNation.set(general.nationId, list);
        if (general.officerLevel === 12) {
            monarchCityByNation.set(general.nationId, general.cityId);
        }
    }

    const nations = worldRef.listNations();
    const candidateNations: Array<CandidateNation> = [];

    for (const nation of nations) {
        if (nation.id <= 0) {
            continue;
        }
        const meta = asRecord(nation.meta);
        const isScoutBlocked = readMetaBool(meta, 'scout', readMetaBool(meta, 'blockScout', false));
        if (isScoutBlocked) {
            continue;
        }
        const nationGenerals = generalsByNation.get(nation.id) ?? [];
        if (nationGenerals.length === 0) {
            continue;
        }
        if (typeof genLimit === 'number' && genLimit > 0 && nationGenerals.length >= genLimit) {
            continue;
        }
        let monarchCityId = monarchCityByNation.get(nation.id) ?? null;
        if (!monarchCityId && nation.chiefGeneralId) {
            const chief = worldRef.getGeneralById(nation.chiefGeneralId);
            monarchCityId = chief?.cityId ?? null;
        }
        if (!monarchCityId && nation.capitalCityId) {
            monarchCityId = nation.capitalCityId;
        }
        if (!monarchCityId) {
            continue;
        }
        candidateNations.push({
            nation,
            generals: nationGenerals,
            generalCount: nationGenerals.length,
            monarchCityId,
        });
    }

    return { ...base, candidateNations, relYear, initialNationGenLimit };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_랜덤임관',
    category: '전략',
    reqArg: false,
    createDefinition: () => new ActionDefinition(),
};
