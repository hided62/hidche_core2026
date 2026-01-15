import type { GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import { beNeutral } from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type { GeneralActionOutcome, GeneralActionResolveContext } from '@sammo-ts/logic/actions/engine.js';
import {
    createGeneralPatchEffect,
    createNationAddEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder, ActionContextBase } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';

export interface UprisingArgs { }

export interface UprisingContext extends ActionContextBase {
    createNationId: () => number;
    listNations?: () => Nation[];
}

const ACTION_NAME = '거병';

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, UprisingArgs> {
    public readonly key = 'che_거병';
    public readonly name = ACTION_NAME;

    parseArgs(_raw: unknown): UprisingArgs | null {
        return {};
    }

    buildConstraints(_ctx: ConstraintContext, _args: UprisingArgs): Constraint[] {
        return [beNeutral()];
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
        const josaYi = '이'; // Mock JodaUtil.pick

        let nationName = general.name;
        const nations = uprisingCtx.listNations ? uprisingCtx.listNations() : [];

        if (nations.some((n) => n.name === nationName)) {
            nationName = '㉥' + nationName;
            if (nationName.length > 18) nationName = nationName.substring(0, 18);
        }

        if (nations.some((n) => n.name === nationName)) {
            nationName = '㉥' + nationName;
        }

        const newNation: Nation = {
            id: newNationId,
            name: nationName,
            color: '#330000',
            typeCode: 'che_중립',
            level: 0,
            capitalCityId: null,
            chiefGeneralId: general.id,
            gold: 0,
            rice: 2000,
            power: 0,
            meta: {
                rate: 20,
                bill: 100,
                strategic_cmd_limit: 12,
                surlimit: 72,
                secretlimit: 3,
                gennum: 1,
            },
        };

        const cityName = context.city?.name ?? '??';

        context.addLog(`거병에 성공하였습니다.`, {
            category: LogCategory.USER,
            format: LogFormat.PLAIN,
        });
        context.addLog(`${general.name}${josaYi} ${cityName}에 거병하였습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        context.addLog(`【거병】${general.name}${josaYi} 세력을 결성하였습니다.`, {
            category: LogCategory.HISTORY,
            format: LogFormat.PLAIN,
        });
        context.addLog(`${cityName}에서 거병`, {
            category: LogCategory.HISTORY,
            format: LogFormat.PLAIN,
        });
        context.addLog(`${general.name}${josaYi} ${cityName}에서 거병`, {
            category: LogCategory.HISTORY,
            format: LogFormat.PLAIN,
        });

        const effects = [
            createNationAddEffect(newNation),
            createGeneralPatchEffect<TriggerState>({
                nationId: newNationId,
                officerLevel: 12,
                experience: (general.experience || 0) + 100,
                dedication: (general.dedication || 0) + 100,
            }),
        ];

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    return {
        ...base,
        createNationId: options.createNationId,
        listNations: () => options.worldRef?.listNations() ?? [],
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_거병',
    category: '전략',
    reqArg: false,
    args: {},
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
