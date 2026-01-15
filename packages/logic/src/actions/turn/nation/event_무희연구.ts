import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_무희연구',
    name: '무희 연구',
    auxKey: 'can_무희사용',
    preReqTurn: 23,
    cost: 100000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
