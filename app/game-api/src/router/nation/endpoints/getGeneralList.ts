import { TRPCError } from '@trpc/server';
import { asNumber, asRecord, type RankDataType } from '@sammo-ts/common';
import { LEGACY_DEFAULT_MAX_LEVEL } from '@sammo-ts/logic';

import { accessAuthedProcedure } from '../../../trpc.js';
import {
    loadCrewTypeDisplayNames,
    resolveDedicationLevelName,
    sanitizeInternalDisplayCode,
} from '../../../services/gameDisplayNames.js';
import { getMyGeneral } from '../../shared/general.js';
import {
    assertNationAccess,
    loadTraitNames,
    mapGeneralList,
    resolveChiefStatMin,
    resolveNationPermission,
} from '../shared.js';

const experienceLevel = (experience: number, maxLevel: number): number =>
    Math.max(
        0,
        Math.min(maxLevel, experience < 1000 ? Math.floor(experience / 100) : Math.floor(Math.sqrt(experience / 10)))
    );
const dedicationLevel = (dedication: number, maxLevel: number): number =>
    Math.max(0, Math.min(maxLevel, Math.ceil(Math.sqrt(dedication) / 10)));
const BATTLE_RECORD_TYPES = ['warnum', 'killnum', 'killcrew', 'deathcrew'] as const satisfies readonly RankDataType[];
const defenceTrainText = (value: number): string =>
    value >= 999 ? '×' : value >= 90 ? '☆' : value >= 80 ? '◎' : value >= 60 ? '○' : '△';
