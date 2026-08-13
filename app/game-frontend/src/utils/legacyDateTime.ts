const KOREA_TIME_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, '0');

export const formatSeoulDateTime = (value: string | Date): string => {
    if (
        typeof value === 'string' &&
        !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())
    ) {
        return value.trim().replace('T', ' ').slice(0, 19);
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value.slice(0, 19) : '';
    }
    const koreaTime = new Date(date.getTime() + KOREA_TIME_OFFSET_MS);
    return `${koreaTime.getUTCFullYear()}-${pad(koreaTime.getUTCMonth() + 1)}-${pad(
        koreaTime.getUTCDate()
    )} ${pad(koreaTime.getUTCHours())}:${pad(koreaTime.getUTCMinutes())}:${pad(
        koreaTime.getUTCSeconds()
    )}`;
};

export const formatSeoulHourMinute = (value: string | Date): string => formatSeoulDateTime(value).slice(11, 16);
