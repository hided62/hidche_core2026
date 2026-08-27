export interface AutorunUserSummary {
    limitMinutes: number;
    options: string[];
}

export const formatAutorunUserDetail = (autorun: AutorunUserSummary): string => {
    const enabled = new Set(autorun.options);
    const labels: string[] = [];
    if (enabled.has('develop')) labels.push('내정');
    if (enabled.has('warp')) labels.push('순간이동');
    if (enabled.has('recruit_high')) labels.push('모병');
    else if (enabled.has('recruit')) labels.push('징병');
    if (enabled.has('train')) labels.push('훈련/사기진작');
    if (enabled.has('battle')) labels.push('출병');
    if (enabled.has('chief')) labels.push('사령턴');

    const limit =
        autorun.limitMinutes >= 43_200
            ? '항상 유효'
            : autorun.limitMinutes % 60 === 0
              ? `${autorun.limitMinutes / 60}시간 유효`
              : `${autorun.limitMinutes}분 유효`;
    labels.push(limit);
    return labels.join(', ');
};
