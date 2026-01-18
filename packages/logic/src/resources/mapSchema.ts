import { z } from 'zod';

export const MapCityStatsSchema = z.object({
    population: z.number(),
    agriculture: z.number(),
    commerce: z.number(),
    security: z.number(),
    defence: z.number(),
    wall: z.number(),
});

export const MapCityDefinitionSchema = z.object({
    id: z.number(),
    name: z.string(),
    level: z.number(),
    region: z.number(),
    position: z.object({
        x: z.number(),
        y: z.number(),
    }),
    connections: z.array(z.number()),
    max: MapCityStatsSchema,
    initial: MapCityStatsSchema,
    meta: z.record(z.string(), z.unknown()).optional(),
});

export const MapDefaultsSchema = z
    .object({
        trust: z.number(),
        trade: z.number(),
        supplyState: z.number(),
        frontState: z.number(),
    })
    .partial();

export const MapDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    cities: z.array(MapCityDefinitionSchema),
    defaults: MapDefaultsSchema.optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
});

export const RegionMapSchema = z.record(z.string(), z.record(z.string(), z.string()));

export const MapResourceSchema = z.union([MapDefinitionSchema, RegionMapSchema]);

export type MapDefinitionInput = z.infer<typeof MapDefinitionSchema>;
export type RegionMapInput = z.infer<typeof RegionMapSchema>;
