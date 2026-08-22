import type { General } from '@sammo-ts/logic/domain/entities.js';
import {
    allow,
    compareValues,
    readDestGeneral,
    resolveDestGeneralId,
    resolveDestNationId,
    unknownOrDeny,
    type CompareOperator,
} from './helpers.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from './types.js';

const readNumericField = (source: Record<string, unknown>, key: string): number | null => {
    const value = source[key];
    return typeof value === 'number' ? value : null;
};

const readStringField = (source: Record<string, unknown>, key: string): string | null => {
    const value = source[key];
    return typeof value === 'string' ? value : null;
};

const readNationNumeric = (nation: Record<string, unknown>, key: string): number | null => {
    const direct = readNumericField(nation, key);
    if (direct !== null) {
        return direct;
    }
    const meta = nation.meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return null;
    }
    return readNumericField(meta as Record<string, unknown>, key);
};

export const notBeNeutral = (): Constraint => ({
    name: 'notBeNeutral',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general.nationId !== 0) {
            return allow();
        }
        return { kind: 'deny', reason: '재야입니다.' };
    },
});

export const beNeutral = (): Constraint => ({
    name: 'beNeutral',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general.nationId === 0) {
            return allow();
        }
        return { kind: 'deny', reason: '이미 국가에 속해 있습니다.' };
    },
});

export const beChief = (): Constraint => ({
    name: 'beChief',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general.officerLevel > 4) {
            return allow();
        }
        return { kind: 'deny', reason: '수뇌가 아닙니다.' };
    },
});

export const beLord = (): Constraint => ({
    name: 'beLord',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general.officerLevel === 12) {
            return allow();
        }
        return { kind: 'deny', reason: '군주가 아닙니다.' };
    },
});

export const reqGeneralGold = (
    getRequiredGold: (ctx: ConstraintContext, view: StateView) => number,
    requirements: RequirementKey[] = []
): Constraint => ({
    name: 'reqGeneralGold',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }, ...requirements],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        const missing = [generalReq, ...requirements].filter((req) => !view.has(req));
        if (missing.length > 0) {
            return unknownOrDeny(ctx, missing, '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const required = getRequiredGold(ctx, view);
        if (general.gold >= required) {
            return allow();
        }
        return { kind: 'deny', reason: '자금이 모자랍니다.' };
    },
});

export const reqGeneralRice = (
    getRequiredRice: (ctx: ConstraintContext, view: StateView) => number,
    requirements: RequirementKey[] = []
): Constraint => ({
    name: 'reqGeneralRice',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }, ...requirements],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        const missing = [generalReq, ...requirements].filter((req) => !view.has(req));
        if (missing.length > 0) {
            return unknownOrDeny(ctx, missing, '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const required = getRequiredRice(ctx, view);
        if (general.rice >= required) {
            return allow();
        }
        return { kind: 'deny', reason: '군량이 모자랍니다.' };
    },
});

export const reqGeneralCrew = (): Constraint => ({
    name: 'reqGeneralCrew',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        if (general.crew > 0) {
            return allow();
        }
        return { kind: 'deny', reason: '병사가 모자랍니다.' };
    },
});

export const reqGeneralTrainMargin = (maxTrain: number): Constraint => ({
    name: 'reqGeneralTrainMargin',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        if (general.train < maxTrain) {
            return allow();
        }
        return { kind: 'deny', reason: '병사들은 이미 정예병사들입니다.' };
    },
});

export const reqGeneralAtmosMargin = (maxAtmos: number): Constraint => ({
    name: 'reqGeneralAtmosMargin',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        if (general.atmos < maxAtmos) {
            return allow();
        }
        return { kind: 'deny', reason: '이미 사기는 하늘을 찌를듯 합니다.' };
    },
});

export const allowJoinAction = (): Constraint => ({
    name: 'allowJoinAction',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }

        const makelimit = typeof general.meta.makelimit === 'number' ? general.meta.makelimit : 0;
        if (makelimit === 0) {
            return allow();
        }

        const joinActionLimit = typeof ctx.env.joinActionLimit === 'number' ? ctx.env.joinActionLimit : 12;
        return { kind: 'deny', reason: `재야가 된지 ${joinActionLimit}턴이 지나야 합니다.` };
    },
});

export const noPenalty = (penaltyKey: string): Constraint => ({
    name: 'noPenalty',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }

        const penalty = (general as General & { penalty?: unknown }).penalty ?? general.meta.penalty;
        if (!penalty || typeof penalty !== 'object' || Array.isArray(penalty)) {
            return allow();
        }

        const penaltyMap = penalty as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(penaltyMap, penaltyKey)) {
            return allow();
        }

        const reason = penaltyMap[penaltyKey];
        return {
            kind: 'deny',
            reason: `징계 사유: ${typeof reason === 'string' ? reason : String(reason)}`,
        };
    },
});

