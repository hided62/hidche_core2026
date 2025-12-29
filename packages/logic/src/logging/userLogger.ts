import { LogCategory, type LogEntryDraft, LogScope } from './types.js';

export class UserLogger {
    private readonly userId: number;
    private readonly logs: LogEntryDraft[] = [];

    constructor(userId: number) {
        this.userId = userId;
    }

    // 유저 단위의 기록을 모아두었다가 외부에서 저장한다.
    public flush(): LogEntryDraft[] {
        const items = this.logs.splice(0, this.logs.length);
        return items;
    }

    public rollback(): LogEntryDraft[] {
        const backup = this.logs.splice(0, this.logs.length);
        return backup;
    }

    public push(text: string | string[], subType: string): void {
        if (Array.isArray(text)) {
            for (const item of text) {
                if (item) {
                    this.logs.push({
                        scope: LogScope.USER,
                        category: LogCategory.USER,
                        text: item,
                        userId: this.userId,
                        subType,
                    });
                }
            }
            return;
        }
        if (!text) {
            return;
        }
        this.logs.push({
            scope: LogScope.USER,
            category: LogCategory.USER,
            text,
            userId: this.userId,
            subType,
        });
    }
}
