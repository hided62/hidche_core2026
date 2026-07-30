import { describe, expect, it } from 'vitest';

import type { General } from '../src/domain/entities.js';
import { createGeneralActionEvent, type GeneralActionEvent } from '../src/actionModules/events.js';
import { GeneralActionPipeline, type GeneralActionModule } from '../src/actionModules/general.js';
import { createRefOrderedActionStack } from '../src/actionModules/bundle.js';

const makeGeneral = (): General => ({
    id: 1,
    name: '이벤트 장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1000,
    rice: 1000,
    crew: 1000,
    crewTypeId: 1100,
    train: 100,
    atmos: 100,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
});

describe('typed general action events', () => {
    it('folds synchronous event handlers in the supplied ref ownership order', () => {
        const trace: string[] = [];
        const names = ['nation', 'officer', 'domestic', 'war', 'personality', 'crew', 'inherit', 'item'];
        const modules: GeneralActionModule[] = names.map((name) => ({
            eventHandlers: {
                'strategy.succeeded': (_context, event) => {
                    trace.push(name);
                    return createGeneralActionEvent('strategy.succeeded', {
                        consumedItems: [...event.payload.consumedItems, name],
                    });
                },
            },
        }));
        const stack = createRefOrderedActionStack({
            nation: modules[0]!,
            officer: modules[1]!,
            domestic: modules[2]!,
            war: modules[3]!,
            personality: modules[4]!,
            crewType: modules[5]!,
            inheritance: modules[6]!,
            scenario: null,
            items: [modules[7]!],
        });
        const pipeline = new GeneralActionPipeline(stack);

        const result = pipeline.dispatch(
            { general: makeGeneral() },
            createGeneralActionEvent('strategy.succeeded', { consumedItems: [] })
        );

        expect(trace).toEqual(names);
        expect(result.payload.consumedItems).toEqual(names);
    });
});

// tsc가 실행될 때만 평가하는 negative type contract입니다.
const assertCompileTimeContracts = (pipeline: GeneralActionPipeline, general: General): void => {
    // @ts-expect-error item.purchased에는 slot이 필수입니다.
    createGeneralActionEvent('item.purchased', { itemKey: 'x' });

    const sold = createGeneralActionEvent('item.sold', {
        itemKey: 'x',
        slot: 'item',
    });
    // @ts-expect-error item.sold dispatch에는 RNG와 time context가 모두 필수입니다.
    pipeline.dispatch({ general }, sold);

    // @ts-expect-error 닫힌 protocol에 임의 event key를 추가할 수 없습니다.
    createGeneralActionEvent('strategy.failed', { consumedItems: [] });

    // @ts-expect-error unique-symbol shadow brand가 없는 event를 직접 위조할 수 없습니다.
    const forged: GeneralActionEvent<'strategy.succeeded'> = {
        type: 'strategy.succeeded',
        payload: { consumedItems: [] },
    };
    void forged;

    const legacyEscapeHatch = {
        // @ts-expect-error onArbitraryAction은 action module capability가 아닙니다.
        onArbitraryAction: () => null,
    } satisfies GeneralActionModule;
    void legacyEscapeHatch;

    // @ts-expect-error leaf handler와 composite router를 한 module에 함께 선언할 수 없습니다.
    const doubleEventPath: GeneralActionModule = {
        eventHandlers: {
            'strategy.succeeded': (_context, event) => event,
        },
        handleEvent: (_context, event) => event,
    };
    void doubleEventPath;

    // @ts-expect-error 표준 stack은 officer slot을 생략할 수 없습니다.
    createRefOrderedActionStack({
        nation: {},
        domestic: {},
        war: {},
        personality: {},
        crewType: null,
        inheritance: {},
        scenario: null,
        items: [],
    });
};
void assertCompileTimeContracts;
