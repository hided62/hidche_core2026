import { asRecord } from '@sammo-ts/common';
import { z } from 'zod';

import { accessAuthedInputProcedure, authedProcedure } from '../../trpc.js';
import { sanitizeInternalDisplayCode } from '../../services/gameDisplayNames.js';
import { loadTraitNames } from '../nation/shared.js';
import { getMyGeneral } from '../shared/general.js';
import { resolveSecretPermission } from '../shared/secretPermission.js';

const zDirectorySort = z.number().int().min(1).max(15).default(9);

const readNumber = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const readMetaNumber = (value: unknown, key: string, fallback = 0): number =>
    readNumber(asRecord(value)[key], fallback);

const readMetaString = (value: unknown, ...keys: string[]): string | null => {
    const record = asRecord(value);
    for (const key of keys) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.length > 0) {
            return candidate;
        }
    }
    return null;
};

const compareString = (left: string, right: string): number => {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
};

const resolveExperienceLevel = (experience: number, maxLevel: number): number => {
    const level = experience < 1_000 ? Math.trunc(experience / 100) : Math.trunc(Math.sqrt(experience / 10));
    return Math.max(0, Math.min(level, maxLevel));
};

const resolveHonorText = (experience: number): string => {
    if (experience < 640) return '전무';
    if (experience < 2_560) return '무명';
    if (experience < 5_760) return '신동';
    if (experience < 10_240) return '약간';
    if (experience < 16_000) return '평범';
    if (experience < 23_040) return '지역적';
    if (experience < 31_360) return '전국적';
    if (experience < 40_960) return '세계적';
    if (experience < 45_000) return '유명';
    if (experience < 51_840) return '명사';
    if (experience < 55_000) return '호걸';
    if (experience < 64_000) return '효웅';
    if (experience < 77_440) return '영웅';
    return '구세주';
};

const resolveDedicationText = (dedication: number, maxLevel: number): string => {
    const level = Math.max(0, Math.min(Math.ceil(Math.sqrt(dedication) / 10), maxLevel));
    return level === 0 ? '무품관' : `${maxLevel - level + 1}품관`;
};

const resolveRefreshText = (score: number): string => {
    if (score < 50) return '안함';
    if (score < 100) return '무관심';
    if (score < 200) return '가끔';
    if (score < 400) return '보통';
    if (score < 800) return '자주';
    if (score < 1_600) return '열심';
    if (score < 3_200) return '중독';
    if (score < 6_400) return '폐인';
    if (score < 12_800) return '경고';
    return '헐...';
};

