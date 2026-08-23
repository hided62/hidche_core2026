export interface OrderedSemanticLogOptions {
    omitRest?: boolean;
}

type SemanticLogFormat =
    | 'rawtext'
    | 'plain'
    | 'year_month'
    | 'year'
    | 'month'
    | 'event_plain'
    | 'event_year_month'
    | 'notice'
    | 'notice_year_month';

interface ParsedStoredLogText {
    format: SemanticLogFormat;
    text: string;
    renderedYear?: number;
    renderedMonth?: number;
}

const normalizeLogBody = (value: unknown): string =>
    String(value)
        .replace(/<span class=(['"])hidden_but_copyable\1>(.*?)<\/span>/g, '$2')
        .replace(/ ?<1>\d{2}:\d{2}<\/\>$/, '');

const parseStoredLogText = (value: unknown): ParsedStoredLogText => {
    const text = String(value);
    const yearMonth = text.match(/^<C>●<\/>(\d+)년 (\d+)월:/u);
    if (yearMonth) {
        return {
            format: 'year_month',
            renderedYear: Number(yearMonth[1]),
            renderedMonth: Number(yearMonth[2]),
            text: text.slice(yearMonth[0].length),
        };
    }
    const year = text.match(/^<C>●<\/>(\d+)년:/u);
    if (year) {
        return {
            format: 'year',
            renderedYear: Number(year[1]),
            text: text.slice(year[0].length),
        };
    }
    const month = text.match(/^<C>●<\/>(\d+)월:/u);
    if (month) {
        return {
            format: 'month',
            renderedMonth: Number(month[1]),
            text: text.slice(month[0].length),
        };
    }
    if (text.startsWith('<C>●</>')) {
        return { format: 'plain', text: text.slice('<C>●</>'.length) };
    }

    const eventYearMonth = text.match(/^<S>◆<\/>(\d+)년 (\d+)월:/u);
    if (eventYearMonth) {
        return {
            format: 'event_year_month',
            renderedYear: Number(eventYearMonth[1]),
            renderedMonth: Number(eventYearMonth[2]),
            text: text.slice(eventYearMonth[0].length),
        };
    }
    if (text.startsWith('<S>◆</>')) {
        return { format: 'event_plain', text: text.slice('<S>◆</>'.length) };
    }

    const noticeYearMonth = text.match(/^<R>★<\/>(\d+)년 (\d+)월:/u);
    if (noticeYearMonth) {
        return {
            format: 'notice_year_month',
            renderedYear: Number(noticeYearMonth[1]),
            renderedMonth: Number(noticeYearMonth[2]),
            text: text.slice(noticeYearMonth[0].length),
        };
    }
    if (text.startsWith('<R>★</>')) {
        return { format: 'notice', text: text.slice('<R>★</>'.length) };
    }
    return { format: 'rawtext', text };
};

const readLogCalendar = (entry: Record<string, unknown>, field: 'year' | 'month'): number => {
    const value = entry[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new Error(`log.${field} must be a safe integer`);
    }
    if (field === 'month' && (value < 1 || value > 12)) {
        throw new Error(`log.month must be between 1 and 12: ${value}`);
    }
    return value;
};

const readExplicitLogFormat = (entry: Record<string, unknown>): number | null => {
    if (!Object.prototype.hasOwnProperty.call(entry, 'format')) {
        return null;
    }
    const value = entry.format;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 8) {
        throw new Error(`log.format must be an integer from 0 through 8: ${String(value)}`);
    }
    return value;
};

/** Independent rendering of Core's draft enum into Ref's persisted prefix contract. */
const renderExplicitLogFormat = (text: string, format: number, year: number, month: number): string => {
    switch (format) {
        case 0:
            return text;
        case 1:
            return `<C>●</>${text}`;
        case 2:
            return `<C>●</>${year}년 ${month}월:${text}`;
        case 3:
            return `<C>●</>${year}년:${text}`;
        case 4:
            return `<C>●</>${month}월:${text}`;
        case 5:
            return `<S>◆</>${text}`;
        case 6:
            return `<S>◆</>${year}년 ${month}월:${text}`;
        case 7:
            return `<R>★</>${text}`;
        case 8:
            return `<R>★</>${year}년 ${month}월:${text}`;
        default:
            throw new Error(`unsupported log format: ${format}`);
    }
};

const projectSemanticLogEntry = (entry: Record<string, unknown>): Record<string, unknown> => {
    const year = readLogCalendar(entry, 'year');
    const month = readLogCalendar(entry, 'month');
    const explicitFormat = readExplicitLogFormat(entry);
    const renderedText =
        explicitFormat === null
            ? String(entry.text)
            : renderExplicitLogFormat(String(entry.text), explicitFormat, year, month);
    const parsed = parseStoredLogText(renderedText);
    if (parsed.renderedYear !== undefined && parsed.renderedYear !== year) {
        throw new Error(`stored log year ${parsed.renderedYear} does not match row year ${year}`);
    }
    if (parsed.renderedMonth !== undefined && parsed.renderedMonth !== month) {
        throw new Error(`stored log month ${parsed.renderedMonth} does not match row month ${month}`);
    }
    return {
        scope: String(entry.scope).toLowerCase(),
        category: String(entry.category).toLowerCase(),
        generalId: Number(entry.generalId) || null,
        nationId: Number(entry.nationId) || null,
        year,
        month,
        format: parsed.format,
        text: normalizeLogBody(parsed.text),
    };
};

export const normalizeStoredTurnLogText = (value: unknown): string => normalizeLogBody(parseStoredLogText(value).text);

const logStream = (entry: Record<string, unknown>): 'general_record' | 'world_history' => {
    const scope = String(entry.scope).toLowerCase();
    const category = String(entry.category).toLowerCase();
    // Ref keeps a general's own history rows in general_record. Only nation
    // history and global history share world_history's independent ID stream.
    return scope === 'nation' || (scope === 'system' && category === 'history') ? 'world_history' : 'general_record';
};

const numericLogId = (entry: Record<string, unknown>): number => {
    const id = Number(entry.id);
    return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
};

/**
 * Compare the semantic persisted log graph without erasing write order,
 * calendar ownership, or Ref's rendered format prefix.
 *
 * Ref stores action/summary logs in `general_record` and nation/global history
 * in `world_history`. Their numeric IDs are independent, so ordering across
 * those tables is not observable. Ordering inside each table is observable and
 * is part of the command lifecycle contract.
 */
export const orderedSemanticLogStreams = (
    logs: Array<Record<string, unknown>>,
    options: OrderedSemanticLogOptions = {}
): string[] => {
    const streams = new Map<string, Array<{ entry: Record<string, unknown>; inputIndex: number }>>();
    logs.forEach((entry, inputIndex) => {
        if (options.omitRest && normalizeStoredTurnLogText(entry.text) === '아무것도 실행하지 않았습니다.') {
            return;
        }
        const key = logStream(entry);
        const values = streams.get(key) ?? [];
        values.push({ entry, inputIndex });
        streams.set(key, values);
    });

    return [...streams.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([stream, values]) =>
            JSON.stringify({
                stream,
                entries: values
                    .sort(
                        (left, right) =>
                            numericLogId(left.entry) - numericLogId(right.entry) || left.inputIndex - right.inputIndex
                    )
                    .map(({ entry }) => projectSemanticLogEntry(entry)),
            })
        );
};
