export interface ServerSeasonStatusInput {
    isUnited: number;
    nationCnt: number;
    opentime: string;
    starttime: string;
    turntime: string;
}

export interface ServerSeasonStatus {
    code: 'COMPETING' | 'PREOPEN' | 'EVENT_RUNNING' | 'UNITED' | 'EVENT_FINISHED';
    label: string;
    period: string;
}

export const resolveServerSeasonStatus = (info: ServerSeasonStatusInput, now = new Date()): ServerSeasonStatus => {
    const finishedPeriod = `${info.starttime}\n~ ${info.turntime}`;
    if (info.isUnited === 3) {
        return { code: 'EVENT_FINISHED', label: '§이벤트 종료§', period: finishedPeriod };
    }
    if (info.isUnited === 1) {
        return { code: 'EVENT_RUNNING', label: '§이벤트 진행중§', period: `${info.starttime} ~` };
    }
    if (info.isUnited === 2) {
        return { code: 'UNITED', label: '§천하통일§', period: finishedPeriod };
    }

    const openAt = new Date(info.opentime);
    if (Number.isFinite(openAt.getTime()) && openAt.getTime() > now.getTime()) {
        return { code: 'PREOPEN', label: '-가오픈 중-', period: `${info.starttime} ~` };
    }
    return { code: 'COMPETING', label: `<${info.nationCnt}국 경쟁중>`, period: `${info.starttime} ~` };
};
