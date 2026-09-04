import assert from 'node:assert/strict';
import test from 'node:test';

import { formatReservedCommandBrief } from '../src/components/command/reservedCommandBrief.ts';
import type { CommandAvailability, CommandTable } from '../src/components/command/types.ts';

const command = (key: string, name: string): CommandAvailability => ({
    key,
    name,
    reqArg: false,
    status: 'available',
    possible: true,
    inputFields: [],
});

const generalNames: Array<[string, string]> = [
    ['휴식', '휴식'],
    ['che_이동', '이동'],
    ['che_강행', '강행'],
    ['che_출병', '출병'],
    ['che_첩보', '첩보'],
    ['che_화계', '화계'],
    ['che_선동', '선동'],
    ['che_탈취', '탈취'],
    ['che_파괴', '파괴'],
    ['che_임관', '임관'],
    ['che_등용', '등용'],
    ['che_장수대상임관', '장수 대상 임관'],
    ['che_선양', '선양'],
    ['che_랜덤임관', '랜덤 임관'],
    ['che_건국', '건국'],
    ['che_무작위건국', '무작위 건국'],
    ['che_군량매매', '군량 매매'],
    ['che_헌납', '헌납'],
    ['che_증여', '증여'],
    ['che_징병', '징병'],
    ['che_모병', '모병'],
    ['che_숙련전환', '숙련 전환'],
    ['che_장비매매', '장비 매매'],
];

const nationNames: Array<[string, string]> = [
    ['휴식', '휴식'],
    ['che_발령', '발령'],
    ['che_부대탈퇴지시', '부대 탈퇴 지시'],
    ['che_포상', '포상'],
    ['che_몰수', '몰수'],
    ['che_물자원조', '물자 원조'],
    ['che_불가침제의', '불가침 제의'],
    ['che_불가침파기제의', '불가침 파기 제의'],
    ['che_종전제의', '종전 제의'],
    ['che_선전포고', '선전포고'],
    ['che_급습', '급습'],
    ['che_이호경식', '이호경식'],
    ['che_천도', '천도'],
    ['che_백성동원', '백성 동원'],
    ['che_허보', '허보'],
    ['che_수몰', '수몰'],
    ['che_초토화', '초토화'],
    ['che_증축', '증축'],
    ['che_감축', '감축'],
    ['che_국기변경', '국기 변경'],
    ['che_국호변경', '국호 변경'],
    ['che_피장파장', '피장파장'],
    ['cr_인구이동', '인구이동'],
];

const table: CommandTable = {
    general: [{ category: '전체', values: generalNames.map(([key, name]) => command(key, name)) }],
    nation: [{ category: '전체', values: nationNames.map(([key, name]) => command(key, name)) }],
    inputOptions: {
        cities: [
            { value: 2, label: '단양 (오 · 회계)' },
            { value: 3, label: '업 (위)' },
        ],
        nations: [
            { value: 2, label: '오' },
            { value: 3, label: '위' },
        ],
        generals: [
            { value: 8, label: '손권 (오 · 단양)' },
            { value: 9, label: '조조 (위 · 업)' },
        ],
        generalTargets: {
            che_포상: [
                { value: 8, label: '손권 (오 · 단양)' },
                { value: 10, label: '여포NPC (오 · 단양)' },
            ],
        },
        crewTypes: [{ value: 1100, label: '보병' }],
        armTypes: [
            { value: 0, label: '보병' },
            { value: 1, label: '궁병' },
        ],
        nationTypes: [],
        colors: [],
        items: {
            horse: [
                { value: 'None', label: '판매/해제' },
                { value: 'che_명마_01_노기', label: '노기(+1)' },
            ],
        },
        recruitment: {
            techLevel: 1,
            leadership: 70,
            fullLeadership: 70,
            currentCrewTypeId: 1100,
            currentCrewTypeName: '보병',
            crew: 0,
            gold: 1000,
            groups: [
                {
                    armType: 0,
                    armName: '보병',
                    values: [
                        {
                            id: 1200,
                            armType: 0,
                            name: '정예병',
                            available: false,
                            special: true,
                            attack: 10,
                            defence: 10,
                            speed: 10,
                            avoid: 10,
                            baseCost: 10,
                            baseRice: 10,
                            info: [],
                        },
                    ],
                },
            ],
        },
    },
};

void test('Ref getBrief를 상속하는 출병·계략·모병까지 실제 인자 요약으로 표시한다', () => {
    assert.equal(formatReservedCommandBrief('general', 'che_출병', { destCityId: 2 }, table), '【단양】으로 출병');
    assert.equal(formatReservedCommandBrief('general', 'che_화계', { destCityId: 3 }, table), '【업】에 화계실행');
    assert.equal(formatReservedCommandBrief('general', 'che_선동', { destCityId: 2 }, table), '【단양】에 선동실행');
    assert.equal(
        formatReservedCommandBrief('general', 'che_모병', { crewType: 1100, amount: 2400 }, table),
        '【보병】 2400명 모병'
    );
    assert.equal(
        formatReservedCommandBrief('general', 'che_모병', { crewType: 1200, amount: 2500 }, table),
        '【정예병】 2500명 모병'
    );
});