export const getNationDirectory = authedProcedure.query(async ({ ctx }) => {
    await getMyGeneral(ctx);

    const [nations, generals, cities] = await Promise.all([
        ctx.db.nation.findMany({
            select: {
                id: true,
                name: true,
                color: true,
                capitalCityId: true,
                level: true,
                typeCode: true,
                meta: true,
            },
        }),
        ctx.db.general.findMany({
            select: {
                id: true,
                name: true,
                npcState: true,
                nationId: true,
                cityId: true,
                dedication: true,
                officerLevel: true,
                meta: true,
                penalty: true,
            },
            orderBy: [{ dedication: 'desc' }, { id: 'asc' }],
        }),
        ctx.db.city.findMany({
            select: { id: true, name: true, nationId: true },
            orderBy: { id: 'asc' },
        }),
    ]);

    const directoryNations = nations.some((nation) => nation.id === 0)
        ? nations
        : [
              ...nations,
              {
                  id: 0,
                  name: '재 야',
                  color: '#000000',
                  capitalCityId: null,
                  level: 0,
                  typeCode: 'None',
                  meta: {},
              },
          ];
    const nationTypeNames = await loadTraitNames(
        directoryNations.map((nation) => nation.typeCode),
        'nation'
    );
    const generalsByNation = new Map<number, typeof generals>();
    for (const general of generals) {
        const list = generalsByNation.get(general.nationId) ?? [];
        list.push(general);
        generalsByNation.set(general.nationId, list);
    }
    const citiesByNation = new Map<number, typeof cities>();
    for (const city of cities) {
        const list = citiesByNation.get(city.nationId) ?? [];
        list.push(city);
        citiesByNation.set(city.nationId, list);
    }

    return directoryNations
        .map((nation) => {
            const nationGenerals = generalsByNation.get(nation.id) ?? [];
            const nationCities = citiesByNation.get(nation.id) ?? [];
            const officers = Array.from({ length: 8 }, (_, index) => 12 - index).map((officerLevel) => {
                const general = nationGenerals.filter((candidate) => candidate.officerLevel === officerLevel).at(-1);
                return {
                    officerLevel,
                    general: general
                        ? { id: general.id, name: general.name, npcState: general.npcState, cityId: general.cityId }
                        : null,
                };
            });
            const secretPermissions = nationGenerals.map((general) => ({
                general,
                permission: resolveSecretPermission(
                    {
                        nationId: general.nationId,
                        officerLevel: general.officerLevel,
                        meta: general.meta,
                        penalty: general.penalty,
                    },
                    nation.meta,
                    false
                ),
            }));

            return {
                id: nation.id,
                name: nation.id === 0 ? '재 야' : nation.name,
                color: nation.color,
                level: nation.level,
                type: {
                    key: nation.typeCode,
                    name: nationTypeNames.get(nation.typeCode)?.name ?? sanitizeInternalDisplayCode(nation.typeCode),
                },
                power: readMetaNumber(nation.meta, 'power'),
                capitalCityId: nation.capitalCityId ?? 0,
                generalCount: readMetaNumber(nation.meta, 'gennum', nationGenerals.length),
                cityCount: nationCities.length,
                officers,
                ambassadorNames: secretPermissions
                    .filter(({ permission }) => permission === 4)
                    .map(({ general }) => general.name),
                auditorCount: secretPermissions.filter(({ permission }) => permission === 3).length,
                cities: nationCities.map((city) => ({
                    id: city.id,
                    name: city.name,
                    capital: city.id === nation.capitalCityId,
                })),
                generals: nationGenerals.map((general) => ({
                    id: general.id,
                    name: general.name,
                    npcState: general.npcState,
                })),
            };
        })
        .sort((left, right) => {
            if (left.id === 0) return 1;
            if (right.id === 0) return -1;
            return right.power - left.power || left.id - right.id;
        });
});

