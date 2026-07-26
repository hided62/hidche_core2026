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
    return new Date(date.getTime() + getTickMinutesAt(date, schedule) * 60_000);
};