const honorText = (experience: number): string => {
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

export const getGeneralList = accessAuthedProcedure.query(async ({ ctx }) => {
    const general = await getMyGeneral(ctx);
    assertNationAccess(general);

    const [nation, cityRows, troopRows, generalRows, worldState] = await Promise.all([
        ctx.db.nation.findUnique({
            where: { id: general.nationId },
            select: {
                id: true,
                name: true,
                color: true,
                level: true,
                typeCode: true,
                capitalCityId: true,
                meta: true,
            },
        }),
        ctx.db.city.findMany({ select: { id: true, name: true } }),
        ctx.db.troop.findMany({ select: { troopLeaderId: true, name: true } }),
        ctx.db.general.findMany({
            where: { nationId: general.nationId },
            select: {
                id: true,
                name: true,
                npcState: true,
                nationId: true,
                cityId: true,
                troopId: true,
                picture: true,
                imageServer: true,
                officerLevel: true,
                leadership: true,
                strength: true,
                intel: true,
                experience: true,
                dedication: true,
                injury: true,
                gold: true,
                rice: true,
                crew: true,
                crewTypeId: true,
                train: true,
                atmos: true,
                turnTime: true,
                recentWarTime: true,
                age: true,
                personalCode: true,
                specialCode: true,
                special2Code: true,
                meta: true,
                penalty: true,
            },
            orderBy: { id: 'asc' },
        }),
        ctx.db.worldState.findFirst(),
    ]);

    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }

    const cityNameMap = new Map(cityRows.map((city) => [city.id, city.name]));
    const troopNameMap = new Map(troopRows.map((troop) => [troop.troopLeaderId, troop.name]));
    const list = await mapGeneralList(generalRows, cityNameMap, troopNameMap);
    const accessRows = generalRows.length
        ? await ctx.db.generalAccessLog.findMany({
              where: { generalId: { in: generalRows.map((entry) => entry.id) } },
              select: { generalId: true, refreshScoreTotal: true },
          })
        : [];
    const accessByGeneral = new Map(accessRows.map((entry) => [entry.generalId, entry.refreshScoreTotal]));
    const sourceByGeneral = new Map(generalRows.map((entry) => [entry.id, entry]));
    const nationTrait = (await loadTraitNames([nation.typeCode], 'nation')).get(nation.typeCode);
    const permission = resolveNationPermission(general, nation.meta, true);
    const generalIds = generalRows.map((entry) => entry.id);
    const [crewTypeNames, turns, rankRows] =
        permission >= 1
            ? await Promise.all([
                  loadCrewTypeDisplayNames(worldState, ctx.profile.id),
                  generalIds.length
                      ? ctx.db.generalTurn.findMany({
                            where: { generalId: { in: generalIds }, turnIdx: { lt: 5 } },
                            select: { generalId: true, turnIdx: true, actionCode: true, arg: true },
                            orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
                        })
                      : [],
                  generalIds.length
                      ? ctx.db.rankData.findMany({
                            where: { generalId: { in: generalIds }, type: { in: [...BATTLE_RECORD_TYPES] } },
                            select: { generalId: true, type: true, value: true },
                        })
                      : [],
              ])
            : [new Map<number, string>(), [], []];
    const turnsByGeneral = new Map<number, Array<{ action: string; args: unknown }>>();
    for (const turn of turns) {
        const entries = turnsByGeneral.get(turn.generalId) ?? [];
        entries[turn.turnIdx] = { action: turn.actionCode, args: turn.arg };
        turnsByGeneral.set(turn.generalId, entries);
    }
    const ranksByGeneral = new Map<number, Map<RankDataType, number>>();
    for (const row of rankRows) {
        const entries = ranksByGeneral.get(row.generalId) ?? new Map<RankDataType, number>();
        entries.set(row.type as RankDataType, row.value);
        ranksByGeneral.set(row.generalId, entries);
    }
    const config = asRecord(worldState?.config);
    const constValues = asRecord(config.const);
    const maxExperienceLevel = Math.max(0, Math.trunc(asNumber(constValues.maxLevel, LEGACY_DEFAULT_MAX_LEVEL)));
    const maxDedicationLevel = Math.max(0, Math.trunc(asNumber(constValues.maxDedLevel, 30)));
    const visibleList = list.map((entry) => {
        const source = sourceByGeneral.get(entry.id);
        const meta = asRecord(source?.meta);
        const ownerNameRaw = meta.ownerName ?? meta.owner_name;
        const entryDedicationLevel = dedicationLevel(entry.dedication, maxDedicationLevel);
        const dedicationDisplay = {
            dedicationLevel: entryDedicationLevel,
            dedicationText: resolveDedicationLevelName(entryDedicationLevel, maxDedicationLevel),
            bill: entryDedicationLevel * 200 + 400,
        };
        const { permission: _targetPermission, ...mappedEntry } = entry;
        const safeEntry = {
            ...mappedEntry,
            ownerName: entry.npcState === 1 && typeof ownerNameRaw === 'string' ? ownerNameRaw : null,
            age: source?.age ?? 0,
            killTurn: asNumber(meta.killturn ?? meta.killTurn, 0),
        };
        if (permission >= 1) {
            const defenceTrain = asNumber(meta.defence_train ?? meta.defenceTrain, 80);
            const rankValue = (type: (typeof BATTLE_RECORD_TYPES)[number]): number =>
                ranksByGeneral.get(entry.id)?.get(type) ?? asNumber(meta[`rank_${type}`] ?? meta[type], 0);
            return {
                ...safeEntry,
                refreshScoreTotal: accessByGeneral.get(entry.id) ?? 0,
                experienceLevel: experienceLevel(entry.experience, maxExperienceLevel),
                honorText: honorText(entry.experience),
                ...dedicationDisplay,
                crewTypeId: source?.crewTypeId ?? 0,
                crewTypeName: crewTypeNames.get(source?.crewTypeId ?? 0) ?? '-',
                train: source?.train ?? 0,
                atmos: source?.atmos ?? 0,
                turnTime: source?.turnTime.toISOString() ?? null,
                recentWar: source?.recentWarTime?.toISOString() ?? null,
                defenceTrain,
                defenceTrainText: defenceTrainText(defenceTrain),
                reservedCommands: entry.npcState < 2 ? (turnsByGeneral.get(entry.id) ?? []) : [],
                battleStats: {
                    battles: rankValue('warnum'),
                    wins: rankValue('killnum'),
                    killCrew: rankValue('killcrew'),
                    deathCrew: rankValue('deathcrew'),
                },
            };
        }
        const { crew: _crew, experience: _experience, dedication: _dedication, ...visible } = safeEntry;
        return {
            ...visible,
            refreshScoreTotal: accessByGeneral.get(entry.id) ?? 0,
            officerLevel: entry.officerLevel >= 5 ? entry.officerLevel : Math.min(1, entry.officerLevel),
            cityName: null,
            troopName: null,
            officerCity: 0,
            officerCityName: null,
            experienceLevel: experienceLevel(entry.experience, maxExperienceLevel),
            honorText: honorText(entry.experience),
            ...dedicationDisplay,
        };
    });

    return {
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            typeCode: nation.typeCode,
            type: {
                key: nation.typeCode,
                name: nationTrait?.name ?? sanitizeInternalDisplayCode(nation.typeCode),
                info: nationTrait?.info ?? '',
            },
            capitalCityId: nation.capitalCityId ?? 0,
        },
        chiefStatMin: resolveChiefStatMin(worldState),
        viewer: { generalId: general.id, permission },
        generals: visibleList,
    };
});
