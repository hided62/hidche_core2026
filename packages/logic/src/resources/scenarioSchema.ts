import { z } from 'zod';

export const ScenarioStatBlockSchema = z
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

export const ScenarioDefinitionInputSchema = z
    .object({
        title: z.string(),
        startYear: z.number().optional(),
        life: z.number().optional(),
        fiction: z.number().optional(),
        history: z.array(z.string()).optional(),
        iconPath: z.string().optional(),
        stat: ScenarioStatBlockSchema.optional(),
        map: z.record(z.string(), z.unknown()).optional(),
        const: z.record(z.string(), z.unknown()).optional(),
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

export const ScenarioResourceSchema = z.union([ScenarioDefaultsInputSchema, ScenarioDefinitionInputSchema]);

export type ScenarioDefaultsInput = z.infer<typeof ScenarioDefaultsInputSchema>;
export type ScenarioDefinitionInput = z.infer<typeof ScenarioDefinitionInputSchema>;
