import { asRecord } from '@sammo-ts/common';
import type { ScenarioConfig } from '@sammo-ts/logic';

export const LEGACY_TROOP_JOIN_EVENT = 'sammo\\API\\Troop\\JoinTroop';
export const IMMEDIATE_TROOP_JOIN_MOVE_HANDLER = 'event_부대탑승즉시이동';
export const LEGACY_NATION_ASSIGNMENT_EVENT = 'sammo\\Command\\Nation\\che_발령';
export const IMMEDIATE_ASSIGNMENT_GATHER_HANDLER = 'event_부대발령즉시집합';

export const hasScenarioStaticEventHandler = (
    scenarioConfig: ScenarioConfig,
    eventType: string,
    handlerName: string
): boolean => {
    const handlersByEvent = asRecord(scenarioConfig.const.staticEventHandlers);
    const handlers = handlersByEvent[eventType];
    return Array.isArray(handlers) && handlers.includes(handlerName);
};
