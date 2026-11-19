import type { GeneralMeta, NationId } from '../../../domain/entities.js';

// Ref의 aux.joinedNations가 이관된 경우 숫자 문자열로 저장된 ID도 읽는다.
export const readJoinedNationIds = (meta: GeneralMeta): Set<NationId> => {
    const ids = new Set<NationId>();
    if (!Array.isArray(meta.joinedNations)) return ids;

    for (const value of meta.joinedNations) {
        const id = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
        if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
            ids.add(id);
        }
    }
    return ids;
};

export const appendJoinedNationIds = (meta: GeneralMeta, ...nationIds: NationId[]): NationId[] => {
    const ids = readJoinedNationIds(meta);
    for (const id of nationIds) {
        if (id > 0) ids.add(id);
    }
    return [...ids];
};