export const allowRebellion = (): Constraint => ({
    name: 'allowRebellion',
    requires: (ctx) => [
        { kind: 'general', id: ctx.actorId },
        { kind: 'generalList' },
        { kind: 'env', key: 'killturn' },
    ],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        if (general.nationId === 0) {
            return { kind: 'deny', reason: '재야입니다.' };
        }

        const generalListReq: RequirementKey = { kind: 'generalList' };
        if (!view.has(generalListReq)) {
            return unknownOrDeny(ctx, [generalListReq], '장수 정보가 없습니다.');
        }
        const generals = view.get(generalListReq) as General[] | null;
        if (!generals) {
            return unknownOrDeny(ctx, [generalListReq], '장수 정보가 없습니다.');
        }

        const lord = generals.find((entry) => entry.nationId === general.nationId && entry.officerLevel === 12);
        if (!lord) {
            return unknownOrDeny(ctx, [generalListReq], '군주 정보가 없습니다.');
        }
        if (lord.id === general.id) {
            return { kind: 'deny', reason: '이미 군주입니다.' };
        }

        const envReq: RequirementKey = { kind: 'env', key: 'killturn' };
        if (!view.has(envReq)) {
            return unknownOrDeny(ctx, [envReq], '턴 정보가 없습니다.');
        }
        const rawKillturn = view.get(envReq);
        const worldKillturn =
            typeof rawKillturn === 'number' ? rawKillturn : typeof rawKillturn === 'string' ? Number(rawKillturn) : NaN;
        if (!Number.isFinite(worldKillturn)) {
            return unknownOrDeny(ctx, [envReq], '턴 정보가 없습니다.');
        }

        const lordKillturn = typeof lord.meta.killturn === 'number' ? lord.meta.killturn : NaN;
        if (!Number.isFinite(lordKillturn)) {
            return unknownOrDeny(ctx, [generalListReq], '군주 정보가 없습니다.');
        }
        if (lordKillturn >= worldKillturn) {
            return { kind: 'deny', reason: '군주가 활동중입니다.' };
        }

        if ([2, 3, 6, 9].includes(lord.npcState)) {
            return { kind: 'deny', reason: '군주가 NPC입니다.' };
        }

        return allow();
    },
});

export const reqGeneralValue = (
    key: string,
    keyNick: string,
    comp: CompareOperator,
    reqVal: unknown,
    errMsg: string | null = null
): Constraint => ({
    name: 'reqGeneralValue',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const source = general as unknown as Record<string, unknown>;
        let target = source[key];
        if (target === undefined && source.meta && typeof source.meta === 'object' && !Array.isArray(source.meta)) {
            target = (source.meta as Record<string, unknown>)[key];
        }

        if (compareValues(target, comp, reqVal)) {
            return allow();
        }
        if (errMsg) {
            return { kind: 'deny', reason: errMsg };
        }
        return { kind: 'deny', reason: `${keyNick} 조건을 만족하지 않습니다.` };
    },
});

