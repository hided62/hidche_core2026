import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    reqGeneralGold,
    reqGeneralRice,
    suppliedCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome } from '@sammo-ts/logic/actions/engine.js';
import type {
    ActionContextBase,
    ActionContextBuilder,
    ActionContextOptions,
} from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import {
    buildDomesticContextFromView,
    CommandResolver,
    type DomesticActionContext,
    type InvestmentConfig,
    updateDomesticCriticalMeta,
} from './che_상업투자.js';
import { JosaUtil } from '@sammo-ts/common';
import { clamp } from 'es-toolkit';
import {
    addLegacyStoredFloat,
    readLegacyStoredFloat,
    toLegacyStoredFloat,
} from '@sammo-ts/logic/compat/legacyFloat.js';

export interface TechResearchArgs {}

interface TechResearchContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends DomesticActionContext<TriggerState> {
    nation: Nation;
    nationGeneralCount: number;
}

const ACTION_NAME = '기술 연구';
const CONFIG: InvestmentConfig = {
    key: 'che_기술연구',
    name: ACTION_NAME,
    actionKey: '기술',
    statKey: 'intelligence',
    statExpKey: 'intel_exp',
    cityKey: 'commerce',
    cityMaxKey: 'commerceMax',
    frontDebuff: 1,
};

const readTech = (nation: Nation): number => {
    const tech = nation.meta.tech;
    return typeof tech === 'number' && Number.isFinite(tech) ? tech : 0;
};

// 레거시 nation.tech는 MariaDB FLOAT이며 다음 명령 재조회 시 6자리 유효숫자로 양자화된다.
// Ref stores tech in a MariaDB FLOAT column. FLOAT applies binary32
// quantization on write; its six-significant-digit text rendering happens
// only when the value is read, not on every update.
export const toLegacyStoredTech = toLegacyStoredFloat;

// mysqli renders a MariaDB FLOAT with six significant decimal digits before
// PHP performs the next command's arithmetic. Model that read boundary, then
// model the binary32 write boundary separately.
export const readLegacyStoredTech = readLegacyStoredFloat;

export const addLegacyStoredTech = addLegacyStoredFloat;

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, TechResearchArgs, TechResearchContext<TriggerState>> {
    public readonly key = CONFIG.key;
    public readonly name = ACTION_NAME;
    private readonly command: CommandResolver<TriggerState>;

    constructor(private readonly env: TurnCommandEnv) {
        this.command = new CommandResolver(env.generalActionModules ?? [], env, CONFIG);
    }

    parseArgs(_raw: unknown): TechResearchArgs | null {
        return {};
    }

    buildConstraints(ctx: ConstraintContext, _args: TechResearchArgs): Constraint[] {
        const requirements: RequirementKey[] = [];
        if (ctx.cityId !== undefined) requirements.push({ kind: 'city', id: ctx.cityId });
        if (ctx.nationId !== undefined) requirements.push({ kind: 'nation', id: ctx.nationId });
        const getCost = (context: ConstraintContext, view: StateView): number => {
            const domesticContext = buildDomesticContextFromView<TriggerState>(context, view);
            return domesticContext ? this.command.getCost(domesticContext).gold : 0;
        };
        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            suppliedCity(),
            reqGeneralGold(getCost, requirements),
            reqGeneralRice(() => 0, requirements),
        ];
    }

    resolve(context: TechResearchContext<TriggerState>, _args: TechResearchArgs): GeneralActionOutcome<TriggerState> {
        const result = this.command.resolve(context, context.rng);
        let techScore = result.score;
        const currentTech = readTech(context.nation);
        const relYear = context.relYear ?? 0;
        const techLevelIncYear = this.env.techLevelIncYear ?? 5;
        const initialAllowedTechLevel = this.env.initialAllowedTechLevel ?? 1;
        const relativeMaxTech = clamp(
            Math.floor(relYear / techLevelIncYear) + initialAllowedTechLevel,
            1,
            this.env.maxTechLevel
        );
        const currentTechLevel = clamp(Math.floor(currentTech / 1000), 0, this.env.maxTechLevel);
        if (currentTechLevel >= relativeMaxTech) {
            techScore /= 4;
        }

        const generalCount = Math.max(context.nationGeneralCount, this.env.initialNationGenLimit);
        if (
            (process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(context.general.id)) ||
            (process.env.CORE_AI_TRACE_NATION_IDS?.split(',') ?? []).includes(String(context.nation.id))
        ) {
            process.stdout.write(
                `AI_ACTION_PATCH_TRACE ${JSON.stringify({ engine: 'core-tech', generalId: context.general.id, nationId: context.nation.id, currentTech, techScore, nationGeneralCount: context.nationGeneralCount, generalCount, delta: techScore / generalCount })}\n`
            );
        }

        context.nation.meta = {
            ...context.nation.meta,
            tech: addLegacyStoredTech(
                currentTech,
                techScore / generalCount
            ),
        };
        context.general.gold = Math.max(0, context.general.gold - result.costGold);
        context.general.experience += result.exp;
        context.general.dedication += result.dedication;
        const intelExp = typeof context.general.meta.intel_exp === 'number' ? context.general.meta.intel_exp : 0;
        context.general.meta = updateDomesticCriticalMeta(
            {
                ...context.general.meta,
                intel_exp: intelExp + 1,
            },
            result.pick,
            result.score
        );

        const scoreText = Math.round(result.score).toLocaleString();
        const josaUl = JosaUtil.pick(ACTION_NAME, '을');
        if (result.pick === 'fail') {
            context.addLog(
                `${ACTION_NAME}${josaUl} <span class='ev_failed'>실패</span>하여 <C>${scoreText}</> 상승했습니다.`
            );
        } else if (result.pick === 'success') {
            context.addLog(`${ACTION_NAME}${josaUl} <S>성공</>하여 <C>${scoreText}</> 상승했습니다.`);
        } else {
            context.addLog(`${ACTION_NAME}${josaUl} 하여 <C>${scoreText}</> 상승했습니다.`);
        }
        tryApplyUniqueLottery(context, { acquireType: '아이템', reason: ACTION_NAME });
        return { effects: [] };
    }
}

export const actionContextBuilder: ActionContextBuilder = (
    base: ActionContextBase,
    options: ActionContextOptions
): (ActionContextBase & Record<string, unknown>) | null => {
    if (!base.city || !base.nation || !options.worldRef) {
        return null;
    }
    return {
        ...base,
        city: base.city,
        nation: base.nation,
        nationGeneralCount:
            typeof base.nation.meta.gennum === 'number' && Number.isFinite(base.nation.meta.gennum)
                ? base.nation.meta.gennum
                : options.worldRef.listGenerals().filter((general) => general.nationId === base.nation!.id).length,
        relYear:
            typeof options.scenarioMeta?.startYear === 'number'
                ? options.world.currentYear - options.scenarioMeta.startYear
                : 0,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_기술연구',
    category: '내정',
    reqArg: false,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
