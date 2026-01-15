import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_상병연구',
    name: '상병 연구',
    auxKey: 'can_상병사용',
    preReqTurn: 23,
    cost: 100000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