export const allowJoinDestNation = (relYear: number): Constraint => ({
    name: 'allowJoinDestNation',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [
            { kind: 'general', id: ctx.actorId },
            { kind: 'env', key: 'openingPartYear' },
            { kind: 'env', key: 'initialNationGenLimit' },
        ];
        const destNationId = resolveDestNationId(ctx);
        if (destNationId !== undefined) {
            reqs.push({ kind: 'destNation', id: destNationId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }

        const destNationId = resolveDestNationId(ctx);
        if (destNationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const destReq: RequirementKey = { kind: 'destNation', id: destNationId };
        if (!view.has(destReq)) {
            return unknownOrDeny(ctx, [destReq], '국가 정보가 없습니다.');
        }
        const destNation = view.get(destReq) as Record<string, unknown> | null;
        if (!destNation) {
            return unknownOrDeny(ctx, [destReq], '국가 정보가 없습니다.');
        }

        const openingPartYear = view.get({ kind: 'env', key: 'openingPartYear' }) as number | null;
        const initialNationGenLimit = view.get({ kind: 'env', key: 'initialNationGenLimit' }) as number | null;
        const gennum = readNationNumeric(destNation, 'gennum') ?? 0;
        const scout = readNationNumeric(destNation, 'scout') ?? 0;
        const name = readStringField(destNation, 'name') ?? '';

        const openingLimit = typeof openingPartYear === 'number' ? openingPartYear : 0;
        const initialLimit = typeof initialNationGenLimit === 'number' ? initialNationGenLimit : 0;
        if (relYear < openingLimit && initialLimit > 0 && gennum >= initialLimit) {
            return { kind: 'deny', reason: '임관이 제한되고 있습니다.' };
        }

        if (scout === 1) {
            return { kind: 'deny', reason: '임관이 금지되어 있습니다.' };
        }

        if (general.npcState < 2 && name.startsWith('ⓤ')) {
            return { kind: 'deny', reason: '유저장은 태수국에 임관할 수 없습니다.' };
        }

        if (general.npcState !== 9 && name.startsWith('ⓞ')) {
            return { kind: 'deny', reason: '이민족 국가에 임관할 수 없습니다.' };
        }

        return allow();
    },
});

export const reqGeneralCrewMargin = (
    getCrewTypeId: (ctx: ConstraintContext, view: StateView) => number | null,
    requirements: RequirementKey[] = [],
    getMaxCrew?: (ctx: ConstraintContext, view: StateView) => number | null
): Constraint => ({
    name: 'reqGeneralCrewMargin',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }, ...requirements],
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        const missing = [generalReq, ...requirements].filter((req) => !view.has(req));
        if (missing.length > 0) {
            return unknownOrDeny(ctx, missing, '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const crewTypeId = getCrewTypeId(ctx, view);
        if (crewTypeId === null) {
            return unknownOrDeny(ctx, requirements, '병종 정보가 없습니다.');
        }
        if (crewTypeId !== general.crewTypeId) {
            return allow();
        }
        const maxCrew = getMaxCrew ? getMaxCrew(ctx, view) : general.stats.leadership * 100;
        if (maxCrew === null) {
            return unknownOrDeny(ctx, requirements, '장수 정보가 없습니다.');
        }
        if (maxCrew > general.crew) {
            return allow();
        }
        return { kind: 'deny', reason: '이미 많은 병력을 보유하고 있습니다.' };
    },
});

export const existsDestGeneral = (): Constraint => ({
    name: 'existsDestGeneral',
    requires: (ctx) =>
        resolveDestGeneralId(ctx) !== undefined
            ? [
                  {
                      kind: 'destGeneral',
                      id: resolveDestGeneralId(ctx) ?? 0,
                  },
              ]
            : [],
    test: (ctx, view) => {
        const destGeneralId = resolveDestGeneralId(ctx);
        if (destGeneralId === undefined) {
            return unknownOrDeny(ctx, [], '장수 정보가 없습니다.');
        }
        const req: RequirementKey = { kind: 'destGeneral', id: destGeneralId };
        if (!view.has(req)) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        const general = view.get(req) as General | null;
        if (!general) {
            return { kind: 'deny', reason: '장수 정보가 없습니다.' };
        }
        return allow();
    },
});

export const friendlyDestGeneral = (): Constraint => ({
    name: 'friendlyDestGeneral',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [{ kind: 'general', id: ctx.actorId }];
        const destGeneralId = resolveDestGeneralId(ctx);
        if (destGeneralId !== undefined) {
            reqs.push({ kind: 'destGeneral', id: destGeneralId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const generalReq: RequirementKey = { kind: 'general', id: ctx.actorId };
        if (!view.has(generalReq)) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const general = view.get(generalReq) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [generalReq], '장수 정보가 없습니다.');
        }
        const destGeneral = readDestGeneral(ctx, view);
        if (!destGeneral) {
            const destGeneralId = resolveDestGeneralId(ctx);
            if (destGeneralId === undefined) {
                return unknownOrDeny(ctx, [], '장수 정보가 없습니다.');
            }
            const req: RequirementKey = {
                kind: 'destGeneral',
                id: destGeneralId,
            };
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (destGeneral.nationId === general.nationId) {
            return allow();
        }
        return { kind: 'deny', reason: '아국 장수가 아닙니다.' };
    },
});

export const mustBeNPC = (): Constraint => ({
    name: 'mustBeNPC',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        const general = view.get(req) as General | null;
        if (!general) {
            return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');
        }
        if (general.npcState >= 2) {
            return allow();
        }
        return { kind: 'deny', reason: 'NPC여야 합니다.' };
    },
});

export const notLord = (): Constraint => ({
    name: 'notLord',
    requires: (ctx) => [{ kind: 'general', id: ctx.actorId }],
    test: (ctx, view) => {
        const req: RequirementKey = { kind: 'general', id: ctx.actorId };
        const general = view.get(req) as General | null;
        if (!general) return unknownOrDeny(ctx, [req], '장수 정보가 없습니다.');

        if (general.officerLevel !== 12) {
            return allow();
        }
        return { kind: 'deny', reason: '군주는 불가능합니다.' };
    },
});