export const getGeneralDirectory = accessAuthedInputProcedure(z.object({ sort: zDirectorySort }).optional()).query(
    async ({ ctx, input }) => {
        await getMyGeneral(ctx);
        const sort = input?.sort ?? 9;
        const [generals, nations, accessLogs, worldState] = await Promise.all([
            ctx.db.general.findMany({
                select: {
                    id: true,
                    name: true,
                    picture: true,
                    imageServer: true,
                    npcState: true,
                    age: true,
                    nationId: true,
                    personalCode: true,
                    specialCode: true,
                    special2Code: true,
                    injury: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    experience: true,
                    dedication: true,
                    officerLevel: true,
                    meta: true,
                },
            }),
            ctx.db.nation.findMany({
                select: { id: true, name: true, level: true },
            }),
            ctx.db.generalAccessLog.findMany({
                select: { generalId: true, refreshScoreTotal: true },
            }),
            ctx.db.worldState.findFirst({
                select: { config: true, meta: true },
            }),
        ]);

        const personalityKeys = generals.map((general) => general.personalCode);
        const domesticKeys = generals.map((general) => general.specialCode);
        const warKeys = generals.map((general) => general.special2Code);
        const [personalities, domesticTraits, warTraits] = await Promise.all([
            loadTraitNames(personalityKeys, 'personality'),
            loadTraitNames(domesticKeys, 'domestic'),
            loadTraitNames(warKeys, 'war'),
        ]);
        const nationMap = new Map(nations.map((nation) => [nation.id, nation]));
        const accessMap = new Map(accessLogs.map((row) => [row.generalId, row.refreshScoreTotal]));
        const config = asRecord(worldState?.config);
        const constValues = asRecord(config.const);
        const maxLevel = readNumber(constValues.maxLevel, 255);
        const maxDedLevel = readNumber(constValues.maxDedLevel, 30);
        const worldMeta = asRecord(worldState?.meta);
        const isUnited = readNumber(worldMeta.isUnited ?? worldMeta.isunited) > 0;

        const rows = generals.map((general) => {
            const nation = nationMap.get(general.nationId);
            const refreshScoreTotal = Math.round((accessMap.get(general.id) ?? 0) / 10) * 10;
            const leadershipBonus =
                general.officerLevel === 12
                    ? (nation?.level ?? 0) * 2
                    : general.officerLevel >= 5
                      ? (nation?.level ?? 0)
                      : 0;
            const ownerName = isUnited ? readMetaString(general.meta, 'ownerName', 'owner_name') : null;
            const killturn = readMetaNumber(general.meta, 'killturn');

            return {
                id: general.id,
                name: general.name,
                ownerName,
                picture: general.picture,
                imageServer: general.imageServer,
                npcState: general.npcState,
                age: general.age,
                nationId: general.nationId,
                nationName: nation?.name ?? '-',
                nationLevel: nation?.level ?? 0,
                personality: {
                    key: general.personalCode,
                    name: personalities.get(general.personalCode)?.name ?? '-',
                    info: personalities.get(general.personalCode)?.info ?? '',
                },
                specialDomestic: {
                    key: general.specialCode,
                    name: domesticTraits.get(general.specialCode)?.name ?? '-',
                    info: domesticTraits.get(general.specialCode)?.info ?? '',
                },
                specialWar: {
                    key: general.special2Code,
                    name: warTraits.get(general.special2Code)?.name ?? '-',
                    info: warTraits.get(general.special2Code)?.info ?? '',
                },
                injury: general.injury,
                leadership: general.leadership,
                leadershipBonus,
                strength: general.strength,
                intelligence: general.intel,
                experience: general.experience,
                experienceLevel: resolveExperienceLevel(general.experience, maxLevel),
                honorText: resolveHonorText(general.experience),
                dedication: general.dedication,
                dedicationText: resolveDedicationText(general.dedication, maxDedLevel),
                officerLevel: general.officerLevel,
                killturn,
                refreshScoreTotal,
                refreshText: resolveRefreshText(refreshScoreTotal),
            };
        });

        rows.sort((left, right) => {
            let result = 0;
            switch (sort) {
                case 1:
                    result = left.nationId - right.nationId;
                    break;
                case 2:
                    result = right.leadership - left.leadership;
                    break;
                case 3:
                    result = right.strength - left.strength;
                    break;
                case 4:
                    result = right.intelligence - left.intelligence;
                    break;
                case 5:
                case 10:
                    result = right.experience - left.experience;
                    break;
                case 6:
                    result = right.dedication - left.dedication;
                    break;
                case 7:
                    result = right.officerLevel - left.officerLevel;
                    break;
                case 8:
                    result = left.killturn - right.killturn;
                    break;
                case 9:
                    result = right.refreshScoreTotal - left.refreshScoreTotal;
                    break;
                case 11:
                    result = -compareString(left.personality.key, right.personality.key);
                    break;
                case 12:
                    result = -compareString(left.specialDomestic.key, right.specialDomestic.key);
                    break;
                case 13:
                    result = -compareString(left.specialWar.key, right.specialWar.key);
                    break;
                case 14:
                    result = right.age - left.age;
                    break;
                case 15:
                    result = right.npcState - left.npcState;
                    break;
            }
            return result || left.id - right.id;
        });

        return { sort, generals: rows };
    }
);
