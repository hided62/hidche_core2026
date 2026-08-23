import { describe, expect, it } from 'vitest';

import { loadScenarioDefinitionById } from '../src/scenario/scenarioLoader.js';
import { loadScenarioTurnCommandProfile } from '../src/turn/turnCommandProfile.js';

type CommandGroupManifest = ReadonlyArray<{
    category: string;
    commands: readonly string[];
}>;

const defaultGeneralProfileManifest = [
    'che_거병',
    'che_임관',
    'che_장수대상임관',
    'che_랜덤임관',
    'che_귀환',
    'che_건국',
    'che_훈련',
    'che_단련',
    'che_숙련전환',
    'che_사기진작',
    'che_요양',
    'che_견문',
    'che_은퇴',
    'che_내정특기초기화',
    'che_전투특기초기화',
    'che_장비매매',
    'che_출병',
    'che_주민선정',
    'che_정착장려',
    'che_농지개간',
    'che_상업투자',
    'che_기술연구',
    'che_치안강화',
    'che_수비강화',
    'che_성벽보수',
    'che_선동',
    'che_탈취',
    'che_파괴',
    'che_화계',
    'che_집합',
    'che_인재탐색',
    'che_등용',
    'che_징병',
    'che_모병',
    'che_소집해제',
    'che_첩보',
    'che_군량매매',
    'che_물자조달',
    'che_증여',
    'che_헌납',
    'che_이동',
    'che_강행',
    'che_하야',
    'che_선양',
    'che_해산',
    '휴식',
] as const;

const generalPersonalCommands = [
    '휴식',
    'che_요양',
    'che_단련',
    'che_숙련전환',
    'che_견문',
    'che_은퇴',
    'che_장비매매',
    'che_군량매매',
    'che_내정특기초기화',
    'che_전투특기초기화',
] as const;
const generalDomesticCommands = [
    'che_농지개간',
    'che_상업투자',
    'che_기술연구',
    'che_수비강화',
    'che_성벽보수',
    'che_치안강화',
    'che_정착장려',
    'che_주민선정',
    'che_물자조달',
] as const;
const generalMilitaryCommands = [
    'che_징병',
    'che_모병',
    'che_훈련',
    'che_사기진작',
    'che_출병',
    'che_집합',
    'che_소집해제',
    'che_첩보',
] as const;
const generalPersonnelCommands = ['che_이동', 'che_강행', 'che_인재탐색', 'che_귀환', 'che_랜덤임관'] as const;
const generalSchemeCommands = ['che_선동', 'che_탈취', 'che_파괴', 'che_화계'] as const;
const nationDiplomacyCommands = [
    'che_물자원조',
    'che_불가침제의',
    'che_선전포고',
    'che_종전제의',
    'che_불가침파기제의',
] as const;

const scenarioProfileManifest: Record<
    number,
    { generalGroups: CommandGroupManifest | null; nationGroups: CommandGroupManifest }
