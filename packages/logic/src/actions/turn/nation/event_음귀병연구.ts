import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_음귀병연구',
    name: '음귀병 연구',
    auxKey: 'can_음귀병사용',
    preReqTurn: 11,
    cost: 50000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
