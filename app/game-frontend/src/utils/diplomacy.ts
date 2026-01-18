export type DiplomacyState = 0 | 1 | 2 | 7;

export type DiplomacyInfo = {
    name: string;
    color?: string;
};

export const diplomacyStateInfo: Record<DiplomacyState, DiplomacyInfo> = {
    0: { name: '교전', color: 'red' },
    1: { name: '선포중', color: 'magenta' },
    2: { name: '통상' },
    7: { name: '불가침', color: 'green' },
};

export const resolveDiplomacyInfo = (state: number): DiplomacyInfo => {
    return diplomacyStateInfo[state as DiplomacyState] ?? { name: '알 수 없음' };
};
