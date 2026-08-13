const SERVER_UTC_OFFSET_MINUTES = 9 * 60;
const SERVER_UTC_OFFSET_MS = SERVER_UTC_OFFSET_MINUTES * 60_000;

export type ServerDateTimeFormat =
    | 'dateTimeSeconds'
    | 'dateTimeMinutes'
    | 'date'
    | 'timeSeconds'
    | 'hourMinute'
    | 'minuteSecond'
    | 'monthDayTime'
    | 'monthDayTimeSeconds';

export type ServerDateTimeOptions = {
    format?: ServerDateTimeFormat;
    fallback?: string;
};

type DateTimeParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
};

const SERVER_WALL_TIME_PATTERN = /^(\d{4,6})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/u;

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

const isValidParts = (parts: DateTimeParts): boolean => {
    const candidate = new Date(0);
    candidate.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    candidate.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
    return (
        candidate.getUTCFullYear() === parts.year &&
        candidate.getUTCMonth() + 1 === parts.month &&
        candidate.getUTCDate() === parts.day &&
        candidate.getUTCHours() === parts.hour &&
        candidate.getUTCMinutes() === parts.minute &&
        candidate.getUTCSeconds() === parts.second &&
        candidate.getUTCMilliseconds() === parts.millisecond
    );
};

const parseServerWallTime = (value: string): DateTimeParts | null => {
    const match = SERVER_WALL_TIME_PATTERN.exec(value.trim());
    if (!match) {
        return null;
    }
    const millisecondText = match[7] ?? '';
    const parts: DateTimeParts = {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4] ?? 0),
        minute: Number(match[5] ?? 0),
        second: Number(match[6] ?? 0),
        millisecond: Number(millisecondText.padEnd(3, '0')),
    };
    return isValidParts(parts) ? parts : null;
};

const partsFromInstant = (value: string | Date): DateTimeParts | null => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    const shifted = new Date(date.getTime() + SERVER_UTC_OFFSET_MS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
        millisecond: shifted.getUTCMilliseconds(),
    };
};

const resolveParts = (value: string | Date): DateTimeParts | null => {
    if (typeof value === 'string') {
        const wallTime = parseServerWallTime(value);
        if (wallTime) {
            return wallTime;
        }
    }
    return partsFromInstant(value);
};

const formatParts = (parts: DateTimeParts, format: ServerDateTimeFormat): string => {
    const year = pad(parts.year, 4);
    const month = pad(parts.month);
    const day = pad(parts.day);
    const hour = pad(parts.hour);
    const minute = pad(parts.minute);
    const second = pad(parts.second);

    switch (format) {
        case 'dateTimeMinutes':
            return `${year}-${month}-${day} ${hour}:${minute}`;
        case 'date':
            return `${year}-${month}-${day}`;
        case 'timeSeconds':
            return `${hour}:${minute}:${second}`;
        case 'hourMinute':
            return `${hour}:${minute}`;
        case 'minuteSecond':
            return `${minute}:${second}`;
        case 'monthDayTime':
            return `${month}-${day} ${hour}:${minute}`;
        case 'monthDayTimeSeconds':
            return `${month}-${day} ${hour}:${minute}:${second}`;
        case 'dateTimeSeconds':
        default:
            return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }
};

/**
 * Formats an instant in the service's fixed UTC+9 wall clock.
 *
 * Timezone-less legacy DATETIME strings are already server wall-clock values and
 * therefore keep their components. This deliberate fixed offset also avoids
 * historical IANA timezone rules changing ancient in-game years.
 */
export const formatServerDateTime = (
    value: string | Date | null | undefined,
    options: ServerDateTimeOptions = {}
): string => {
    if (value === null || value === undefined || value === '') {
        return options.fallback ?? '';
    }
    const parts = resolveParts(value);
    if (!parts) {
        return options.fallback ?? String(value);
    }
    return formatParts(parts, options.format ?? 'dateTimeSeconds');
};

export const toServerDateTimeInputValue = (value: string | Date | null | undefined): string => {
    const formatted = formatServerDateTime(value, { format: 'dateTimeMinutes', fallback: '' });
    return formatted ? formatted.replace(' ', 'T') : '';
};

/** Converts an HTML datetime-local value, interpreted as UTC+9 server wall time, to ISO UTC. */
export const serverDateTimeInputToIso = (value: string): string | undefined => {
    const parts = parseServerWallTime(value);
    if (!parts) {
        return undefined;
    }
    const wallTime = new Date(0);
    wallTime.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    wallTime.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
    return new Date(wallTime.getTime() - SERVER_UTC_OFFSET_MS).toISOString();
};
