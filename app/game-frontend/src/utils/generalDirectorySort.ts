export type GeneralDirectorySortKey = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
export type GeneralDirectorySortDirection = 'ascending' | 'descending';

export type GeneralDirectorySortCriterion = {
    key: GeneralDirectorySortKey;
    direction: GeneralDirectorySortDirection;
};

type TraitValue = { key: string };

export type GeneralDirectorySortable = {
    name: string;
    nationId: number;
    leadership: number;
    strength: number;
    intelligence: number;
    experience: number;
    dedication: number;
    officerLevel: number;
    killturn: number;
    refreshScoreTotal: number;
    personality: TraitValue;
    specialDomestic: TraitValue;
    specialWar: TraitValue;
    age: number;
    npcState: number;
};

const koreanNameCollator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });

const compareString = (left: string, right: string): number => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
};

const compareByKey = <T extends GeneralDirectorySortable>(left: T, right: T, key: GeneralDirectorySortKey): number => {
    switch (key) {
        case 0:
            return koreanNameCollator.compare(left.name, right.name);
        case 1:
            return left.nationId - right.nationId;
        case 2:
            return left.leadership - right.leadership;
        case 3:
            return left.strength - right.strength;
        case 4:
            return left.intelligence - right.intelligence;
        case 5:
        case 10:
            return left.experience - right.experience;
        case 6:
            return left.dedication - right.dedication;
        case 7:
            return left.officerLevel - right.officerLevel;
        case 8:
            return left.killturn - right.killturn;
        case 9:
            return left.refreshScoreTotal - right.refreshScoreTotal;
        case 11:
            return compareString(left.personality.key, right.personality.key);
        case 12:
            return compareString(left.specialDomestic.key, right.specialDomestic.key);
        case 13:
            return compareString(left.specialWar.key, right.specialWar.key);
        case 14:
            return left.age - right.age;
        case 15:
            return left.npcState - right.npcState;
    }
};

export const advanceGeneralDirectorySort = (
    current: readonly GeneralDirectorySortCriterion[],
    key: GeneralDirectorySortKey
): GeneralDirectorySortCriterion[] => {
    const existing = current.find((criterion) => criterion.key === key);
    const remaining = current.filter((criterion) => criterion.key !== key);

    if (!existing) return [{ key, direction: 'descending' }, ...remaining];
    if (existing.direction === 'descending') return [{ key, direction: 'ascending' }, ...remaining];
    return remaining;
};

export const sortGeneralDirectory = <T extends GeneralDirectorySortable>(
    source: readonly T[],
    criteria: readonly GeneralDirectorySortCriterion[]
): T[] => {
    if (criteria.length === 0) return [...source];

    return source
        .map((general, originalIndex) => ({ general, originalIndex }))
        .sort((left, right) => {
            for (const criterion of criteria) {
                const compared = compareByKey(left.general, right.general, criterion.key);
                if (compared !== 0) return criterion.direction === 'ascending' ? compared : -compared;
            }
            return left.originalIndex - right.originalIndex;
        })
        .map(({ general }) => general);
};
