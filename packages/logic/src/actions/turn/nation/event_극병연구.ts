import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_극병연구',
    name: '극병 연구',
    auxKey: 'can_극병사용',
    preReqTurn: 23,
    cost: 100000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
