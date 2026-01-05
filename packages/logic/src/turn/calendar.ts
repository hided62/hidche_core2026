export interface TurnScheduleEntry {
    startMinute: number;
    tickMinutes: number;
}

export type TurnScheduleEntries = [TurnScheduleEntry, ...TurnScheduleEntry[]];

export interface TurnSchedule {
    entries: TurnScheduleEntries;
}

const MINUTES_PER_DAY = 24 * 60;

const toMinuteOfDay = (date: Date): number => date.getHours() * 60 + date.getMinutes();

const toLocalDateAtMinute = (date: Date, minuteOfDay: number, dayOffset = 0): Date => {
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset, hour, minute, 0, 0);
};

const normalizeEntries = (entries: TurnScheduleEntries): TurnScheduleEntries => {
    const normalized = entries
        .map((entry) => ({
            startMinute: Math.max(0, Math.min(MINUTES_PER_DAY - 1, entry.startMinute)),
            tickMinutes: Math.max(1, entry.tickMinutes),
        }))
        .sort((a, b) => a.startMinute - b.startMinute);

    return normalized as TurnScheduleEntries;
};

const findCurrentEntryIndex = (minuteOfDay: number, entries: TurnScheduleEntries): number => {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        if (entry && entry.startMinute <= minuteOfDay) {
            return i;
        }
    }
    return -1;
};

const getEntryAt = (entries: TurnScheduleEntries, index: number): TurnScheduleEntry =>
    entries[Math.max(0, Math.min(entries.length - 1, index))] ?? entries[0];

export const getTickMinutesAt = (date: Date, schedule: TurnSchedule): number => {
    const entries = normalizeEntries(schedule.entries);
    const minuteOfDay = toMinuteOfDay(date);
    const index = findCurrentEntryIndex(minuteOfDay, entries);
    const entry = getEntryAt(entries, index >= 0 ? index : entries.length - 1);
    return entry.tickMinutes;
};

export const getNextTurnAt = (date: Date, schedule: TurnSchedule): Date => {
    const entries = normalizeEntries(schedule.entries);
    const minuteOfDay = toMinuteOfDay(date);
    const index = findCurrentEntryIndex(minuteOfDay, entries);
    const currentIndex = index >= 0 ? index : entries.length - 1;
    const startDayOffset = index >= 0 ? 0 : -1;
    const nextIndex = (currentIndex + 1) % entries.length;
    const nextDayOffset = startDayOffset + (nextIndex > currentIndex ? 0 : 1);

    const currentEntry = getEntryAt(entries, currentIndex);
    const nextEntry = getEntryAt(entries, nextIndex);
    const segmentStart = toLocalDateAtMinute(date, currentEntry.startMinute, startDayOffset);
    const segmentEnd = toLocalDateAtMinute(date, nextEntry.startMinute, nextDayOffset);

    const elapsedMinutes = (date.getTime() - segmentStart.getTime()) / 60000;
    const nextStep = Math.floor(elapsedMinutes / currentEntry.tickMinutes) + 1;
    const nextCandidate = new Date(segmentStart.getTime() + nextStep * currentEntry.tickMinutes * 60000);

    if (nextCandidate.getTime() < segmentEnd.getTime()) {
        return nextCandidate;
    }

    return segmentEnd;
};
