export interface TraceSubject {
    generalIds?: readonly number[];
    nationIds?: readonly number[];
}

export type TraceEvent = 'AI_ACTION_PATCH_TRACE' | 'AI_WAR_TRACE' | 'AI_WAR_FIXTURE_CORE' | 'WAR_TECH_TRACE';

/**
 * 도메인 계산이 환경 변수나 stdout에 직접 의존하지 않도록 런타임이 주입하는
 * 진단 포트입니다. event 이름은 기존 비교 도구가 소비하는 출력 prefix입니다.
 */
export interface TracePort {
    isEnabled(event: TraceEvent, subject?: TraceSubject): boolean;
    write(event: TraceEvent, payload: unknown): void;
}
