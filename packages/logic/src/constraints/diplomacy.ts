import {
    allow,
    readDestCity,
    readDiplomacyState,
    readGeneral,
    resolveDestCityId,
    resolveDestNationId,
    unknownOrDeny,
} from './helpers.js';
import type { Constraint, RequirementKey } from './types.js';

export const disallowDiplomacyBetweenStatus = (
    disallowList: Record<number, string>
): Constraint => ({
    name: 'DisallowDiplomacyBetweenStatus',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [];
        if (ctx.nationId !== undefined) {
            reqs.push({ kind: 'nation', id: ctx.nationId });
        }
        const destNationId = resolveDestNationId(ctx);
        if (destNationId !== undefined) {
            reqs.push({ kind: 'destNation', id: destNationId });
            if (ctx.nationId !== undefined) {
                reqs.push({
                    kind: 'diplomacy',
                    srcNationId: ctx.nationId,
                    destNationId,
                });
            }
        }
        const destCityId = resolveDestCityId(ctx);
        if (destCityId !== undefined) {
            reqs.push({ kind: 'destCity', id: destCityId });
        }
        return reqs;
    },
    test: (ctx, view) => {
        const general = readGeneral(ctx, view);
        const baseNationId = ctx.nationId ?? general?.nationId;
        if (baseNationId === undefined) {
            return unknownOrDeny(ctx, [], '국가 정보가 없습니다.');
        }
        const destCity = readDestCity(ctx, view);
        const destNationId =
            resolveDestNationId(ctx) ?? destCity?.nationId;
        if (destNationId === undefined) {
            return unknownOrDeny(ctx, [], '상대 국가 정보가 없습니다.');
        }
        const state = readDiplomacyState(view, baseNationId, destNationId);
        if (state === null) {
            const req: RequirementKey = {
                kind: 'diplomacy',
                srcNationId: baseNationId,
                destNationId,
            };
            return unknownOrDeny(ctx, [req], '외교 정보가 없습니다.');
        }
        const reason = disallowList[state];
        if (reason !== undefined) {
            return { kind: 'deny', reason };
        }
        return allow();
    },
});
