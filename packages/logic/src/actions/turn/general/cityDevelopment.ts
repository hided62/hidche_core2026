import type {
    City,
    General,
    GeneralTriggerState,
} from '../../../domain/entities.js';
import type {
    Constraint,
    ConstraintContext,
    StateView,
} from '../../../constraints/types.js';
import {
    notBeNeutral,
    notWanderingNation,
    occupiedCity,
    remainCityCapacityByMax,
    reqGeneralGold,
    suppliedCity,
} from '../../../constraints/presets.js';
import type { GeneralActionDefinition } from '../../definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '../../engine.js';
import {
    createCityPatchEffect,
    createGeneralPatchEffect,
    createLogEffect,
} from '../../engine.js';
import { LogCategory, LogFormat, LogScope } from '../../../logging/types.js';

export interface CityDevelopmentArgs {}

export interface CityDevelopmentEnvironment {
    develCost?: number;
    amount?: number;
}

export interface CityDevelopmentConfig {
    key: string;
    name: string;
    statKey: keyof City;
    maxKey: keyof City;
    label: string;
    baseAmount: number;
}

const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

const readNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

export class CityDevelopmentActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionDefinition<TriggerState, CityDevelopmentArgs> {
    public readonly key: string;
    public readonly name: string;
    private readonly config: CityDevelopmentConfig;
    private readonly env: CityDevelopmentEnvironment;

    constructor(config: CityDevelopmentConfig, env: CityDevelopmentEnvironment) {
        this.key = config.key;
        this.name = config.name;
        this.config = config;
        this.env = env;
    }

    parseArgs(_raw: unknown): CityDevelopmentArgs | null {
        void _raw;
        return {};
    }

    buildConstraints(
        _ctx: ConstraintContext,
        _args: CityDevelopmentArgs
    ): Constraint[] {
        const getRequiredGold = (_context: ConstraintContext, _view: StateView): number =>
            this.env.develCost ?? 0;

        return [
            notBeNeutral(),
            notWanderingNation(),
            occupiedCity(),
            suppliedCity(),
            remainCityCapacityByMax(
                String(this.config.statKey),
                String(this.config.maxKey),
                this.config.label
            ),
            reqGeneralGold(getRequiredGold),
        ];
    }

    resolve(
        context: GeneralActionResolveContext<TriggerState>,
        _args: CityDevelopmentArgs
    ): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const city = context.city;
        if (!city) {
            return {
                effects: [
                    createLogEffect('도시 정보를 찾지 못했습니다.', {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const baseAmount = this.env.amount ?? this.config.baseAmount;
        const current = readNumber(city[this.config.statKey]);
        const max = readNumber(city[this.config.maxKey]);
        if (current === null || max === null) {
            return {
                effects: [
                    createLogEffect('도시 정보를 찾지 못했습니다.', {
                        scope: LogScope.GENERAL,
                        category: LogCategory.ACTION,
                        format: LogFormat.MONTH,
                    }),
                ],
            };
        }

        const nextValue = clamp(current + baseAmount, 0, max);
        const costGold = this.env.develCost ?? 0;
        const generalPatch: Partial<General<TriggerState>> = {
            gold: Math.max(0, general.gold - costGold),
        };

        const logMessage = `${this.config.label}이 ${nextValue - current} 증가했습니다.`;

        return {
            effects: [
                createCityPatchEffect(
                    { [this.config.statKey]: nextValue } as Partial<City>,
                    city.id
                ),
                createGeneralPatchEffect<TriggerState>(generalPatch, general.id),
                createLogEffect(logMessage, {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    format: LogFormat.MONTH,
                }),
            ],
        };
    }
}
