import { asRecord } from '../util/parse.js';

export type OfficeRequest = {
    id: string;
    generalId: number;
    userId: string;
    nationId: number;
    cityId: number;
    officerLevel: 2 | 3 | 4;
    incumbentId: number;
    quarter: number;
    createdTick: number;
    dueTick: number;
    defaultDecision: 'approve' | 'reject';
    defaultReason: 'vacant' | 'npc' | 'absent' | 'secret';
    status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
    resultReason?: string;
};
export type CityOfficeLevel = OfficeRequest['officerLevel'];
export const OFFICE_REQUEST_KEY = 'cityOfficeRequest';
export const readOfficeRequest = (meta: unknown): OfficeRequest | null => {
    const value = asRecord(asRecord(meta)[OFFICE_REQUEST_KEY]);
    const {
        id,
        generalId,
        userId,
        nationId,
        cityId,
        officerLevel,
        incumbentId,
        quarter,
        createdTick,
        dueTick,
        defaultDecision,
        defaultReason,
        status,
        resultReason,
    } = value;
    if (typeof id !== 'string' || typeof userId !== 'string') return null;
    if (
        typeof generalId !== 'number' ||
        !Number.isSafeInteger(generalId) ||
        typeof nationId !== 'number' ||
        !Number.isSafeInteger(nationId) ||
        typeof cityId !== 'number' ||
        !Number.isSafeInteger(cityId)
    )
        return null;
    if (
        typeof incumbentId !== 'number' ||
        !Number.isSafeInteger(incumbentId) ||
        typeof quarter !== 'number' ||
        !Number.isSafeInteger(quarter)
    )
        return null;
    if (
        typeof createdTick !== 'number' ||
        !Number.isSafeInteger(createdTick) ||
        typeof dueTick !== 'number' ||
        !Number.isSafeInteger(dueTick)
    )
        return null;
    if (officerLevel !== 2 && officerLevel !== 3 && officerLevel !== 4) return null;
    if (defaultDecision !== 'approve' && defaultDecision !== 'reject') return null;
    if (
        defaultReason !== 'vacant' &&
        defaultReason !== 'npc' &&
        defaultReason !== 'absent' &&
        defaultReason !== 'secret'
    )
        return null;
    if (
        status !== 'pending' &&
        status !== 'approved' &&
        status !== 'rejected' &&
        status !== 'withdrawn' &&
        status !== 'cancelled'
    )
        return null;
    return {
        id,
        generalId,
        userId,
        nationId,
        cityId,
        officerLevel,
        incumbentId,
        quarter,
        createdTick,
        dueTick,
        defaultDecision,
        defaultReason,
        status,
        ...(typeof resultReason === 'string' ? { resultReason } : {}),
    };
};
export const officeRequestQuarter = (year: number, month: number): number => year * 4 + Math.floor((month - 1) / 3);

// 재정렬은 대기 중인 마감만 이동한다. 접수 시각과 완료된 요청은 과거 사실로 보존한다.
export const shiftOfficeRequestDeadline = <T extends Record<string, unknown>>(
    meta: T,
    deltaTicks: number,
    cutTick = Number.NEGATIVE_INFINITY
): T => {
    const request = readOfficeRequest(meta);
    if (!request || request.status !== 'pending' || request.dueTick < cutTick || deltaTicks === 0) return meta;
    const dueTick = request.dueTick + deltaTicks;
    if (!Number.isSafeInteger(dueTick))
        throw new Error('City office request deadline exceeds the safe game tick range.');
    return { ...meta, [OFFICE_REQUEST_KEY]: { ...request, dueTick } };
};
