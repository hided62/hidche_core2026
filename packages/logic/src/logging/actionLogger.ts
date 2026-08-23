import { LogCategory, type LogEntryDraft, LogFormat, LogScope } from './types.js';

const legacyFlushBucket = (entry: LogEntryDraft): number => {
    if (entry.scope === LogScope.GENERAL) {
        switch (entry.category) {
            case LogCategory.HISTORY:
                return 0;
            case LogCategory.ACTION:
                return 1;
            case LogCategory.BATTLE_BRIEF:
                return 2;
            case LogCategory.BATTLE_DETAIL:
                return 3;
        }
    }
    if (entry.scope === LogScope.NATION && entry.category === LogCategory.HISTORY) {
        return 4;
    }
    if (entry.scope === LogScope.SYSTEM && entry.category === LogCategory.HISTORY) {
        return 5;
    }
    if (entry.scope === LogScope.SYSTEM && entry.category === LogCategory.SUMMARY) {
        return 6;
    }
    return 7;
};

const orderLegacyFlushGroup = (entries: readonly LogEntryDraft[]): LogEntryDraft[] => {
    const buckets = Array.from({ length: 8 }, () => [] as LogEntryDraft[]);
    for (const entry of entries) {
        buckets[legacyFlushBucket(entry)]!.push(entry);
    }
    return buckets.flat();
};

/** Ref ActionLogger별 flush 순서와 그 안의 대상/분류별 버퍼 순서를 보존한다. */
export const orderLegacyActionLoggerFlush = (entries: readonly LogEntryDraft[]): LogEntryDraft[] => {
    const groups = new Map<number, LogEntryDraft[]>();
    for (const entry of entries) {
        const group = entry.legacyFlushGroup ?? 0;
        const groupedEntries = groups.get(group);
        if (groupedEntries) {
            groupedEntries.push(entry);
        } else {
            groups.set(group, [entry]);
        }
    }
    return [...groups.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([, groupedEntries]) => orderLegacyFlushGroup(groupedEntries));
};

export class ActionLogger {
    private readonly generalId: number | undefined;
    private readonly nationId: number | undefined;
    private readonly logs: LogEntryDraft[] = [];

    constructor(options: { generalId?: number; nationId?: number } = {}) {
        this.generalId = options.generalId;
        this.nationId = options.nationId;
    }

    // 장수/국가/전역 로그를 한번에 모아두고 외부에서 저장한다.
    public flush(): LogEntryDraft[] {
        const items = this.logs.splice(0, this.logs.length);
        return orderLegacyActionLoggerFlush(items);
    }

    public rollback(): LogEntryDraft[] {
        const backup = this.logs.splice(0, this.logs.length);
        return backup;
    }

    public pushGeneralHistoryLog(text: string | string[], format: LogFormat = LogFormat.YEAR_MONTH): void {
        this.pushBatch(text, (message) => ({
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
            text: message,
            ...(this.generalId !== undefined ? { generalId: this.generalId } : {}),
            format,
        }));
    }

    public pushGeneralActionLog(text: string | string[], format: LogFormat = LogFormat.MONTH): void {
        this.pushBatch(text, (message) => ({
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            text: message,
            ...(this.generalId !== undefined ? { generalId: this.generalId } : {}),
            format,
        }));
    }

    public pushGeneralBattleResultLog(text: string | string[], format: LogFormat = LogFormat.RAWTEXT): void {
        this.pushBatch(text, (message) => ({
            scope: LogScope.GENERAL,
            category: LogCategory.BATTLE_BRIEF,
            text: message,
            ...(this.generalId !== undefined ? { generalId: this.generalId } : {}),
            format,
        }));
    }

    public pushGeneralBattleDetailLog(text: string | string[], format: LogFormat = LogFormat.PLAIN): void {
        this.pushBatch(text, (message) => ({
            scope: LogScope.GENERAL,
            category: LogCategory.BATTLE_DETAIL,
            text: message,
            ...(this.generalId !== undefined ? { generalId: this.generalId } : {}),
            format,
        }));
    }

    public pushNationHistoryLog(
        text: string | string[],
        format: LogFormat = LogFormat.YEAR_MONTH,
        nationId: number | undefined = this.nationId
    ): void {
        if (!nationId) {
            return;
        }
        this.pushBatch(text, (message) => ({
            scope: LogScope.NATION,
            category: LogCategory.HISTORY,
            text: message,
            nationId,
            format,
        }));
    }

    public pushGlobalHistoryLog(text: string | string[], format: LogFormat = LogFormat.YEAR_MONTH): void {
        this.pushBatch(text, (message) => ({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            text: message,
            format,
        }));
    }

    public pushGlobalActionLog(text: string | string[], format: LogFormat = LogFormat.MONTH): void {
        this.pushBatch(text, (message) => ({
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            text: message,
            format,
        }));
    }

    private pushBatch(text: string | string[], builder: (message: string) => LogEntryDraft): void {
        if (Array.isArray(text)) {
            for (const item of text) {
                if (item) {
                    this.logs.push(builder(item));
                }
            }
            return;
        }
        if (!text) {
            return;
        }
        this.logs.push(builder(text));
    }
}
