import { describe, expect, it } from 'vitest';

import {
    formatServerDateTime,
    serverDateTimeInputToIso,
    toServerDateTimeInputValue,
} from '../src/time/ServerDateTime.js';

describe('formatServerDateTime', () => {
    it('formats ISO instants with the fixed UTC+9 service offset', () => {
        expect(formatServerDateTime('2026-08-13T00:05:06.000Z')).toBe('2026-08-13 09:05:06');
        expect(formatServerDateTime('0185-01-02T00:04:05.000Z')).toBe('0185-01-02 09:04:05');
        expect(formatServerDateTime('2026-08-13T18:05:06.000Z', { format: 'date' })).toBe('2026-08-14');
        expect(formatServerDateTime('2026-08-13T18:05:06.000Z', { format: 'hourMinute' })).toBe('03:05');
    });

    it('preserves timezone-less legacy wall-clock values', () => {
        expect(formatServerDateTime('0185-01-02 03:04:05')).toBe('0185-01-02 03:04:05');
        expect(formatServerDateTime('0185-01-02T03:04:05', { format: 'monthDayTime' })).toBe('01-02 03:04');
        expect(formatServerDateTime('2026-08-13 09:05:06', { format: 'minuteSecond' })).toBe('05:06');
    });

    it('offers explicit shapes and predictable fallbacks', () => {
        const value = '2026-08-13T00:05:06.000Z';
        expect(formatServerDateTime(value, { format: 'dateTimeMinutes' })).toBe('2026-08-13 09:05');
        expect(formatServerDateTime(value, { format: 'timeSeconds' })).toBe('09:05:06');
        expect(formatServerDateTime(value, { format: 'monthDayTimeSeconds' })).toBe('08-13 09:05:06');
        expect(formatServerDateTime(undefined, { fallback: '-' })).toBe('-');
        expect(formatServerDateTime('not-a-date')).toBe('not-a-date');
    });
});

describe('server datetime-local conversion', () => {
    it('does not depend on the browser or process timezone', () => {
        expect(serverDateTimeInputToIso('2026-08-13T09:05')).toBe('2026-08-13T00:05:00.000Z');
        expect(toServerDateTimeInputValue('2026-08-13T00:05:00.000Z')).toBe('2026-08-13T09:05');
    });

    it('rejects invalid local input', () => {
        expect(serverDateTimeInputToIso('2026-02-30T09:05')).toBeUndefined();
        expect(serverDateTimeInputToIso('')).toBeUndefined();
        expect(toServerDateTimeInputValue('not-a-date')).toBe('');
    });
});
