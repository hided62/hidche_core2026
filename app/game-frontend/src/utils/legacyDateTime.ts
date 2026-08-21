import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';

export const formatSeoulDateTime = (value: string | Date): string => formatServerDateTime(value);

export const formatSeoulHourMinute = (value: string | Date): string =>
    formatServerDateTime(value, { format: 'hourMinute' });

export const formatSeoulTimeSeconds = (value: string | Date): string =>
    formatServerDateTime(value, { format: 'timeSeconds' });

export const formatLocalTimeSeconds = (value: string | Date): string => {
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(parsed.getTime())) return '-';
    return [parsed.getHours(), parsed.getMinutes(), parsed.getSeconds()]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
};

export const formatLocalDateTime = (value: string | Date): string => {
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(parsed.getTime())) return '-';
    const date = [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()]
        .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
        .join('-');
    return `${date} ${formatLocalTimeSeconds(parsed)}`;
};
