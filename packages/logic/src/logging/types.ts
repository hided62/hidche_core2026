export const LogScope = {
    SYSTEM: 'SYSTEM',
    NATION: 'NATION',
    GENERAL: 'GENERAL',
    USER: 'USER',
} as const;

export type LogScope = (typeof LogScope)[keyof typeof LogScope];

export const LogCategory = {
    HISTORY: 'HISTORY',
    SUMMARY: 'SUMMARY',
    ACTION: 'ACTION',
    BATTLE_BRIEF: 'BATTLE_BRIEF',
    BATTLE_DETAIL: 'BATTLE_DETAIL',
    USER: 'USER',
} as const;

export type LogCategory = (typeof LogCategory)[keyof typeof LogCategory];

export interface LogEntryDraft {
    scope: LogScope;
    category: LogCategory;
    text: string;
    generalId?: number;
    nationId?: number;
    userId?: number;
    subType?: string;
    meta?: Record<string, unknown>;
    format?: LogFormat;
    /** 월 경계 전 action처럼 flush 시점과 다른 달에 귀속되는 로그의 명시적 날짜. */
    year?: number;
    month?: number;
    /** 로그를 만든 논리 게임 시각. 생략하면 flush context의 시각을 사용한다. */
    occurredAt?: Date;
    /** 하나의 명령에서 별도 Ref ActionLogger로 저장한 순서. 작은 그룹을 먼저 flush한다. */
    legacyFlushGroup?: number;
}

export interface LogEntryRecord {
    scope: LogScope;
    category: LogCategory;
    text: string;
    year: number;
    month: number;
    generalId?: number;
    nationId?: number;
    userId?: number;
    subType?: string;
    meta?: Record<string, unknown>;
    createdAt?: Date;
}

export interface LogContext {
    year: number;
    month: number;
    at?: Date;
}

export enum LogFormat {
    RAWTEXT = 0,
    /** <C>●</> */
    PLAIN = 1,
    /** <C>●</>{$year}년 {$month}월: */
    YEAR_MONTH = 2,
    /** <C>●</>{$year}년: */
    YEAR = 3,
    /** <C>●</>{$month}월: */
    MONTH = 4,
    /** <S>◆</> */
    EVENT_PLAIN = 5,
    /** <S>◆</>{$year}년 {$month}월: */
    EVENT_YEAR_MONTH = 6,
    /** <R>★</> */
    NOTICE = 7,
    /** <R>★</>{$year}년 {$month}월: */
    NOTICE_YEAR_MONTH = 8,
}
