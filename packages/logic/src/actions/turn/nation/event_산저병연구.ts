import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_산저병연구',
    name: '산저병 연구',
    auxKey: 'can_산저병사용',
    preReqTurn: 11,
    cost: 50000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
