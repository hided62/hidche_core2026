import type { EffectiveAiPolicy } from './effectivePolicy.js';
import type { RandUtil } from '@sammo-ts/common';

/** 원문 meta/seed/임의 객체를 받지 않는 관측 계약. 내부 후보 조건은 별도 계측으로 확장한다. */
export type AiTraceValue = string | number | boolean | null | { entityId: number } | { unprojected: true };
export type AiExecutionCheck = {
    stage: 'ARGS' | 'CONSTRAINT' | 'COOLDOWN' | 'CONTEXT' | 'BLOCK';
    action: string;
    result: 'allow' | 'deny' | 'unknown';
    reason: string | null;
};
export type AiExecutionAttempt = {
    kind: 'EXECUTION_ATTEMPT';
    attempt: number;
    requestedAction: string;
    resolvedAction: string;
    executedAction: string | null;
    checks: AiExecutionCheck[];
    completed: boolean;
    usedFallback: boolean;
    alternativeAction: string | null;
    preparation: { term: number; total: number } | null;
};
export type AiTraceStep =
    | AiExecutionAttempt
    | { kind: 'DECISION_START'; reservedAction: string; effectivePolicy?: EffectiveAiPolicy }
    | { kind: 'DECISION_END'; action: string | null; reason: string | null }
    | { kind: 'DECISION_ERROR' }
    | { kind: 'PROCEDURE_START'; procedure: string }
    | { kind: 'PROCEDURE_END'; procedure: string; action: string | null; reason: string | null }
    | { kind: 'PROCEDURE_SKIP'; procedure: string; reason: 'POLICY' | 'AUTOMATION' | 'NO_HANDLER' }
    | {
          kind: 'CANDIDATE';
          action: string;
          result: 'INVALID_ARGS' | 'allow' | 'deny' | 'unknown';
          constraint: string | null;
      }
    | { kind: 'RNG'; method: string; parameters: number[] | null; result: AiTraceValue | AiTraceValue[] };
export type AiDecisionTraceEvent = AiTraceStep & {
    sequence: number;
    phase: 'general' | 'nation';
    generalId: number;
    nationId: number;
    cityId: number;
    npcState: number;
    year: number;
    month: number;
    tick: number | null;
};
export type AiDecisionTraceObserver = (event: AiDecisionTraceEvent) => void;

const projectValue = (value: unknown): AiTraceValue => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'number') {
        return { entityId: value.id };
    }
    return { unprojected: true };
};
const observedMethods = new Set([
    'nextFloat1',
    'nextRange',
    'nextRangeInt',
    'nextInt',
    'nextIntInclusive',
    'nextBit',
    'nextBool',
    'shuffle',
    'choice',
    'choiceUsingWeight',
    'choiceUsingWeightPair',
]);

/** 외부에서 호출한 RandUtil 결과만 관측한다. 원래 receiver로 실행해 중첩 helper와 RNG 소비를 보존한다. */
export const observeAiRng = (rng: RandUtil, observe: (step: AiTraceStep) => void): RandUtil =>
    new Proxy(rng, {
        get(target, property) {
            const value = Reflect.get(target, property, target);
            if (typeof value !== 'function' || !observedMethods.has(String(property))) return value;
            return (...args: unknown[]) => {
                const result: unknown = Reflect.apply(value, target, args);
                observe({
                    kind: 'RNG',
                    method: String(property),
                    parameters: String(property).startsWith('next')
                        ? args.filter((arg): arg is number => typeof arg === 'number' && Number.isFinite(arg))
                        : null,
                    result: Array.isArray(result) ? result.map(projectValue) : projectValue(result),
                });
                return result;
            };
        },
    });
