import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_화륜차연구',
    name: '화륜차 연구',
    auxKey: 'can_화륜차사용',
    preReqTurn: 23,
    cost: 100000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