> = {
    904: {
        generalGroups: [
            { category: '개인', commands: generalPersonalCommands },
            { category: '내정', commands: generalDomesticCommands },
            { category: '군사', commands: generalMilitaryCommands },
            { category: '인사', commands: generalPersonnelCommands },
            { category: '계략', commands: generalSchemeCommands },
            { category: '국가', commands: ['che_증여', 'che_헌납', 'che_하야'] },
        ],
        nationGroups: [
            { category: '휴식', commands: ['휴식'] },
            { category: '인사', commands: ['che_발령', 'che_포상', 'che_몰수'] },
            { category: '특수', commands: ['che_초토화', 'che_천도', 'che_증축', 'che_감축'] },
            {
                category: '전략',
                commands: [
                    'che_필사즉생',
                    'che_백성동원',
                    'che_수몰',
                    'che_허보',
                    'che_의병모집',
                    'che_이호경식',
                    'che_급습',
                ],
            },
            { category: '기타', commands: ['che_피장파장', 'che_국기변경', 'che_국호변경'] },
        ],
    },
    905: {
        generalGroups: [
            { category: '개인', commands: generalPersonalCommands },
            { category: '내정', commands: generalDomesticCommands },
            { category: '군사', commands: generalMilitaryCommands },
            { category: '인사', commands: generalPersonnelCommands },
            { category: '계략', commands: generalSchemeCommands },
            {
                category: '국가',
                commands: ['che_증여', 'che_헌납', 'che_하야', 'che_거병', 'che_무작위건국', 'che_선양', 'che_해산'],
            },
        ],
        nationGroups: [
            { category: '휴식', commands: ['휴식'] },
            { category: '인사', commands: ['che_발령', 'che_포상', 'che_몰수'] },
            { category: '외교', commands: nationDiplomacyCommands },
            { category: '특수', commands: ['che_초토화', 'che_천도', 'che_증축', 'che_감축'] },
            {
                category: '전략',
                commands: [
                    'che_필사즉생',
                    'che_백성동원',
                    'che_수몰',
                    'che_허보',
                    'che_의병모집',
                    'che_이호경식',
                    'che_급습',
                    'che_피장파장',
                ],
            },
            { category: '기타', commands: ['che_국기변경', 'che_국호변경', 'che_무작위수도이전'] },
        ],
    },
    910: {
        generalGroups: [
            { category: '개인', commands: generalPersonalCommands },
            { category: '내정', commands: generalDomesticCommands },
            {
                category: '군사',
                commands: [
                    'che_징병',
                    'che_모병',
                    'che_훈련',
                    'che_사기진작',
                    'cr_맹훈련',
                    'che_출병',
                    'che_집합',
                    'che_소집해제',
                    'che_첩보',
                ],
            },
            { category: '인사', commands: generalPersonnelCommands },
            { category: '계략', commands: generalSchemeCommands },
            {
                category: '국가',
                commands: ['che_증여', 'che_헌납', 'che_하야', 'che_거병', 'cr_건국', 'che_선양', 'che_해산'],
            },
        ],
        nationGroups: [
            { category: '휴식', commands: ['휴식'] },
            { category: '인사', commands: ['che_발령', 'che_포상', 'che_몰수'] },
            { category: '외교', commands: nationDiplomacyCommands },
            { category: '특수', commands: ['che_초토화', 'che_천도', 'cr_인구이동'] },
            {
                category: '전략',
                commands: [
                    'che_필사즉생',
                    'che_백성동원',
                    'che_수몰',
                    'che_허보',
                    'che_의병모집',
                    'che_이호경식',
                    'che_급습',
                ],
            },
            { category: '기타', commands: ['che_피장파장', 'che_국기변경', 'che_국호변경'] },
        ],
    },
    912: {
        generalGroups: null,
        nationGroups: [
            { category: '휴식', commands: ['휴식'] },
            { category: '인사', commands: ['che_발령', 'che_포상', 'che_몰수', 'che_부대탈퇴지시'] },
            { category: '외교', commands: nationDiplomacyCommands },
            { category: '특수', commands: ['che_초토화', 'che_천도', 'che_증축', 'che_감축'] },
            {
                category: '전략',
                commands: [
                    'che_필사즉생',
                    'che_백성동원',
                    'che_수몰',
                    'che_허보',
                    'che_의병모집',
                    'che_이호경식',
                    'che_급습',
                    'che_피장파장',
                ],
            },
            { category: '기타', commands: ['che_국기변경', 'che_국호변경'] },
            {
                category: '연구',
                commands: [
                    'event_대검병연구',
                    'event_극병연구',
                    'event_화시병연구',
                    'event_원융노병연구',
                    'event_산저병연구',
                    'event_음귀병연구',
                    'event_무희연구',
                    'event_상병연구',
                    'event_화륜차연구',
                ],
            },
        ],
    },
};

const loadScenarioProfile = async (scenarioId: number) => {
    const scenario = await loadScenarioDefinitionById(scenarioId);
    return loadScenarioTurnCommandProfile({ scenarioConst: scenario.config.const });
};

describe('scenario command profile resources', () => {
    it('fails closed when the configured base profile file is missing', async () => {
        await expect(
            loadScenarioTurnCommandProfile({ filePath: '/tmp/core2026-command-profile-does-not-exist.json' })
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each(Object.entries(scenarioProfileManifest))(
        'preserves scenario %s general/chief group order and the exact flattened product profile',
        async (scenarioId, manifest) => {
            const result = await loadScenarioProfile(Number(scenarioId));
            const expectedGeneral = manifest.generalGroups
                ? manifest.generalGroups.flatMap((group) => group.commands)
                : defaultGeneralProfileManifest;
            const expectedNation = manifest.nationGroups.flatMap((group) => group.commands);

            expect(result.generalGroups).toEqual(manifest.generalGroups);
            expect(result.nationGroups).toEqual(manifest.nationGroups);
            expect(result.profile.general).toEqual(expectedGeneral);
            expect(result.profile.nation).toEqual(expectedNation);
            expect(new Set(result.profile.general).size).toBe(result.profile.general.length);
            expect(new Set(result.profile.nation).size).toBe(result.profile.nation.length);
        }
    );
});
