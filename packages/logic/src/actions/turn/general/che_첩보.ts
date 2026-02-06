import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notOccupiedDestCity,
    reqGeneralGold,
    reqGeneralRice,
    existsDestCity,
    notBeNeutral,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBase, ActionContextOptions } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { MapDefinition, UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface SpyResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity?: City;
    destNation?: Nation | null;
    allGenerals?: General[];
    unitSet?: UnitSetDefinition | null;
    env?: TurnCommandEnv;
    map?: MapDefinition;
}

const ACTION_NAME = '첩보';
const ACTION_KEY = 'che_첩보';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type SpyArgs = z.infer<typeof ARGS_SCHEMA>;

const getCityDistance = (map: MapDefinition | undefined, sourceCityId: number, targetCityId: number): number => {
    if (!map) {
        return 3;
    }
    if (sourceCityId === targetCityId) {
        return 0;
    }

    const cityById = new Map(map.cities.map((city) => [city.id, city]));
    if (!cityById.has(sourceCityId) || !cityById.has(targetCityId)) {
        return 3;
    }

    const queue: Array<{ cityId: number; distance: number }> = [{ cityId: sourceCityId, distance: 0 }];
    const visited = new Set<number>([sourceCityId]);

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            break;
        }
        if (current.distance >= 2) {
            continue;
        }

        const city = cityById.get(current.cityId);
        if (!city) {
            continue;
        }
        for (const neighbor of city.connections) {
            if (neighbor === targetCityId) {
                return current.distance + 1;
            }
            if (visited.has(neighbor)) {
                continue;
            }
            visited.add(neighbor);
            queue.push({ cityId: neighbor, distance: current.distance + 1 });
        }
    }

    return 3;
};

const readNationTech = (nation: Nation | null | undefined): number => {
    if (!nation) {
        return 0;
    }
    const tech = nation.meta.tech;
    return typeof tech === 'number' ? Math.floor(tech) : 0;
};

const readSpyMeta = (raw: unknown): Record<string, number> => {
    let source: unknown = raw;
    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch (_error) {
            source = null;
        }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return {};
    }
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            result[key] = value;
        }
    }
    return result;
};

