import { createEventResearchCommand } from './eventResearch.js';

const { ActionDefinition, commandSpec, actionContextBuilder } = createEventResearchCommand({
    key: 'event_대검병연구',
    name: '대검병 연구',
    auxKey: 'can_대검병사용',
    preReqTurn: 11,
    cost: 50000,
});

export { ActionDefinition, commandSpec, actionContextBuilder };
