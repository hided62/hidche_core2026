import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { RandomGenerator } from '@sammo-ts/common';

const generalActionEventBrand: unique symbol = Symbol('GeneralActionEvent');

export interface GeneralActionEventPayloadMap {
    'item.purchased': {
        itemKey: string;
        slot: 'horse' | 'weapon' | 'book' | 'item';
    };
    'item.sold': {
        itemKey: string;
        slot: 'horse' | 'weapon' | 'book' | 'item';
    };
    'strategy.succeeded': {
        consumedItems: readonly string[];
    };
    'city.conquered': {
        attacker: General;
    };
}

export type GeneralActionEventType = keyof GeneralActionEventPayloadMap;

export type GeneralActionEventContext<
    K extends GeneralActionEventType,
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> = K extends 'item.sold' | 'city.conquered'
    ? GeneralActionContext<TriggerState> & { rng: RandomGenerator } & (K extends 'item.sold'
              ? { time: NonNullable<GeneralActionContext<TriggerState>['time']> }
              : object)
    : GeneralActionContext<TriggerState>;

/**
 * 레거시 문자열/phase/aux 삼중항을 닫힌 이벤트 계약으로 투영합니다.
 *
 * unique-symbol 필드는 런타임 분기용이 아니라 서로 다른 이벤트 payload가
 * 구조적으로 우연히 호환되는 것을 막는 nominal shadow type입니다. 이벤트는
 * 반드시 createGeneralActionEvent()로 만들며, handler는 같은 K만 반환합니다.
 */
export type GeneralActionEvent<
    K extends GeneralActionEventType,
    _TriggerState extends GeneralTriggerState = GeneralTriggerState,
> = Readonly<{
    type: K;
    payload: Readonly<GeneralActionEventPayloadMap[K]>;
    [generalActionEventBrand]: K;
}>;

export type GeneralActionEventHandler<TriggerState extends GeneralTriggerState, K extends GeneralActionEventType> = {
    bivarianceHack(
        context: GeneralActionEventContext<K, TriggerState>,
        event: GeneralActionEvent<K, TriggerState>
    ): GeneralActionEvent<K, TriggerState> | void;
}['bivarianceHack'];

export type GeneralActionEventHandlers<TriggerState extends GeneralTriggerState = GeneralTriggerState> = Partial<{
    [K in GeneralActionEventType]: GeneralActionEventHandler<TriggerState, K>;
}>;

export const createGeneralActionEvent = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
    K extends GeneralActionEventType = GeneralActionEventType,
>(
    type: K,
    payload: GeneralActionEventPayloadMap[K]
): GeneralActionEvent<K, TriggerState> => ({
    type,
    payload,
    [generalActionEventBrand]: type,
});

export const dispatchGeneralActionEventHandlers = <
    TriggerState extends GeneralTriggerState,
    K extends GeneralActionEventType,
>(
    handlers: GeneralActionEventHandlers<TriggerState> | null | undefined,
    context: GeneralActionEventContext<K, TriggerState>,
    event: GeneralActionEvent<K, TriggerState>
): GeneralActionEvent<K, TriggerState> => {
    // Mapped-type lookup preserves K, but TypeScript cannot currently retain
    // that correlation through a generic indexed access. This single local
    // assertion is the proof boundary; module authors and call sites remain
    // fully checked without unknown/any casts.
    const handler = handlers?.[event.type] as GeneralActionEventHandler<TriggerState, K> | undefined;
    return handler?.(context, event) ?? event;
};
