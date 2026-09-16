import { z } from 'zod';
import { asNumber, asRecord } from '@sammo-ts/common';
import type { GamePrisma } from '@sammo-ts/infra';

const dex = z.object({ dex1: z.number(), dex2: z.number(), dex3: z.number(), dex4: z.number(), dex5: z.number() });
export const zAuditGeneralData = z.object({
    id: z.number(),
    name: z.string(),
    userId: z.string().nullable(),
    nationId: z.number(),
    cityId: z.number(),
    troopId: z.number(),
    npcState: z.number(),
    gold: z.number(),
    rice: z.number(),
    stats: z.object({ leadership: z.number(), strength: z.number(), intelligence: z.number() }),
    experience: z.number(),
    dedication: z.number(),
    officerLevel: z.number(),
    injury: z.number(),
    age: z.number(),
    crew: z.number(),
    crewTypeId: z.number(),
    train: z.number(),
    atmos: z.number(),
    dex,
    role: z.object({
        personality: z.string().nullable(),
        specialDomestic: z.string().nullable(),
        specialWar: z.string().nullable(),
        items: z.object({
            horse: z.string().nullable(),
            weapon: z.string().nullable(),
            book: z.string().nullable(),
            item: z.string().nullable(),
        }),
    }),
});
export const zAuditCityData = z.object({
    id: z.number(),
    name: z.string(),
    nationId: z.number(),
    level: z.number(),
    state: z.number(),
    population: z.number(),
    populationMax: z.number(),
    agriculture: z.number(),
    agricultureMax: z.number(),
    commerce: z.number(),
    commerceMax: z.number(),
    security: z.number(),
    securityMax: z.number(),
    wall: z.number(),
    wallMax: z.number(),
    defence: z.number(),
    defenceMax: z.number(),
    supplyState: z.number(),
    frontState: z.number(),
    trust: z.number(),
});

export const generalSelect = {
    id: true,
    name: true,
    userId: true,
    nationId: true,
    cityId: true,
    troopId: true,
    npcState: true,
    gold: true,
    rice: true,
    leadership: true,
    strength: true,
    intel: true,
    experience: true,
    dedication: true,
    officerLevel: true,
    injury: true,
    age: true,
    crew: true,
    crewTypeId: true,
    train: true,
    atmos: true,
    personalCode: true,
    specialCode: true,
    special2Code: true,
    horseCode: true,
    weaponCode: true,
    bookCode: true,
    itemCode: true,
    meta: true,
} satisfies GamePrisma.GeneralSelect;
export const citySelect = {
    id: true,
    name: true,
    nationId: true,
    level: true,
    population: true,
    populationMax: true,
    agriculture: true,
    agricultureMax: true,
    commerce: true,
    commerceMax: true,
    security: true,
    securityMax: true,
    wall: true,
    wallMax: true,
    defence: true,
    defenceMax: true,
    supplyState: true,
    frontState: true,
    trust: true,
    meta: true,
} satisfies GamePrisma.CitySelect;
const code = (value: string): string | null => (value === 'None' ? null : value);
export const projectCurrentGeneral = (
    row: GamePrisma.GeneralGetPayload<{ select: typeof generalSelect }>
): z.infer<typeof zAuditGeneralData> => {
    const meta = asRecord(row.meta);
    return zAuditGeneralData.parse({
        ...row,
        stats: { leadership: row.leadership, strength: row.strength, intelligence: row.intel },
        dex: Object.fromEntries(['dex1', 'dex2', 'dex3', 'dex4', 'dex5'].map((key) => [key, asNumber(meta[key], 0)])),
        role: {
            personality: code(row.personalCode),
            specialDomestic: code(row.specialCode),
            specialWar: code(row.special2Code),
            items: {
                horse: code(row.horseCode),
                weapon: code(row.weaponCode),
                book: code(row.bookCode),
                item: code(row.itemCode),
            },
        },
    });
};
export const projectCurrentCity = (
    row: GamePrisma.CityGetPayload<{ select: typeof citySelect }>
): z.infer<typeof zAuditCityData> =>
    zAuditCityData.parse({ ...row, state: Math.floor(asNumber(asRecord(row.meta).state, 0)) });
