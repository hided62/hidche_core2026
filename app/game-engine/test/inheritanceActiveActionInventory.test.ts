import { describe, expect, it } from 'vitest';
import { DEFAULT_TURN_COMMAND_PROFILE, type ScenarioConfig } from '@sammo-ts/logic';

import { buildCommandEnv, buildReservedTurnDefinitions } from '../src/turn/reservedTurnCommands.js';

const scenarioConfig: ScenarioConfig = {
    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMin: 10, npcMax: 70, chiefMin: 70 },
    iconPath: '',
    map: {},
    const: {},
    environment: { mapName: 'inheritance-active-action', unitSet: 'default' },
};

const generalCommands = [
    'che_거병',
    'che_건국',
    'che_등용수락',
    'che_랜덤임관',
    'che_모반시도',
    'che_무작위건국',
    'che_방랑',
    'che_선양',
    'che_인재탐색',
    'che_임관',
    'che_장수대상임관',
    'che_첩보',
    'che_출병',
    'che_하야',
    'cr_건국',
] as const;

const nationCommands = [
    'che_감축',
    'che_국기변경',
    'che_국호변경',
    'che_무작위수도이전',
    'che_증축',
    'che_천도',
    'che_초토화',
    'event_극병연구',
    'event_대검병연구',
    'event_무희연구',
    'event_산저병연구',
    'event_상병연구',
    'event_원융노병연구',
    'event_음귀병연구',
    'event_화륜차연구',
    'event_화시병연구',
] as const;

describe('Ref active-action inheritance inventory', () => {
    it('marks every Ref command call site, including trend-producing strategic and research actions', async () => {
        const { general, nation } = await buildReservedTurnDefinitions({
            env: buildCommandEnv(scenarioConfig),
            commandProfile: DEFAULT_TURN_COMMAND_PROFILE,
            defaultActionKey: '휴식',
        });

        const generalWithFixedOrContextAmount = [...general.entries()]
            .filter(([, definition]) => typeof definition.getInheritanceActiveActionAmount === 'function')
            .map(([key]) => key)
            .sort();
        expect(generalWithFixedOrContextAmount).toEqual(generalCommands.filter((key) => key !== 'che_인재탐색').sort());
        // 인재탐색은 발견확률을 실제 resolve 안에서 계산해 sqrt(1/p)를
        // 기록한다. 별도 차등 fixture가 이 가중 경로를 검증한다.
        expect(general.get('che_인재탐색')).toBeDefined();

        const nationWithPoint = [...nation.entries()]
            .filter(([, definition]) => definition.countsAsInheritanceActiveAction)
            .map(([key]) => key)
            .sort();
        expect(nationWithPoint).toEqual([...nationCommands].sort());
    });
});
