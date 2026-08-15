import { z } from 'zod';
import { SCENARIO_EFFECT_KEYS } from '../scenario/scenarioEffect.js';

const ScenarioStatBlockSchema = z
    .object({
        total: z.number(),
        min: z.number(),
        max: z.number(),
        npcTotal: z.number(),
        npcMax: z.number(),
        npcMin: z.number(),
        chiefMin: z.number(),
    })
    .partial();

export const ScenarioDefaultsInputSchema = z.object({
    stat: ScenarioStatBlockSchema.optional(),
    iconPath: z.string().optional(),
});

const ScenarioExtendsInputSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const ScenarioConstInputSchema = z
    .object({
        scenarioEffect: z.union([z.enum(SCENARIO_EFFECT_KEYS), z.literal(''), z.literal('None'), z.null()]).optional(),
    })
    .catchall(z.unknown());

const ScenarioBodyInputSchema = z
    .object({
        extends: ScenarioExtendsInputSchema.optional(),
        startYear: z.number().optional(),
        life: z.number().optional(),
        fiction: z.number().optional(),
        history: z.array(z.string()).optional(),
        iconPath: z.string().optional(),
        stat: ScenarioStatBlockSchema.optional(),
        map: z.record(z.string(), z.unknown()).optional(),
        const: ScenarioConstInputSchema.optional(),
        nation: z.array(z.unknown()).optional(),
        diplomacy: z.array(z.unknown()).optional(),
        general: z.array(z.unknown()).optional(),
        general_ex: z.array(z.unknown()).optional(),
        general_neutral: z.array(z.unknown()).optional(),
        cities: z.array(z.unknown()).optional(),
        events: z.array(z.unknown()).optional(),
        initialEvents: z.array(z.unknown()).optional(),
        initialActions: z.array(z.unknown()).optional(),
        ignoreDefaultEvents: z.boolean().optional(),
    })
    .passthrough();

export const ScenarioDefinitionInputSchema = ScenarioBodyInputSchema.extend({
    title: z.string(),
});

export const ScenarioFragmentInputSchema = ScenarioBodyInputSchema.extend({
    title: z.never().optional(),
});

export const ScenarioResourceSchema = z.union([
    ScenarioDefaultsInputSchema,
    ScenarioDefinitionInputSchema,
    ScenarioFragmentInputSchema,
]);

export type ScenarioDefaultsInput = z.infer<typeof ScenarioDefaultsInputSchema>;
export type ScenarioDefinitionInput = z.infer<typeof ScenarioDefinitionInputSchema>;
export type ScenarioFragmentInput = z.infer<typeof ScenarioFragmentInputSchema>;
