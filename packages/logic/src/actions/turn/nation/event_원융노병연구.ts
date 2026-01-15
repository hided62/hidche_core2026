import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_원융노병연구',
    name: '원융노병 연구',
    auxKey: 'can_원융노병사용',
    preReqTurn: 23,
    cost: 100000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
