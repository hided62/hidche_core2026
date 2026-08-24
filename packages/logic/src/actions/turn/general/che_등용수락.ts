import type { General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    existsDestNation,
    beNeutral,
    allowJoinDestNation,
    reqDestNationValue,
    differentDestNation,
    reqGeneralValue,
    reqEnvValue,
    readMetaNumberFromUnknown,
    denyWithReason,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createLogEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { parseArgsWithSchema } from '../parseArgs.js';
import { LEGACY_DEFAULT_MAX_LEVEL } from '@sammo-ts/logic/scenario/constants.js';

const ACTION_NAME = '등용수락';
const ACTION_KEY = 'che_등용수락';
const ARGS_SCHEMA = z.object({
    destNationId: z.number().int().positive(),
    destGeneralId: z.number().int().positive(),
});
export type AcceptScoutArgs = z.infer<typeof ARGS_SCHEMA>;

export interface AcceptScoutResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destNation?: Nation;
    destGeneral?: General<TriggerState>;
    worldKillturn?: number;
}

const differentDestGeneral = (destGeneralId: number): Constraint => ({
    name: 'differentDestGeneral',
    // Ref keeps only the recruiter id/nation snapshot in the letter. The
    // recruiter can be deleted before the receiver accepts it, so this
    // self-check must not turn the missing live recruiter into a dependency.
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx) =>
        ctx.actorId === destGeneralId
            ? { kind: 'deny', reason: '본인의 등용장을 수락할 수 없습니다.' }
            : { kind: 'allow' },
});

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, AcceptScoutArgs> {
    readonly key = ACTION_KEY;

    constructor(private readonly env: TurnCommandEnv) {}

    resolve(
        context: AcceptScoutResolveContext<TriggerState>,
        _args: AcceptScoutArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const currentNation = context.nation;
        const destNation = context.destNation;
        const destGeneral = context.destGeneral;
        const effects: GeneralActionEffect<TriggerState>[] = [];

        if (!destNation) throw new Error('Target nation not found.');

        // 1. Logs
        const destNationName = destNation.name;
        const generalName = general.name;

        const josaRo = JosaUtil.pick(destNationName, '로');
        const josaYi = JosaUtil.pick(generalName, '이');

        // Self Log
        context.addLog(`<D>${destNationName}</>${josaRo} 망명하여 수도로 이동합니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        // Global Log
        context.addLog(`<Y>${generalName}</>${josaYi} <D><b>${destNationName}</b></>${josaRo} <S>망명</>하였습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });

        // 2. Recruiter Rewards. Ref resolves a deleted recruiter as a dummy
        // general: joining still succeeds, while recruiter-only rewards and
        // logs are discarded.
        const belong = readMetaNumberFromUnknown(general.meta, 'belong') ?? 0;
        const maxBelong = readMetaNumberFromUnknown(general.meta, 'max_belong') ?? 0;
        if (destGeneral) {
            const recruiterExperience = destGeneral.experience + 100;
            const recruiterDedication = destGeneral.dedication + 100;
            const recruiterExpLevel = Math.max(
                0,
                Math.min(
                    this.env.maxStatLevel ?? LEGACY_DEFAULT_MAX_LEVEL,
                    recruiterExperience < 1_000
                        ? Math.trunc(recruiterExperience / 100)
                        : Math.trunc(Math.sqrt(recruiterExperience / 10))
                )
            );
            const recruiterDedicationLevel = Math.max(
                0,
                Math.min(this.env.maxDedicationLevel ?? 30, Math.ceil(Math.sqrt(recruiterDedication) / 10))
            );
            const previousRecruiterExpLevel =
                typeof destGeneral.meta.explevel === 'number' ? destGeneral.meta.explevel : 0;
            const previousRecruiterDedicationLevel =
                typeof destGeneral.meta.dedlevel === 'number' ? destGeneral.meta.dedlevel : 0;
            effects.push(
                createGeneralPatchEffect(
                    {
                        experience: recruiterExperience,
                        dedication: recruiterDedication,
                        meta: {
                            ...destGeneral.meta,
                            explevel: recruiterExpLevel,
                            dedlevel: recruiterDedicationLevel,
                        },
                    },
                    destGeneral.id
                )
            );
            if (recruiterExpLevel !== previousRecruiterExpLevel) {
                const recruiterLevelJosaRo = JosaUtil.pick(String(recruiterExpLevel), '로');
                effects.push(
                    createLogEffect(
                        recruiterExpLevel > previousRecruiterExpLevel
                            ? `<C>Lv ${recruiterExpLevel}</>${recruiterLevelJosaRo} <C>레벨업</>!`
                            : `<C>Lv ${recruiterExpLevel}</>${recruiterLevelJosaRo} <R>레벨다운</>!`,
                        {
                            scope: LogScope.GENERAL,
                            generalId: destGeneral.id,
                            category: LogCategory.ACTION,
                            format: LogFormat.PLAIN,
                            legacyFlushGroup: 1,
                        }
                    )
                );
            }
            if (recruiterDedicationLevel !== previousRecruiterDedicationLevel) {
                const maxDedicationLevel = this.env.maxDedicationLevel ?? 30;
                const dedicationLevelText =
                    recruiterDedicationLevel === 0
                        ? '무품관'
                        : `${maxDedicationLevel - recruiterDedicationLevel + 1}품관`;
                const billText = new Intl.NumberFormat('en-US').format(recruiterDedicationLevel * 200 + 400);
                const josaRoDedication = JosaUtil.pick(dedicationLevelText, '로');
                const josaRoBill = JosaUtil.pick(billText, '로');
                effects.push(
                    createLogEffect(
                        recruiterDedicationLevel > previousRecruiterDedicationLevel
                            ? `<Y>${dedicationLevelText}</>${josaRoDedication} <C>승급</>하여 봉록이 <C>${billText}</>${josaRoBill} <C>상승</>했습니다!`
                            : `<Y>${dedicationLevelText}</>${josaRoDedication} <R>강등</>되어 봉록이 <C>${billText}</>${josaRoBill} <R>하락</>했습니다!`,
                        {
                            scope: LogScope.GENERAL,
                            generalId: destGeneral.id,
                            category: LogCategory.ACTION,
                            format: LogFormat.PLAIN,
                            legacyFlushGroup: 1,
                        }
                    )
                );
            }
            effects.push(
                createLogEffect(`<Y>${generalName}</> 등용에 성공했습니다.`, {
                    scope: LogScope.GENERAL,
                    generalId: destGeneral.id,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                    legacyFlushGroup: 1,
                }),
                createLogEffect(`<Y>${generalName}</> 등용에 성공`, {
                    scope: LogScope.GENERAL,
                    generalId: destGeneral.id,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                    legacyFlushGroup: 1,
                })
            );
        }

        // 3. Betrayal Logic
        // Legacy: GameConst::$defaultGold (usually 1000/2000).
        const safeGold = this.env.defaultNpcGold;
        const safeRice = this.env.defaultNpcRice;

        let newGold = general.gold;
        let newRice = general.rice;
        let newExp = general.experience;
        let newDed = general.dedication;

        const betrayCount = readMetaNumberFromUnknown(general.meta, 'betray') ?? 0;
        let newBetray = betrayCount;

        if (currentNation && currentNation.id !== 0) {
            // Return excess gold/rice to current nation
            let returnGold = 0;
            let returnRice = 0;

            if (general.gold > safeGold) {
                returnGold = general.gold - safeGold;
                newGold = safeGold;
            }
            if (general.rice > safeRice) {
                returnRice = general.rice - safeRice;
                newRice = safeRice;
            }

            if (returnGold > 0 || returnRice > 0) {
                effects.push(
                    createNationPatchEffect(
                        {
                            gold: currentNation.gold + returnGold,
                            rice: currentNation.rice + returnRice,
                        },
                        currentNation.id
                    )
                );
            }

            // Penalty
            // 10% * betray count deduction
            const penaltyFactor = 1 - 0.1 * betrayCount;
            // Apply penalty
            newExp = Math.floor(newExp * Math.max(0, penaltyFactor));
            newDed = Math.floor(newDed * Math.max(0, penaltyFactor));
            newBetray = Math.min(9, newBetray + 1);
        } else {
            // Neutral -> Join: Grant Bonus
            newExp += 100;
            newDed += 100;
        }

        // 4. Update General (Self)
        const targetCityId = destNation.capitalCityId;
        if (!targetCityId) throw new Error('Capital city not found.');

        effects.push(
            createGeneralPatchEffect(
                {
                    nationId: destNation.id,
                    cityId: targetCityId,
                    experience: newExp,
                    dedication: newDed,
                    gold: newGold,
                    rice: newRice,
                    officerLevel: 1, // Reset rank
                    troopId: 0, // Quit troop
                    meta: {
                        ...general.meta,
                        belong: 1,
                        permission: 'normal',
                        officer_city: 0,
                        betray: newBetray,
                        ...(general.npcState < 2
                            ? {
                                  killturn: context.worldKillturn ?? general.meta.killturn,
                                  max_belong: Math.max(belong, maxBelong),
                              }
                            : {}),
                    },
                },
                general.id
            )
        );
        if (currentNation && currentNation.id !== 0) {
            const currentCount = typeof currentNation.meta.gennum === 'number' ? currentNation.meta.gennum : 0;
            effects.push(
                createNationPatchEffect(
                    {
                        meta: {
                            ...currentNation.meta,
                            gennum: Math.max(0, currentCount - 1),
                        },
                    },
                    currentNation.id
                )
            );
        }
        const destCount = typeof destNation.meta.gennum === 'number' ? destNation.meta.gennum : 0;
        effects.push(
            createNationPatchEffect(
                {
                    meta: {
                        ...destNation.meta,
                        gennum: destCount + 1,
                    },
                },
                destNation.id
            )
        );
        context.addLog(`<D><b>${destNationName}</b></>${josaRo} 망명`, {
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
        });

        const deletedTroopIds: number[] = [];
        if (general.troopId === general.id) {
            deletedTroopIds.push(general.id);
            for (const member of context.worldView?.listGenerals() ?? []) {
                if (member.id !== general.id && member.troopId === general.id) {
                    effects.push(createGeneralPatchEffect({ troopId: 0 }, member.id));
                }
            }
        }

        return { effects, deletedTroopIds };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, AcceptScoutArgs, AcceptScoutResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    getInheritanceActiveActionAmount(): number {
        return 1;
    }
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.resolver = new ActionResolver(env);
    }

    parseArgs(raw: unknown): AcceptScoutArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildPermissionConstraints(_ctx: ConstraintContext, _args: AcceptScoutArgs): Constraint[] {
        return [denyWithReason('예약 불가능 커맨드')];
    }

    buildConstraints(_ctx: ConstraintContext, _args: AcceptScoutArgs): Constraint[] {
        const env = _ctx.env;
        const year = typeof env.year === 'number' ? env.year : 0;
        const relYear = typeof env.relYear === 'number' ? env.relYear : year;

        return [
            reqEnvValue('join_mode', '!=', 'onlyRandom', '랜덤 임관만 가능합니다'),
            existsDestNation(),
            differentDestGeneral(_args.destGeneralId),
            beNeutral(),
            allowJoinDestNation(relYear),
            reqDestNationValue('level', '국가규모', '>', 0, '방랑군에는 임관할 수 없습니다.'),
            differentDestNation(),
            reqGeneralValue('officerLevel', '직위', '!=', 12, '군주는 등용장을 수락할 수 없습니다'),
        ];
    }

    resolve(
        context: AcceptScoutResolveContext<TriggerState>,
        args: AcceptScoutArgs
    ): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    const args = options.actionArgs as Partial<AcceptScoutArgs>;
    let destNation: Nation | undefined;
    let destGeneral: General | undefined;

    if (args.destNationId) {
        destNation = options.worldRef?.getNationById(args.destNationId) ?? undefined;
    }
    if (args.destGeneralId) {
        destGeneral = options.worldRef?.getGeneralById(args.destGeneralId) ?? undefined;
    }

    return {
        ...base,
        destNation,
        destGeneral,
        worldKillturn: typeof options.world.meta?.killturn === 'number' ? options.world.meta.killturn : undefined,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_등용수락',
    category: '인사',
    reqArg: true,
    availabilityArgs: {
        destNationId: 'number',
        destGeneralId: 'number',
    },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
