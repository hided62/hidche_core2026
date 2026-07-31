import { asRecord, JosaUtil } from '@sammo-ts/common';
import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { allowJoinAction, beNeutral, beOpeningPart, noPenalty } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import {
    createGeneralPatchEffect,
    createDiplomacyPatchEffect,
    createNationAddEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder, ActionContextBase } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { getLegacyStringWidth } from '@sammo-ts/logic/troop/management.js';

export interface UprisingArgs {}

export interface UprisingContext extends ActionContextBase {
    createNationId: () => number;
    listNations?: () => Nation[];
    scenarioId: number;
    baseRice: number;
}

const ACTION_NAME = '거병';
const formatHourMinute = (date: Date): string =>
    `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

const truncateLegacyWidth = (value: string, maxWidth: number): string => {
    let result = '';
    let width = 0;
    for (const character of value) {
        const characterWidth = getLegacyStringWidth(character);
        if (width + characterWidth > maxWidth) {
            break;
        }
        result += character;
        width += characterWidth;
    }
    return result;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, UprisingArgs> {
    public readonly key = 'che_거병';
    public readonly name = ACTION_NAME;
    getInheritanceActiveActionAmount(): number {
        return 1;
    }

    parseArgs(_raw: unknown): UprisingArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: UprisingArgs): Constraint[] {
        return [beNeutral(), beOpeningPart(), allowJoinAction(), noPenalty('noFoundNation')];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: UprisingArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const uprisingCtx = context as unknown as UprisingContext;

        if (!uprisingCtx.createNationId) {
            throw new Error('createNationId is not defined in context');
        }

        const newNationId = uprisingCtx.createNationId();
        const josaYi = JosaUtil.pick(general.name, '이');

        let nationName = general.name;
        const nations = uprisingCtx.listNations ? uprisingCtx.listNations() : [];

        if (nations.some((n) => n.name === nationName)) {
            nationName = truncateLegacyWidth('㉥' + nationName, 18);
        }

        if (nations.some((n) => n.name === nationName)) {
            nationName = '㉥' + nationName;
        }

        const npcNationPolicy =
            general.npcState >= 2
                ? {
                      values: {
                          minNPCRecruitCityPopulation: 0,
                      },
                  }
                : undefined;

        const newNation: Nation = {
            id: newNationId,
            name: nationName,
            color: '#330000',
            typeCode: 'che_중립',
            level: 0,
            capitalCityId: 0,
            chiefGeneralId: general.id,
            gold: 0,
            rice: uprisingCtx.baseRice,
            power: 0,
            meta: {
                rate: 20,
                bill: 100,
                strategic_cmd_limit: 12,
                surlimit: 72,
                secretlimit: uprisingCtx.scenarioId >= 1000 ? 1 : 3,
                gennum: 1,
                ...(npcNationPolicy ? { npc_nation_policy: npcNationPolicy } : {}),
            },
        };

        const cityName = context.city?.name ?? '??';

        context.addLog(`거병에 성공하였습니다. <1>${formatHourMinute(uprisingCtx.general.turnTime)}</>`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`<Y>${general.name}</>${josaYi} <G><b>${cityName}</b></>에 거병하였습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });
        context.addLog(`<Y><b>【거병】</b></><D><b>${general.name}</b></>${josaYi} 세력을 결성하였습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });
        context.addLog(`<G><b>${cityName}</b></>에서 거병`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });
        context.addLog(`<Y>${general.name}</>${josaYi} <G><b>${cityName}</b></>에서 거병`, {
            scope: LogScope.NATION,
            nationId: newNationId,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        tryApplyUniqueLottery(context, {
            acquireType: '아이템',
            reason: ACTION_NAME,
            nationName,
        });

        const effects: GeneralActionEffect<TriggerState>[] = [
            createNationAddEffect(newNation),
            createGeneralPatchEffect<TriggerState>({
                nationId: newNationId,
                officerLevel: 12,
                experience: (general.experience || 0) + 100,
                dedication: (general.dedication || 0) + 100,
                meta: {
                    ...general.meta,
                    belong: 1,
                    officer_city: 0,
                },
            }),
        ];
        for (const nation of nations) {
            if (nation.id === newNationId) {
                continue;
            }
            effects.push(
                createDiplomacyPatchEffect(nation.id, newNationId, { state: 2, term: 0 }),
                createDiplomacyPatchEffect(newNationId, nation.id, { state: 2, term: 0 })
            );
        }

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const worldMeta = asRecord(options.world.meta);
    const constValues = asRecord(options.scenarioConfig.const);
    const scenarioRaw = worldMeta.scenarioId ?? worldMeta.scenario;
    const baseRiceRaw = constValues.baseRice ?? constValues.baserice;
    return {
        ...base,
        createNationId: options.createNationId,
        listNations: () => options.worldRef?.listNations() ?? [],
        scenarioId: typeof scenarioRaw === 'number' && Number.isFinite(scenarioRaw) ? scenarioRaw : 0,
        baseRice: typeof baseRiceRaw === 'number' && Number.isFinite(baseRiceRaw) ? baseRiceRaw : 2_000,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_거병',
    category: '전략',
    reqArg: false,

    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
