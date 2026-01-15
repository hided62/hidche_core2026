import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_화시병연구',
    name: '화시병 연구',
    auxKey: 'can_화시병사용',
    preReqTurn: 11,
    cost: 50000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