const summarizeCrewType = (
    crewTypeId: number,
    count: number,
    unitSet: UnitSetDefinition | null | undefined
): string => {
    const crewTypeName = unitSet?.crewTypes?.find((entry) => entry.id === crewTypeId)?.name ?? String(crewTypeId);
    return `${crewTypeName.slice(0, 2)}:${count}`;
};

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, SpyArgs> {
    readonly key = ACTION_KEY;

    resolve(context: GeneralActionResolveContext<TriggerState>, args: SpyArgs): GeneralActionOutcome<TriggerState> {
        const ctx = context as SpyResolveContext<TriggerState>;
        const general = ctx.general;
        const nation = ctx.nation;
        const { destCityId } = args;

        const destCity = ctx.destCity;
        if (!destCity) throw new Error('Target city missing');

        const env = ctx.env;
        const cost = (env?.develCost ?? 100) * 3;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        const destCityName = destCity.name;
        const currentCityId = general.cityId;
        const distance = getCityDistance(ctx.map, currentCityId, destCityId);

        const cityGenerals = (ctx.allGenerals ?? []).filter(
            (candidate) => candidate.cityId === destCityId && candidate.nationId === destCity.nationId
        );
        const totalCrew = cityGenerals.reduce((sum, candidate) => sum + candidate.crew, 0);
        const byCrewType = cityGenerals.reduce<Map<number, number>>((acc, candidate) => {
            const current = acc.get(candidate.crewTypeId) ?? 0;
            acc.set(candidate.crewTypeId, current + 1);
            return acc;
        }, new Map<number, number>());

        const trust = destCity.meta.trust;
        const trustText = typeof trust === 'number' ? trust.toFixed(1) : '?';
        if (distance <= 1) {
            ctx.addLog(`<G><b>${destCityName}</b></>의 정보를 많이 얻었습니다.`, {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            ctx.addLog(
                `【<G>${destCityName}</>】주민:${destCity.population.toLocaleString()}, 민심:${trustText}, 장수:${cityGenerals.length}, 병력:${totalCrew.toLocaleString()}`,
                {
                    category: LogCategory.ACTION,
                    format: LogFormat.RAWTEXT,
                }
            );
            ctx.addLog(
                `【<M>첩보</>】농업:${destCity.agriculture.toLocaleString()}, 상업:${destCity.commerce.toLocaleString()}, 치안:${destCity.security.toLocaleString()}, 수비:${destCity.defence.toLocaleString()}, 성벽:${destCity.wall.toLocaleString()}`,
                {
                    category: LogCategory.ACTION,
                    format: LogFormat.RAWTEXT,
                }
            );
            const crewTypeSummary = Array.from(byCrewType.entries())
                .map(([crewTypeId, count]) => summarizeCrewType(crewTypeId, count, ctx.unitSet))
                .join(' ');
            ctx.addLog(`【<S>병종</>】 ${crewTypeSummary}`, {
                category: LogCategory.ACTION,
                format: LogFormat.RAWTEXT,
            });

            const destNation = ctx.destNation;
            if (destNation && destNation.id !== 0 && nation && nation.id !== 0) {
                const techDiff = readNationTech(destNation) - readNationTech(nation);
                const techText =
                    techDiff >= 1000
                        ? '<M>↑</>압도'
                        : techDiff >= 250
                          ? '<Y>▲</>우위'
                          : techDiff >= -250
                            ? '<W>↕</>대등'
                            : techDiff >= -1000
                              ? '<G>▼</>열위'
                              : '<C>↓</>미미';
                ctx.addLog(`【<span class='ev_notice'>${destNation.name}</span>】아국대비기술:${techText}`, {
                    category: LogCategory.ACTION,
                    format: LogFormat.RAWTEXT,
                });
            }
        } else if (distance === 2) {
            ctx.addLog(`<G><b>${destCityName}</b></>의 정보를 어느 정도 얻었습니다.`, {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            ctx.addLog(
                `【<G>${destCityName}</>】주민:${destCity.population.toLocaleString()}, 민심:${trustText}, 장수:${cityGenerals.length}, 병력:${totalCrew.toLocaleString()}`,
                {
                    category: LogCategory.ACTION,
                    format: LogFormat.RAWTEXT,
                }
            );
            ctx.addLog(
                `【<M>첩보</>】농업:${destCity.agriculture.toLocaleString()}, 상업:${destCity.commerce.toLocaleString()}, 치안:${destCity.security.toLocaleString()}, 수비:${destCity.defence.toLocaleString()}, 성벽:${destCity.wall.toLocaleString()}`,
                {
                    category: LogCategory.ACTION,
                    format: LogFormat.RAWTEXT,
                }
            );
        } else {
            ctx.addLog(`<G><b>${destCityName}</b></>의 소문만 들을 수 있었습니다.`, {
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            });
            ctx.addLog(
                `【<G>${destCityName}</>】주민:${destCity.population.toLocaleString()}, 민심:${trustText}, 장수:${cityGenerals.length}, 병력:${totalCrew.toLocaleString()}`,
                {
                    category: LogCategory.ACTION,
                    format: LogFormat.RAWTEXT,
                }
            );
        }

        if (nation) {
            const spyInfo = readSpyMeta(nation.meta.spy);
            const newSpyInfo = { ...spyInfo, [destCityId]: 3 };

            effects.push(
                createNationPatchEffect(
                    {
                        meta: { ...nation.meta, spy: newSpyInfo },
                    },
                    nation.id
                )
            );
        }

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    gold: Math.max(0, general.gold - cost),
                    rice: Math.max(0, general.rice - cost),
                    experience: general.experience + 50,
                    dedication: general.dedication + 30,
                    meta: {
                        ...general.meta,
                        leadership_exp:
                            (typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0) + 1,
                    },
                },
                general.id
            )
        );

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SpyArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): SpyArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(ctx: ConstraintContext, _args: SpyArgs): Constraint[] {
        const env = ctx.env;
        const cost = ((env.develCost as number) ?? 100) * 3;
        return [notBeNeutral(), reqGeneralGold(() => cost), reqGeneralRice(() => cost)];
    }

    buildConstraints(ctx: ConstraintContext, _args: SpyArgs): Constraint[] {
        const env = ctx.env;
        const cost = ((env.develCost as number) ?? 100) * 3;
        return [
            notBeNeutral(),
            existsDestCity(),
            reqGeneralGold(() => cost),
            reqGeneralRice(() => cost),
            notOccupiedDestCity(),
        ];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: SpyArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = (base: ActionContextBase, options: ActionContextOptions) => {
    const destCityId = options.actionArgs?.destCityId;
    let destCity = null;
    let destNation = null;
    if (typeof destCityId === 'number' && options.worldRef) {
        destCity = options.worldRef.getCityById(destCityId);
        if (destCity && destCity.nationId) {
            destNation = options.worldRef.getNationById(destCity.nationId);
        }
    }
    return {
        ...base,
        destCity,
        destNation,
        allGenerals: options.worldRef?.listGenerals() ?? [],
        unitSet: options.unitSet ?? null,
        map: options.map,
        env: options.scenarioConfig.const as unknown as TurnCommandEnv,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_첩보',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
