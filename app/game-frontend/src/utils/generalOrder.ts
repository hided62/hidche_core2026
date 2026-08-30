export type GeneralOrderIdentity = {
    id: number;
    name: string;
    npcState: number;
};

const koreanNameCollator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });

/**
 * Ref의 npc 값은 0 유저장, 1 빙의장, 2 N장, 3 M장, 4 의병장,
 * 5 부대장 순으로 장수 종류 자체의 표시 우선순위를 표현한다.
 */
export const compareGeneralTypeThenName = <T extends GeneralOrderIdentity>(left: T, right: T): number =>
    left.npcState - right.npcState || koreanNameCollator.compare(left.name, right.name) || left.id - right.id;

export const sortGeneralsByTypeThenName = <T extends GeneralOrderIdentity>(generals: readonly T[]): T[] =>
    [...generals].sort(compareGeneralTypeThenName);
