import { z } from 'zod';

const numericRecordSchema = z.record(z.string(), z.number());
const numericArraySchema = z.array(z.number());

const CrewTypeRequirementSchema = z.union([
    z.object({ type: z.literal('ReqTech'), tech: z.number() }),
    z.object({ type: z.literal('ReqRegions'), regions: z.array(z.string()) }),
    z.object({ type: z.literal('ReqCities'), cities: z.array(z.string()) }),
    z.object({ type: z.literal('ReqCitiesWithCityLevel'), level: z.number(), cities: z.array(z.string()) }),
    z.object({ type: z.literal('ReqHighLevelCities'), level: z.number(), count: z.number() }),
    z.object({
        type: z.literal('ReqNationAux'),
        key: z.string(),
        op: z.string(),
        value: z.union([z.number(), z.string()]),
    }),
    z.object({ type: z.literal('ReqMinRelYear'), year: z.number() }),
    z.object({ type: z.literal('ReqChief') }),
    z.object({ type: z.literal('ReqNotChief') }),
    z.object({ type: z.literal('Impossible') }),
    z.object({ type: z.string() }).passthrough(),
]);

const CrewTypeDefinitionInputSchema = z.object({
    id: z.number(),
    armType: z.number(),
    name: z.string(),
    attack: z.number(),
    defence: z.number(),
    speed: z.number(),
    avoid: z.number(),
    magicCoef: z.number(),
    cost: z.number(),
    rice: z.number(),
    requirements: z.array(CrewTypeRequirementSchema),
    attackCoef: z.union([numericRecordSchema, numericArraySchema]),
    defenceCoef: z.union([numericRecordSchema, numericArraySchema]),
    info: z.array(z.string()),
    initSkillTrigger: z.array(z.string()).nullable(),
    phaseSkillTrigger: z.array(z.string()).nullable(),
    iActionList: z.array(z.string()).nullable(),
});

export const UnitSetDefinitionInputSchema = z.object({
    id: z.string(),
    name: z.string(),
    defaultCrewTypeId: z.number().optional(),
    armTypes: z.record(z.string(), z.string()).optional(),
    crewTypes: z.array(CrewTypeDefinitionInputSchema).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
});

export type UnitSetDefinitionInput = z.infer<typeof UnitSetDefinitionInputSchema>;