void test('개인·인사·국가 명령의 Ref brief 변형을 보존한다', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
        ['che_이동', { destCityId: 3 }, '【업】으로 이동'],
        ['che_강행', { destCityId: 2 }, '【단양】으로 강행'],
        ['che_첩보', { destCityId: 2 }, '【단양】에 첩보 실행'],
        ['che_임관', { destNationId: 2 }, '【오】로 임관'],
        ['che_등용', { destGeneralId: 9 }, '【조조】를 등용'],
        ['che_장수대상임관', { destGeneralId: 8 }, '【손권】을 따라 임관'],
        ['che_선양', { destGeneralId: 8 }, '【손권】에게 선양'],
        ['che_랜덤임관', {}, '무작위 국가로 임관'],
        ['che_건국', { nationName: '촉한' }, '【촉한】을 건국'],
        ['che_무작위건국', { nationName: '오' }, '【오】를 무작위 도시에 건국'],
        ['che_군량매매', { amount: 500, buyRice: true }, '군량 500을 구입'],
        ['che_헌납', { amount: 300, isGold: false }, '쌀 300을 헌납'],
        ['che_증여', { destGeneralId: 8, amount: 200, isGold: true }, '【손권】에게 금 200을 증여'],
        ['che_징병', { crewType: 1100, amount: 3200 }, '【보병】 3200명 징병'],
        ['che_숙련전환', { srcArmType: 0, destArmType: 1 }, '【보병】숙련을 【궁병】숙련으로 전환'],
        ['che_장비매매', { itemType: 'horse', itemCode: 'None' }, '【명마】를 판매.'],
        ['che_장비매매', { itemType: 'horse', itemCode: 'che_명마_01_노기' }, '【노기(+1)】를 구입'],
    ];
    for (const [action, args, expected] of cases) {
        assert.equal(formatReservedCommandBrief('general', action, args, table), expected, action);
    }
});

void test('국가 명령의 도시·국가·장수·자원 인자를 Ref brief로 표시한다', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
        ['che_발령', { destGeneralId: 8, destCityId: 3 }, '【손권】【업】으로 발령'],
        ['che_부대탈퇴지시', { destGeneralId: 8 }, '【손권】부대 탈퇴 지시'],
        ['che_포상', { destGeneralId: 8, amount: 12000, isGold: true }, '【손권】 금 12,000 포상'],
        ['che_몰수', { destGeneralId: 9, amount: 3400, isGold: false }, '【조조】 쌀 3,400 몰수'],
        [
            'che_물자원조',
            { destNationId: 2, amountList: [12000, 34000] },
            '【오】에게 국고 12,000 병량 34,000 물자 원조',
        ],
        ['che_불가침제의', { destNationId: 2, year: 190, month: 8 }, '【오】에게 190년 8월까지 불가침 제의'],
        ['che_불가침파기제의', { destNationId: 2 }, '【오】에게 불가침 파기 제의'],
        ['che_종전제의', { destNationId: 3 }, '【위】에게 종전 제의'],
        ['che_선전포고', { destNationId: 2 }, '【오】에 선전포고'],
        ['che_급습', { destNationId: 3 }, '【위】에 급습'],
        ['che_이호경식', { destNationId: 2 }, '【오】에 이호경식'],
        ['che_천도', { destCityId: 2 }, '【단양】으로 천도'],
        ['che_백성동원', { destCityId: 3 }, '【업】에 백성 동원'],
        ['che_허보', { destCityId: 2 }, '【단양】에 허보'],
        ['che_수몰', { destCityId: 2 }, '【단양】을 수몰'],
        ['che_초토화', { destCityId: 3 }, '【업】을 초토화'],
        ['che_증축', {}, '수도를 증축'],
        ['che_감축', {}, '수도를 감축'],
        ['che_국기변경', { colorType: 2 }, '【국기】를 변경'],
        ['che_국호변경', { nationName: '진' }, '국호를 【진】으로 변경'],
        ['che_피장파장', { destNationId: 2, commandType: 'che_선전포고' }, '【오】에 【선전포고】 피장파장'],
        ['cr_인구이동', { destCityId: 2, amount: 12000 }, '【단양】으로 12,000명 인구이동'],
    ];
    for (const [action, args, expected] of cases) {
        assert.equal(formatReservedCommandBrief('nation', action, args, table), expected, action);
    }
    assert.equal(
        formatReservedCommandBrief('nation', 'che_포상', { destGeneralId: 10, amount: 300, isGold: false }, table),
        '【여포NPC】 쌀 300 포상'
    );
});

void test('Ref가 getBrief를 재정의하지 않은 명령은 실제 표시명을 유지한다', () => {
    assert.equal(formatReservedCommandBrief('general', '휴식', {}, table), '휴식');
    assert.equal(formatReservedCommandBrief('general', 'che_훈련', {}, table), '훈련');
    assert.equal(formatReservedCommandBrief('nation', 'che_필사즉생', {}, table), '필사즉생');
});
