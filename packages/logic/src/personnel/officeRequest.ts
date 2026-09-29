import { asRecord, type CityOfficeLevel, type OfficeRequest } from '@sammo-ts/common';

export interface OfficeCandidate {
    id: number;
    nationId: number;
    cityId: number;
    officerLevel: number;
    npcState: number;
    userId?: string | null;
    strength: number;
    intelligence: number;
    meta: unknown;
    penalty?: unknown;
}
export interface OfficeRequestEligibility {
    allowed: boolean;
    reason: string | null;
    defaultDecision: OfficeRequest['defaultDecision'];
    defaultReason: OfficeRequest['defaultReason'];
}

const numberOr = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
};

// 자원 UI와 실행 시점 검사는 같은 규칙을 사용한다. 수동 임명 계약은 바꾸지 않는다.
export const resolveOfficeRequestEligibility = (input: {
    applicant: OfficeCandidate;
    city: { id: number; nationId: number; meta: unknown } | null;
    level: CityOfficeLevel;
    incumbent: OfficeCandidate | null;
    nationMeta: unknown;
    chiefStatMin: number;
}): OfficeRequestEligibility => {
    const { applicant, city, level, incumbent } = input;
    const secret =
        numberOr(asRecord(applicant.meta).belong, 0) <
        numberOr(asRecord(input.nationMeta).secretlimit ?? asRecord(input.nationMeta).secretLimit, 3);
    const replaceNpc = incumbent !== null && !incumbent.userId && [2, 3].includes(incumbent.npcState);
    const defaultReason = secret ? 'secret' : !incumbent ? 'vacant' : replaceNpc ? 'npc' : 'absent';
    const defaultDecision = defaultReason === 'vacant' || defaultReason === 'npc' ? 'approve' : 'reject';
    let reason: string | null = null;
    if (!city || !applicant.nationId || city.nationId !== applicant.nationId || city.id !== applicant.cityId)
        reason = '체류 중인 아국 도시에서만 자원할 수 있습니다.';
    else if (applicant.officerLevel < 1 || applicant.officerLevel >= 5 || applicant.npcState >= 2)
        reason = '일반·도시 관직 장수만 자원할 수 있습니다.';
    else if (asRecord(applicant.penalty).noChief) reason = '관직을 맡을 수 없는 상태입니다.';
    else if ((Number(asRecord(city.meta).officer_set ?? 0) & (1 << level)) !== 0) reason = '이번 분기 임명 완료';
    else if (level === 4 && applicant.strength < input.chiefStatMin) reason = '무력 부족';
    else if (level === 3 && applicant.intelligence < input.chiefStatMin) reason = '지력 부족';
    else if (incumbent?.id === applicant.id) reason = '현재 재직 중';
    else if (incumbent && !replaceNpc && incumbent.cityId === city.id) reason = '재직자가 도시에 체류 중';
    return { allowed: reason === null, reason, defaultDecision, defaultReason };
};
