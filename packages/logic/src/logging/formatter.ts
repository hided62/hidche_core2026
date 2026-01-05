import { LogFormat } from './types.js';

// 로그 포맷은 기존 표시 규칙(<C>/<S>/<R> + 기호)을 그대로 유지한다.
export const formatLogText = (text: string, format: LogFormat, year: number, month: number): string => {
    switch (format) {
        case LogFormat.RAWTEXT:
            return text;
        case LogFormat.PLAIN:
            return `<C>●</>${text}`;
        case LogFormat.YEAR_MONTH:
            return `<C>●</>${year}년 ${month}월:${text}`;
        case LogFormat.YEAR:
            return `<C>●</>${year}년:${text}`;
        case LogFormat.MONTH:
            return `<C>●</>${month}월:${text}`;
        case LogFormat.EVENT_PLAIN:
            return `<S>◆</>${text}`;
        case LogFormat.EVENT_YEAR_MONTH:
            return `<S>◆</>${year}년 ${month}월:${text}`;
        case LogFormat.NOTICE:
            return `<R>★</>${text}`;
        case LogFormat.NOTICE_YEAR_MONTH:
            return `<R>★</>${year}년 ${month}월:${text}`;
        default:
            return text;
    }
};
