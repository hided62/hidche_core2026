import { formatLogText } from './formatter.js';
import { type LogContext, type LogEntryDraft, type LogEntryRecord, LogFormat, LogScope } from './types.js';

const shouldDropEntry = (entry: LogEntryDraft): boolean => {
    if (entry.scope === LogScope.GENERAL && !entry.generalId) {
        return true;
    }
    if (entry.scope === LogScope.NATION && !entry.nationId) {
        return true;
    }
    if (entry.scope === LogScope.USER && !entry.userId) {
        return true;
    }
    return false;
};

export const finalizeLogEntry = (entry: LogEntryDraft, context: LogContext): LogEntryRecord | null => {
    if (shouldDropEntry(entry)) {
        return null;
    }

    const year = entry.year ?? context.year;
    const month = entry.month ?? context.month;
    const format = entry.format ?? LogFormat.RAWTEXT;
    const text = formatLogText(entry.text, format, year, month);

    const record: LogEntryRecord = {
        scope: entry.scope,
        category: entry.category,
        text,
        year,
        month,
    };

    if (entry.generalId !== undefined) {
        record.generalId = entry.generalId;
    }
    if (entry.nationId !== undefined) {
        record.nationId = entry.nationId;
    }
    if (entry.userId !== undefined) {
        record.userId = entry.userId;
    }
    if (entry.subType !== undefined) {
        record.subType = entry.subType;
    }
    if (entry.meta !== undefined) {
        record.meta = entry.meta;
    }
    const createdAt = entry.occurredAt ?? context.at;
    if (createdAt !== undefined) {
        record.createdAt = createdAt;
    }

    return record;
};
