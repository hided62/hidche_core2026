import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gamePath, gameProfile, gameTrpcRoute } from './gameTestPaths.js';
import { touchDrag } from './touchDrag.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    resolve(repositoryRoot, '../image'),
    resolve(repositoryRoot, '../../image'),
    resolve(repositoryRoot, '../sam_rebuild/image'),
    resolve(repositoryRoot, '../../sam_rebuild/image'),
];
const readImage = async (relativePath: string): Promise<Buffer> => {
    if (relativePath.includes('..')) throw new Error(`Unsafe fixture image path: ${relativePath}`);
    for (const root of imageRoots) {
        try {
            return await readFile(resolve(root, relativePath));
        } catch {
            // Product checkout and feature worktrees have different image-root parents.
        }
    }
    throw new Error(`Fixture image not found: ${relativePath}`);
};
const imageContentType = (relativePath: string): string => {
    if (relativePath.endsWith('.png')) return 'image/png';
    if (relativePath.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
};

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});
const operations = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const inputOptions = {
    cities: [
        { value: 1, label: '업 (아국)' },
        { value: 2, label: '허창 (적국)', description: '적국 · 예주 · 대도시' },
        { value: 3, label: '단양 (오)' },
    ],
    nations: [
        { value: 1, label: '아국', color: '#008000' },
        { value: 2, label: '적국', color: '#800000', description: '수도 허창' },
        { value: 3, label: '불가침국', color: '#000080', description: '수도 단양' },
    ],
    nationTargets: {
        che_물자원조: [
            { value: 2, label: '적국', color: '#800000', availableNow: true, description: '현재 원조 대상 · 교역' },
            {
                value: 3,
                label: '불가침국',
                color: '#000080',
                availableNow: true,
                description: '현재 원조 대상 · 불가침 12턴',
            },
            { value: 1, label: '아국', color: '#008000', availableNow: false, description: '아국은 대상이 아닙니다.' },
        ],
        che_불가침제의: [
            { value: 2, label: '적국', color: '#800000', availableNow: true, description: '현재 제의 가능 · 교역' },
            {
                value: 3,
                label: '불가침국',
                color: '#000080',
                availableNow: true,
                description: '현재 제의 가능 · 불가침 12턴',
            },
            { value: 1, label: '아국', color: '#008000', availableNow: false, description: '아국은 대상이 아닙니다.' },
        ],
        che_선전포고: [
            { value: 2, label: '적국', color: '#800000', availableNow: true, description: '현재 선전포고 가능 · 교역' },
            {
                value: 3,
                label: '불가침국',
                color: '#000080',
                availableNow: false,
                description: '현재 외교 관계에서는 선전포고 불가',
            },
            { value: 1, label: '아국', color: '#008000', availableNow: false, description: '아국은 대상이 아닙니다.' },
        ],
        che_종전제의: [
            {
                value: 2,
                label: '적국',
                color: '#800000',
                availableNow: true,
                description: '현재 종전 제의 가능 · 전쟁 6턴',
            },
            {
                value: 3,
                label: '불가침국',
                color: '#000080',
                availableNow: false,
                description: '전쟁·선포 중인 국가가 아닙니다.',
            },
            { value: 1, label: '아국', color: '#008000', availableNow: false, description: '아국은 대상이 아닙니다.' },
        ],
        che_불가침파기제의: [
            {
                value: 3,
                label: '불가침국',
                color: '#000080',
                availableNow: true,
                description: '현재 불가침 파기 제의 가능 · 불가침 12턴',
            },
            {
                value: 2,
                label: '적국',
                color: '#800000',
                availableNow: false,
                description: '불가침 중인 국가가 아닙니다.',
            },
            { value: 1, label: '아국', color: '#008000', availableNow: false, description: '아국은 대상이 아닙니다.' },
        ],
    },
    generals: [
        { value: 1, label: '장수 (아국 · 업)' },
        { value: 2, label: '관우 (아국 · 업)' },
    ],
    generalTargets: {
        che_포상: [
            {
                value: 1,
                label: '장수 (아국 · 업)',
                gold: 5000,
                rice: 400,
                crew: 500,
                description: '금 5,000 · 쌀 400 · 병력 500 · 탑승 부대 없음',
            },
            {
                value: 2,
                label: '관우 (아국 · 업)',
                gold: 100,
                rice: 4000,
                crew: 1200,
                troopId: 2,
                description: '금 100 · 쌀 4,000 · 병력 1,200 · 탑승 부대 청룡대 (부대장)',
            },
            {
                value: 3,
                label: '여포NPC (아국 · 업)',
                npcState: 2,
                gold: 3000,
                rice: 500,
                crew: 1500,
                troopId: 2,
                description: '금 3,000 · 쌀 500 · 병력 1,500 · 탑승 부대 청룡대',
            },
        ],
        che_몰수: [
            {
                value: 1,
                label: '장수 (아국 · 업)',
                gold: 5000,
                rice: 400,
                crew: 500,
                description: '금 5,000 · 쌀 400 · 병력 500 · 탑승 부대 없음',
            },
            {
                value: 2,
                label: '관우 (아국 · 업)',
                gold: 100,
                rice: 4000,
                crew: 1200,
                troopId: 2,
                description: '금 100 · 쌀 4,000 · 병력 1,200 · 탑승 부대 청룡대 (부대장)',
            },
            {
                value: 3,
                label: '여포NPC (아국 · 업)',
                gold: 3000,
                rice: 500,
                crew: 1500,
                troopId: 2,
                description: '금 3,000 · 쌀 500 · 병력 1,500 · 탑승 부대 청룡대',
            },
        ],
        che_발령: [
            {
                value: 1,
                label: '장수 (아국 · 업)',
                crew: 500,
                description: '금 5,000 · 쌀 400 · 병력 500 · 탑승 부대 없음',
            },
            {
                value: 2,
                label: '관우 (아국 · 업)',
                crew: 1200,
                troopId: 2,
                description: '금 100 · 쌀 4,000 · 병력 1,200 · 탑승 부대 청룡대 (부대장)',
            },
            {
                value: 3,
                label: '여포NPC (아국 · 업)',
                crew: 1500,
                troopId: 2,
                description: '금 3,000 · 쌀 500 · 병력 1,500 · 탑승 부대 청룡대',
            },
        ],
        che_부대탈퇴지시: [
            {
                value: 3,
                label: '여포NPC (아국 · 업)',
                availableNow: true,
                crew: 1500,
                troopId: 2,
                description: '현재 탈퇴 지시 가능 · 병력 1,500 · 탑승 부대 청룡대',
            },
            {
                value: 1,
                label: '장수 (아국 · 업)',
                availableNow: false,
                crew: 500,
                description: '현재 탈퇴 지시 불가 · 탑승 부대 없음',
            },
            {
                value: 2,
                label: '관우 (아국 · 업)',
                availableNow: false,
                crew: 1200,
                troopId: 2,
                description: '현재 탈퇴 지시 불가 · 탑승 부대 청룡대 (부대장)',
            },
        ],
    },
    crewTypes: [{ value: 1100, label: '보병' }],
    armTypes: [{ value: 1, label: '보병' }],
    nationTypes: [{ value: 'che_도적', label: '도적', description: '금 수입 증가, 쌀 수입 감소' }],
    colors: [{ value: 0, label: '색상 1', color: '#ff0000' }],
    items: { horse: [{ value: 'None', label: '판매/해제' }] },
    recruitment: {
        techLevel: 1,
        leadership: 68,
        fullLeadership: 70,
        currentCrewTypeId: 1100,
        currentCrewTypeName: '보병',
        crew: 500,
        gold: 12_345,
        groups: [
            {
                armType: 1,
                armName: '보병',
                values: [
                    {
                        id: 1100,
                        armType: 1,
                        name: '보병',
                        available: true,
                        special: false,
                        attack: 125,
                        defence: 175,
                        speed: 7,
                        avoid: 10,
                        baseCost: 10.35,
                        baseRice: 10.35,
                        info: ['표준적인 보병입니다.', '보병은 방어특화입니다.'],
                    },
                    {
                        id: 1101,
                        armType: 1,
                        name: '정예병',
                        available: false,
                        special: true,
                        attack: 175,
                        defence: 225,
                        speed: 8,
                        avoid: 20,
                        baseCost: 13.8,
                        baseRice: 11.5,
                        info: ['강력하지만 기술이 필요합니다.'],
                    },
                ],
            },
        ],
    },
    amountPresets: {
        che_포상: { values: [100, 500, 1000, 5000, 10000], defaultValue: 1000, min: 100, max: 10000, step: 1 },
        che_몰수: { values: [100, 500, 1000, 5000, 10000], defaultValue: 1000, min: 100, max: 10000, step: 1 },
        che_물자원조: { values: [10000, 20000, 30000], defaultValue: 1000, min: 1000, max: 30000, step: 10 },
    },
    context: {
        actorGold: 1000,
        actorRice: 1000,
        citySecurity: 500,
        nationGold: 5000,
        nationRice: 6000,
        nationLevel: 1,
    },
};
const buildCityCommand = (key: string, name: string) => ({
    key,
    name,
    reqArg: true,
    possible: true,
    status: 'needsInput',
    inputFields: [{ key: 'destCityId', label: '대상 도시', kind: 'select', required: true, optionSource: 'cities' }],
});
const buildNationCommand = (key: string, name: string) => ({
    key,
    name,
    reqArg: true,
    possible: true,
    status: 'needsInput',
    inputFields: [{ key: 'destNationId', label: '대상 국가', kind: 'select', required: true, optionSource: 'nations' }],
});
const buildGeneralCommand = (key: string, name: string) => ({
    key,
    name,
    reqArg: true,
    possible: true,
    status: 'needsInput',
    inputFields: [
        { key: 'destGeneralId', label: '대상 장수', kind: 'select', required: true, optionSource: 'generals' },
    ],
});
const buildSimpleCommand = (key: string, name: string, turnDurationText?: string) => ({
    key,
    name,
    ...(turnDurationText ? { turnDurationText } : {}),
    reqArg: false,
    possible: true,
    status: 'available',
    inputFields: [],
});
const commandTable = {
    general: [
        {
            category: '계략',
            values: [
                {
                    key: 'che_화계',
                    name: '화계',
                    reqArg: true,
                    possible: false,
                    status: 'blocked',
                    reason: '현재 조건에서는 실행할 수 없습니다.',
                    inputFields: [
                        {
                            key: 'destCityId',
                            label: '대상 도시',
                            kind: 'select',
                            required: true,
                            optionSource: 'cities',
                        },
                    ],
                },
                ...[
                    { key: 'che_선동', name: '선동' },
                    { key: 'che_탈취', name: '탈취' },
                    { key: 'che_파괴', name: '파괴' },
                ].map(({ key, name }) => ({
                    key,
                    name,
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        {
                            key: 'destCityId',
                            label: '대상 도시',
                            kind: 'select',
                            required: true,
                            optionSource: 'cities',
                        },
                    ],
                })),
            ],
        },
        {
            category: '내정',
            values: [
                {
                    key: 'che_징병',
                    name: '징병',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        { key: 'crewType', label: '병종', kind: 'select', required: true, optionSource: 'crewTypes' },
                        { key: 'amount', label: '수량', kind: 'number', required: true, min: 0, step: 1 },
                    ],
                },
                {
                    key: 'che_모병',
                    name: '모병',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        { key: 'crewType', label: '병종', kind: 'select', required: true, optionSource: 'crewTypes' },
                        { key: 'amount', label: '수량', kind: 'number', required: true, min: 0, step: 1 },
                    ],
                },
            ],
        },
        {
            category: '군사',
            values: [
                {
                    key: 'che_출병',
                    name: '출병',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        {
                            key: 'destCityId',
                            label: '대상 도시',
                            kind: 'select',
                            required: true,
                            optionSource: 'cities',
                        },
                    ],
                },
                {
                    key: 'che_첩보',
                    name: '첩보',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        {
                            key: 'destCityId',
                            label: '대상 도시',
                            kind: 'select',
                            required: true,
                            optionSource: 'cities',
                        },
                    ],
                },
            ],
        },
    ],
    nation: [
        {
            category: '인사',
            values: [
                {
                    ...buildGeneralCommand('che_발령', '발령'),
                    inputFields: [
                        ...buildGeneralCommand('che_발령', '발령').inputFields,
                        ...buildCityCommand('che_발령', '발령').inputFields,
                    ],
                },
                {
                    key: 'che_포상',
                    name: '포상',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        { key: 'isGold', label: '물자', kind: 'boolean', required: true },
                        { key: 'amount', label: '수량', kind: 'number', required: true, min: 0, step: 1 },
                        {
                            key: 'destGeneralId',
                            label: '대상 장수',
                            kind: 'select',
                            required: true,
                            optionSource: 'generals',
                        },
                    ],
                },
                {
                    key: 'che_몰수',
                    name: '몰수',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        { key: 'isGold', label: '물자', kind: 'boolean', required: true },
                        { key: 'amount', label: '수량', kind: 'number', required: true, min: 0, step: 1 },
                        ...buildGeneralCommand('che_몰수', '몰수').inputFields,
                    ],
                },
                buildGeneralCommand('che_부대탈퇴지시', '부대 탈퇴 지시'),
            ],
        },
        {
            category: '외교',
            values: [
                {
                    key: 'che_물자원조',
                    name: '원조',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        ...buildNationCommand('che_물자원조', '원조').inputFields,
                        {
                            key: 'amountList',
                            label: '지원 물자',
                            kind: 'numberTuple',
                            required: true,
                            min: 0,
                            step: 1,
                            tupleLabels: ['금', '쌀'],
                        },
                    ],
                },
                buildNationCommand('che_불가침제의', '불가침 제의'),
                buildNationCommand('che_선전포고', '선전포고'),
                buildNationCommand('che_종전제의', '종전 제의'),
                buildNationCommand('che_불가침파기제의', '불가침 파기 제의'),
            ],
        },
        {
            category: '특수',
            values: [
                buildCityCommand('che_초토화', '초토화'),
                buildCityCommand('che_천도', '천도'),
                buildSimpleCommand('che_증축', '증축'),
                buildSimpleCommand('che_감축', '감축'),
            ],
        },
        {
            category: '전략',
            values: [
                buildCityCommand('che_백성동원', '백성동원'),
                buildCityCommand('che_수몰', '수몰'),
                buildCityCommand('che_허보', '허보'),
                buildNationCommand('che_이호경식', '이호경식'),
                buildNationCommand('che_급습', '급습'),
                {
                    ...buildNationCommand('che_피장파장', '피장파장'),
                    inputFields: [
                        ...buildNationCommand('che_피장파장', '피장파장').inputFields,
                        {
                            key: 'commandType',
                            label: '대응 명령',
                            kind: 'select',
                            required: true,
                            options: [{ value: 'che_수몰', label: '수몰' }],
                        },
                    ],
                },
            ],
        },
    ],
    inputOptions,
};
const basicRecruitmentCrewTypes = [
    {
        id: 1100,
        armType: 1,
        name: '보병',
        attack: 100,
        defence: 150,
        speed: 7,
        avoid: 10,
        baseCost: 9,
        baseRice: 9,
        info: ['표준적인 보병입니다.'],
    },
    {
        id: 1200,
        armType: 2,
        name: '궁병',
        attack: 100,
        defence: 100,
        speed: 7,
        avoid: 20,
        baseCost: 10,
        baseRice: 10,
        info: ['표준적인 궁병입니다.'],
    },
    {
        id: 1300,
        armType: 3,
        name: '기병',
        attack: 150,
        defence: 100,
        speed: 7,
        avoid: 5,
        baseCost: 11,
        baseRice: 11,
        info: ['표준적인 기병입니다.'],
    },
    {
        id: 1400,
        armType: 4,
        name: '귀병',
        attack: 80,
        defence: 80,
        speed: 7,
        avoid: 5,
        baseCost: 9,
        baseRice: 9,
        info: ['계략을 사용하는 병종입니다.'],
    },
].map((crewType) => ({ ...crewType, available: true, special: false }));
const fourArmRecruitmentCommandTable = {
    ...commandTable,
    inputOptions: {
        ...inputOptions,
        crewTypes: basicRecruitmentCrewTypes.map((crewType) => ({ value: crewType.id, label: crewType.name })),
        recruitment: {
            ...inputOptions.recruitment,
            groups: basicRecruitmentCrewTypes.map((crewType) => ({
                armType: crewType.armType,
                armName: crewType.name,
                values: [crewType],
            })),
        },
    },
};
const refChiefCommandTable = {
    general: [],
    nation: [
        { category: '휴식', values: [buildSimpleCommand('휴식', '휴식')] },
        {
            category: '인사',
            values: [
                buildSimpleCommand('che_발령', '발령'),
                buildSimpleCommand('che_포상', '포상'),
                buildSimpleCommand('che_몰수', '몰수'),
                buildSimpleCommand('che_부대탈퇴지시', '부대 탈퇴 지시'),
            ],
        },
        {
            category: '외교',
            values: [
                buildSimpleCommand('che_물자원조', '원조'),
                buildSimpleCommand('che_불가침제의', '불가침 제의'),
                buildSimpleCommand('che_선전포고', '선전포고'),
                buildSimpleCommand('che_종전제의', '종전 제의'),
                buildSimpleCommand('che_불가침파기제의', '불가침 파기 제의'),
            ],
        },
        {
            category: '특수',
            values: [
                buildSimpleCommand('che_초토화', '초토화', '3턴'),
                buildSimpleCommand('che_천도', '천도', '1+거리×2턴'),
                buildSimpleCommand('che_증축', '증축', '6턴'),
                buildSimpleCommand('che_감축', '감축', '6턴'),
            ],
        },
        {
            category: '전략',
            values: [
                buildSimpleCommand('che_필사즉생', '필사즉생', '3턴'),
                buildSimpleCommand('che_백성동원', '백성동원'),
                buildSimpleCommand('che_수몰', '수몰', '3턴'),
                buildSimpleCommand('che_허보', '허보', '2턴'),
                buildSimpleCommand('che_의병모집', '의병모집', '3턴'),
                buildSimpleCommand('che_이호경식', '이호경식'),
                buildSimpleCommand('che_급습', '급습'),
                buildSimpleCommand('che_피장파장', '피장파장', '2턴'),
            ],
        },
        {
            category: '기타',
            values: [buildSimpleCommand('che_국기변경', '국기변경'), buildSimpleCommand('che_국호변경', '국호변경')],
        },
    ],
    inputOptions,
};
const generalContext = {
    general: {
        id: 1,
        name: '장수',
        nationId: 1,
        cityId: 1,
        officerLevel: 5,
        npcState: 0,
        troopId: 0,
        picture: null,
        imageServer: 0,
        stats: { leadership: 70, strength: 60, intelligence: 50 },
        gold: 1000,
        rice: 1000,
        crew: 500,
        train: 90,
        atmos: 90,
        injury: 0,
        experience: 0,
        dedication: 0,
        items: { horse: 'None', weapon: 'None', book: 'None', item: 'None' },
        turnTime: '2026-08-17T12:00:00.000Z',
    },
    city: {
        id: 1,
        name: '업',
        level: 8,
        levelName: '특',
        region: 1,
        regionName: '하북',
        nationId: 1,
        nationName: '아국',
        population: 1000,
        populationMax: 2000,
        agriculture: 100,
        agricultureMax: 200,
        commerce: 100,
        commerceMax: 200,
        security: 100,
        securityMax: 200,
        trust: 70,
        trade: 100,
        defence: 100,
        defenceMax: 200,
        wall: 100,
        wallMax: 200,
        supplyState: 1,
        frontState: 0,
    },
    nation: {
        id: 1,
        name: '아국',
        color: '#008000',
        level: 1,
        gold: 5000,
        rice: 6000,
        tech: 100,
        typeName: '중립',
        typePros: '',
        typeCons: '',
        population: { cityCount: 1, current: 1000, max: 2000 },
        crew: { generalCount: 2, current: 500, max: 7000 },
        power: 1234,
        bill: 100,
        taxRate: 20,
        strategicCommandLimit: 0,
        diplomaticLimit: 0,
        prohibitScout: false,
        prohibitWar: false,
        techLevel: 1,
        techLimited: false,
        topChiefs: {},
        impossibleStrategicCommands: [],
    },
    settings: {},
    penalties: {},
};
const turns = (count: number) => Array.from({ length: count }, (_, index) => ({ index, action: '휴식', args: {} }));
const chiefCenter = {
    me: { id: 1, officerLevel: 5, nationId: 1 },
    nation: { id: 1, name: '아국', level: 1 },
    currentYear: 200,
    currentMonth: 1,
    turnTermMinutes: 10,
    maxTurns: 12,
    chiefs: [12, 10, 8, 6, 11, 9, 7, 5].map((officerLevel) => ({
        officerLevel,
        name: officerLevel === 5 ? '장수' : `수뇌${officerLevel}`,
        npcState: officerLevel === 8 ? 2 : 0,
        turnTime: null,
        revision: 0,
        turns:
            officerLevel === 12
                ? [
                      { index: 0, action: 'che_포상', args: { destGeneralId: 2, isGold: false, amount: 300 } },
                      ...turns(11).map((turn) => ({ ...turn, index: turn.index + 1 })),
                  ]
                : turns(12),
    })),
};

const install = async (
    page: Page,
    rejectGeneral = false,
    commandTableResponse: unknown = commandTable,
    generalId = 1
) => {
    const requests: unknown[] = [];
    const currentGeneralContext = {
        ...generalContext,
        general: { ...generalContext.general, id: generalId },
    };
    const generalTurns = turns(30);
    const nationTurns = turns(12);
    let generalRevision = 0;
    let nationRevision = 0;
    let dashboardLoaded = false;
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            dashboardLoaded = false;
        }
    });
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_commands');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route('**/image/**', async (route) => {
        const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/image/')[1] ?? '');
        await route.fulfill({
            status: 200,
            contentType: imageContentType(relativePath),
            body: await readImage(relativePath),
        });
    });
    await page.route('**/game/**', async (route) => {
        const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/game/')[1] ?? '');
        try {
            await route.fulfill({
                status: 200,
                contentType: imageContentType(relativePath),
                body: await readImage(`game/${relativePath}`),
            });
        } catch {
            await route.fulfill({ status: 404, body: '' });
        }
    });
    await page.route(gameTrpcRoute, async (route) => {
        const names = operations(route);
        const body = route.request().postDataJSON();
        const results = names.map((name) => {
            if (name === 'dashboard.getContextBundleDelta') {
                const initial = !dashboardLoaded;
                dashboardLoaded = true;
                return response({
                    context: initial
                        ? {
                              kind: 'snapshot',
                              revision: 'AAAAAAAAAAAAAAAAAAAAAA',
                              data: currentGeneralContext,
                          }
                        : { kind: 'unchanged', revision: 'AAAAAAAAAAAAAAAAAAAAAA' },
                    commandTable: initial
                        ? {
                              kind: 'snapshot',
                              revision: 'BBBBBBBBBBBBBBBBBBBBBB',
                              data: commandTableResponse,
                          }
                        : { kind: 'unchanged', revision: 'BBBBBBBBBBBBBBBBBBBBBB' },
                    boardAccess: initial
                        ? {
                              kind: 'snapshot',
                              revision: 'CCCCCCCCCCCCCCCCCCCCCC',
                              data: { permission: 4, canMeeting: true, canSecret: true },
                          }
                        : { kind: 'unchanged', revision: 'CCCCCCCCCCCCCCCCCCCCCC' },
                });
            }
            if (name === 'general.me') return response(currentGeneralContext);
            if (name === 'world.getMapLayout')
                return response({
                    mapName: 'che',
                    cityList: [
                        { id: 1, name: '업', level: 8, region: 1, x: 100, y: 100, path: [2] },
                        { id: 2, name: '허창', level: 7, region: 2, x: 240, y: 180, path: [1] },
                    ],
                    regionMap: { 1: '하북', 2: '예주' },
                    levelMap: { 8: '특', 7: '대' },
                });
            if (name === 'auth.status') return response({ ok: true });
            if (name === 'lobby.info')
                return response({
                    myGeneral: { id: generalId, name: '장수' },
                    year: 200,
                    month: 1,
                    turnTerm: 10,
                    userCnt: 1,
                    maxUserCnt: 100,
                    npcCnt: 0,
                    nationCnt: 2,
                });
            if (name === 'join.getConfig') return response({});
            if (name === 'world.getMap') {
                requests.push({ operation: name, body });
                return response({
                    result: true,
                    version: 0,
                    startYear: 180,
                    year: 200,
                    month: 1,
                    cityList: [
                        [1, 8, 0, 1, 1, 1],
                        [2, 7, 41, 2, 2, 1],
                    ],
                    nationList: [
                        [1, '아국', '#008000', 1],
                        [2, '적국', '#800000', 2],
                    ],
                    spyList: {},
                    shownByGeneralList: [],
                    myCity: 1,
                    myNation: 1,
                });
            }
            if (name === 'turns.getCommandTable') return response(commandTableResponse);
            if (name === 'nation.getChiefCenter') return response(chiefCenter);
            if (name === 'turns.reserved.getGeneral')
                return response({ turns: generalTurns, revision: generalRevision, autorunLimit: 2403 });
            if (name === 'turns.reserved.getNation') return response({ turns: nationTurns, revision: nationRevision });
            if (name === 'general.getRecentRecords') return response({ global: [], general: [], history: [] });
            if (name === 'general.getFrontStatus')
                return response({
                    onlineUserCount: 1,
                    onlineNations: '아국(1)',
                    onlineGenerals: '장수',
                    nationNotice: '',
                    lastExecuted: null,
                    latestVote: null,
                });
            if (name === 'messages.getRecent')
                return response({
                    private: [],
                    national: [],
                    public: [],
                    diplomacy: [],
                    sequence: -1,
                    hasMore: { private: false, national: false, public: false, diplomacy: false },
                    latestRead: { private: 0, diplomacy: 0 },
                    canRespondDiplomacy: false,
                });
            if (name === 'messages.getContacts') return response({ nation: [] });
            if (name === 'board.getAccess') return response({ canMeeting: false, canSecret: false });
            if (name === 'tournament.getState') return response({ stage: 0 });
            if (name === 'turns.reserved.setGeneralBulk') {
                requests.push(body);
                if (rejectGeneral) return errorResponse(name, '대상 도시를 선택할 수 없습니다.');
                const input = (
                    body as Record<string, { entries: Array<{ turnList: number[]; action: string; args?: unknown }> }>
                )[String(names.indexOf(name))];
                for (const entry of input?.entries ?? []) {
                    for (const index of entry.turnList)
                        generalTurns[index] = { index, action: entry.action, args: entry.args ?? {} };
                }
                generalRevision += 1;
                return response({ ok: true, revision: generalRevision, turns: generalTurns, autorunLimit: 2403 });
            }
            if (name === 'turns.reserved.setNationBulk') {
                requests.push(body);
                const input = (
                    body as Record<string, { entries: Array<{ turnList: number[]; action: string; args?: unknown }> }>
                )[String(names.indexOf(name))];
                for (const entry of input?.entries ?? []) {
                    for (const index of entry.turnList)
                        nationTurns[index] = { index, action: entry.action, args: entry.args ?? {} };
                }
                nationRevision += 1;
                return response({ ok: true, revision: nationRevision, turns: nationTurns });
            }
            return errorResponse(name, `unhandled ${name}`);
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return requests;
};

test('renders and accepts every Ref strategy command at mobile width', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();

    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '계략', exact: true }).click();
    const strategies = [
        { name: '선동', guidance: '선택한 도시에 선동을 실행합니다.' },
        { name: '탈취', guidance: '선택한 도시에 탈취를 실행합니다.' },
        { name: '파괴', guidance: '선택한 도시에 파괴를 실행합니다.' },
        { name: '화계', guidance: '선택한 도시에 화계를 실행합니다.' },
    ];
    for (const strategy of strategies) {
        const button = picker.getByRole('button', { name: strategy.name, exact: true });
        await expect(button).toBeVisible();
        await button.click();
        const form = picker.getByTestId('command-argument-form');
        await expect(form.getByTestId('command-argument-guidance')).toContainText(strategy.guidance);
        await expect(form.locator('select option')).toHaveCount(3);
        await picker.getByRole('button', { name: '명령 다시 선택', exact: true }).click();
    }
    await picker.screenshot({ path: test.info().outputPath('all-strategy-commands-mobile.png') });
});

test('shows and reserves the Ref spy command for a user on desktop and mobile', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');
    const editor = page.locator('[data-command-scope="general"]');
    await editor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();

    let picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '군사', exact: true }).click();
    const spy = picker.getByRole('button', { name: '첩보', exact: true });
    await expect(spy).toBeVisible();
    await spy.hover();
    await spy.focus();
    await expect(spy).toBeFocused();
    await spy.click();
    const form = picker.getByTestId('command-argument-form');
    await expect(form.getByTestId('command-argument-guidance')).toContainText('선택한 도시에 첩보를 실행합니다.');
    await expect(form.getByTestId('command-argument-guidance')).toContainText(
        '인접 도시에서는 더 많은 정보를 얻습니다.'
    );
    await form.locator('select').selectOption('2');
    await picker.screenshot({ path: test.info().outputPath('spy-command-desktop-1200.png') });
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(editor.locator('.action-column > div').first()).toHaveText('【허창】에 첩보 실행');
    expect(JSON.stringify(requests)).toContain('"action":"che_첩보","args":{"destCityId":2}');

    await page.setViewportSize({ width: 500, height: 900 });
    await editor.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '군사', exact: true }).click();
    await expect(picker.getByRole('button', { name: '첩보', exact: true })).toBeVisible();
    const geometry = await picker.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        horizontalOverflow: element.scrollWidth - element.clientWidth,
    }));
    expect(geometry.width).toBeLessThanOrEqual(500);
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
    await picker.screenshot({ path: test.info().outputPath('spy-command-mobile-500.png') });
});

test('defaults founding to a Ref-selectable nation trait and opens colored options inside the app', async ({
    page,
}) => {
    const foundingColors = [
        { value: 0, label: '색상 1', color: '#FF0000' },
        { value: 15, label: '색상 16', color: '#6495ED' },
        { value: 16, label: '색상 17', color: '#7FFFD4' },
    ];
    const foundingCommandTable = {
        general: [
            {
                category: '국가',
                values: [
                    {
                        key: 'che_건국',
                        name: '건국',
                        reqArg: true,
                        possible: true,
                        status: 'needsInput',
                        inputFields: [
                            { key: 'nationName', label: '국가명', kind: 'text', required: true, min: 1, max: 18 },
                            {
                                key: 'nationType',
                                label: '국가 성향',
                                kind: 'select',
                                required: true,
                                optionSource: 'nationTypes',
                            },
                            {
                                key: 'colorType',
                                label: '국기 색상',
                                kind: 'select',
                                required: true,
                                optionSource: 'colors',
                            },
                        ],
                    },
                ],
            },
        ],
        nation: [],
        inputOptions: { ...inputOptions, colors: foundingColors },
    };
    const requests = await install(page, false, foundingCommandTable);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();

    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '국가', exact: true }).click();
    await picker.getByRole('button', { name: '건국', exact: true }).click();
    const nationType = picker.getByLabel('국가 성향');
    await expect(nationType).toHaveValue('che_도적');
    await expect(nationType.locator('option[value="che_중립"]')).toHaveCount(0);
    await expect(nationType.locator('option')).toHaveText(['도적']);
    await nationType.focus();
    await expect(nationType).toBeFocused();

    const colorType = picker.getByLabel('국기 색상');
    await expect(colorType).toHaveRole('button');
    await colorType.click();
    const colorList = picker.getByRole('listbox');
    const color16 = colorList.getByRole('option', { name: '색상 16' });
    await expect(color16).toHaveText('색상 16');
    await expect(color16).toHaveCSS('background-color', 'rgb(100, 149, 237)');
    await expect(color16).toHaveCSS('color', 'rgb(255, 255, 255)');
    await color16.hover();
    await color16.focus();
    await expect(color16).toBeFocused();
    await color16.press('Escape');
    await expect(colorList).toBeHidden();
    await expect(colorType).toBeFocused();
    await colorType.click();
    await color16.click();
    await expect(colorType).toContainText('색상 16');
    await expect(colorType).toHaveCSS('background-color', 'rgb(100, 149, 237)');
    await expect(colorType).toHaveCSS('color', 'rgb(255, 255, 255)');
    await colorType.press('ArrowDown');
    await page.getByRole('option', { name: '색상 17' }).press('Enter');
    await expect(colorType).toHaveCSS('background-color', 'rgb(127, 255, 212)');
    await expect(colorType).toHaveCSS('color', 'rgb(0, 0, 0)');
    await colorType.press('ArrowUp');
    await page.getByRole('option', { name: '색상 16' }).press('Enter');
    await picker.screenshot({ path: test.info().outputPath('founding-colored-option-desktop-1200.png') });

    await page.setViewportSize({ width: 500, height: 900 });
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const mobilePicker = page.getByTestId('command-picker');
    await mobilePicker.getByRole('button', { name: '국가', exact: true }).click();
    await mobilePicker.getByRole('button', { name: '건국', exact: true }).click();
    await mobilePicker.getByLabel('국가명').fill('신국');
    const mobileColorType = mobilePicker.getByLabel('국기 색상');
    await mobileColorType.click();
    const mobileColorList = mobilePicker.getByRole('listbox');
    const mobileColor16 = mobileColorList.getByRole('option', { name: '색상 16' });
    await expect(mobileColor16).toBeVisible();
    await expect(mobileColor16).toHaveCSS('background-color', 'rgb(100, 149, 237)');
    await expect(mobileColor16).toHaveCSS('color', 'rgb(255, 255, 255)');
    const mobileOptionRect = await mobileColor16.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(mobileOptionRect.height).toBeGreaterThanOrEqual(44);
    const mobileListGeometry = await mobileColorList.evaluate((element) => ({
        bottom: element.getBoundingClientRect().bottom,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
    }));
    const mobilePickerBottom = await mobilePicker.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(mobileListGeometry.bottom).toBeLessThanOrEqual(mobilePickerBottom);
    expect(mobileListGeometry.scrollHeight).toBeGreaterThanOrEqual(mobileListGeometry.clientHeight);
    await mobilePicker.screenshot({ path: test.info().outputPath('founding-color-options-open-mobile-500.png') });
    await mobileColor16.click();
    await expect(mobileColorType).toContainText('색상 16');
    await expect(mobileColorType).toHaveCSS('background-color', 'rgb(100, 149, 237)');
    await expect(mobileColorType).toHaveCSS('color', 'rgb(255, 255, 255)');
    const colorSelectRect = await mobileColorType.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(colorSelectRect.x).toBeGreaterThanOrEqual(0);
    expect(colorSelectRect.right).toBeLessThanOrEqual(500);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(500);
    await mobilePicker.screenshot({ path: test.info().outputPath('founding-colored-option-mobile-500.png') });
    await mobilePicker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="general"] .action-column > div').first()).toContainText('신국');
    await expect.poll(() => JSON.stringify(requests)).toContain('"colorType":15');
});

test('reserves force move, retirement, and resignation from the user command picker', async ({ page }) => {
    const specialCommandTable = {
        general: [
            {
                category: '개인',
                values: [
                    {
                        key: 'che_은퇴',
                        name: '은퇴',
                        reqArg: false,
                        possible: false,
                        status: 'blocked',
                        reason: '나이가 60세 이상이어야 합니다.',
                        inputFields: [],
                    },
                ],
            },
            {
                category: '인사',
                values: [
                    {
                        key: 'che_강행',
                        name: '강행',
                        reqArg: true,
                        possible: true,
                        status: 'available',
                        inputFields: [
                            {
                                key: 'destCityId',
                                label: '대상 도시',
                                kind: 'select',
                                required: true,
                                optionSource: 'cities',
                            },
                        ],
                    },
                ],
            },
            {
                category: '국가',
                values: [
                    {
                        key: 'che_하야',
                        name: '하야',
                        reqArg: false,
                        possible: true,
                        status: 'available',
                        inputFields: [],
                    },
                ],
            },
        ],
        nation: [],
        inputOptions,
    };
    const requests = await install(page, false, specialCommandTable);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    const editor = page.locator('[data-command-scope="general"]');

    await editor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    let picker = page.getByTestId('command-picker');
    const retirement = picker.getByRole('button', { name: '은퇴', exact: true });
    await expect(retirement).toHaveClass(/blocked/);
    await expect(retirement).toHaveAttribute('title', '나이가 60세 이상이어야 합니다.');
    await retirement.hover();
    await retirement.focus();
    await expect(retirement).toBeFocused();
    await picker.screenshot({ path: test.info().outputPath('special-user-commands-desktop-1200.png') });
    await retirement.click();
    await expect(editor.locator('.action-column > div').nth(0)).toHaveText('은퇴');

    await editor.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '국가', exact: true }).click();
    await picker.getByRole('button', { name: '하야', exact: true }).click();
    await expect(editor.locator('.action-column > div').nth(1)).toHaveText('하야');

    await editor.getByRole('button', { name: '3턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '인사', exact: true }).click();
    await picker.getByRole('button', { name: '강행', exact: true }).click();
    const forceMoveForm = picker.getByTestId('command-argument-form');
    await expect(forceMoveForm.getByTestId('command-argument-guidance')).toContainText('선택한 도시로 강행합니다.');
    await forceMoveForm.locator('select').selectOption('2');
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(editor.locator('.action-column > div').nth(2)).toHaveText('【허창】으로 강행');

    const serialized = JSON.stringify(requests);
    expect(serialized).toContain('"action":"che_은퇴","args":{}');
    expect(serialized).toContain('"action":"che_하야","args":{}');
    expect(serialized).toContain('"action":"che_강행","args":{"destCityId":2}');

    await page.setViewportSize({ width: 500, height: 900 });
    await editor.getByRole('button', { name: '4턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await expect(picker.locator('.category-btn')).toHaveText(['개인', '인사', '국가']);
    const mobileGeometry = await picker.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        categoryColumns: getComputedStyle(element.querySelector<HTMLElement>('.category-list')!).gridTemplateColumns,
    }));
    expect(mobileGeometry.width).toBeLessThanOrEqual(500);
    expect(mobileGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mobileGeometry.categoryColumns.split(' ')).toHaveLength(3);
    await picker.getByRole('button', { name: '개인', exact: true }).click();
    await expect(picker.getByRole('button', { name: '은퇴', exact: true })).toBeVisible();
    await picker.screenshot({ path: test.info().outputPath('special-user-commands-mobile-500.png') });
});

test('shows every Ref chief command in the exact category and command order', async ({ page }) => {
    await install(page, false, refChiefCommandTable);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/che/chief-center');

    const editor = page.locator('[data-command-scope="nation"]');
    await editor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    const expected = {
        휴식: ['휴식'],
        인사: ['발령', '포상', '몰수', '부대 탈퇴 지시'],
        외교: ['원조', '불가침 제의', '선전포고', '종전 제의', '불가침 파기 제의'],
        특수: ['초토화', '천도', '증축', '감축'],
        전략: ['필사즉생', '백성동원', '수몰', '허보', '의병모집', '이호경식', '급습', '피장파장'],
        기타: ['국기변경', '국호변경'],
    } as const;

    await expect(picker.locator('.category-btn')).toHaveText(Object.keys(expected));
    for (const [category, commands] of Object.entries(expected)) {
        await picker.locator('.category-btn').filter({ hasText: category }).click();
        await expect(picker.locator('.command-grid .command-name')).toHaveText([...commands]);
    }
    await picker.getByRole('button', { name: '특수', exact: true }).click();
    await expect(picker.locator('.command-grid .command-item')).toHaveText([
        '초토화 /3턴',
        '천도 /1+거리×2턴',
        '증축 /6턴',
        '감축 /6턴',
    ]);
    const durationGeometry = await picker.locator('.command-grid .command-item').evaluateAll((buttons) =>
        buttons.map((button) => ({
            text: button.textContent?.replace(/\s/g, ''),
            height: button.getBoundingClientRect().height,
            overflow: button.scrollWidth - button.clientWidth,
        }))
    );
    expect(durationGeometry.every(({ height, overflow }) => height >= 35 && overflow <= 0)).toBe(true);
    await picker.getByRole('button', { name: '기타', exact: true }).click();
    const rename = picker.getByRole('button', { name: '국호변경', exact: true });
    await rename.hover();
    await rename.focus();
    await expect(rename).toBeFocused();
    await picker.screenshot({ path: test.info().outputPath('ref-chief-command-list-desktop-1200.png') });

    await picker.getByRole('button', { name: '명령 입력 닫기', exact: true }).click();
    await page.setViewportSize({ width: 500, height: 900 });
    const mobileEditor = page.locator('[data-command-scope="nation"]:visible');
    await mobileEditor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const mobilePicker = page.locator('[data-testid="command-picker"]:visible');
    await expect(mobilePicker.locator('.category-btn')).toHaveText(Object.keys(expected));
    const mobileGeometry = await mobilePicker.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        categoryColumns: getComputedStyle(element.querySelector<HTMLElement>('.category-list')!).gridTemplateColumns,
    }));
    expect(mobileGeometry.width).toBeLessThanOrEqual(500);
    expect(mobileGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mobileGeometry.categoryColumns.split(' ')).toHaveLength(3);
    await mobilePicker.getByRole('button', { name: '특수', exact: true }).click();
    const mobileExpand = mobilePicker.getByRole('button', { name: '증축 /6턴', exact: true });
    await expect(mobileExpand).toBeVisible();
    await mobileExpand.hover();
    await mobileExpand.focus();
    await expect(mobileExpand).toBeFocused();
    await mobileExpand.dispatchEvent('pointerdown');
    await expect(mobileExpand.locator('.command-duration')).toHaveText('/6턴');
    await mobileExpand.dispatchEvent('pointerup');
    expect(await mobilePicker.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await mobilePicker.screenshot({ path: test.info().outputPath('ref-chief-command-list-mobile-500.png') });
});

test('keeps general and chief command categories after input and across page reloads', async ({ page, context }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    const generalEditor = page.locator('[data-command-scope="general"]');
    await generalEditor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    let picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '군사', exact: true }).click();
    await picker.getByRole('button', { name: '출병', exact: true }).click();
    await picker.getByTestId('command-argument-form').locator('select').selectOption('3');
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(generalEditor.locator('.action-column > div').first()).toHaveText('【단양】으로 출병');

    await generalEditor.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await expect(picker.getByRole('button', { name: '군사', exact: true })).toHaveClass(/active/);
    await expect(picker.getByRole('button', { name: '출병', exact: true })).toBeVisible();
    await picker.screenshot({ path: test.info().outputPath('general-category-after-input-desktop-1200.png') });
    await picker.getByRole('button', { name: '명령 입력 닫기', exact: true }).click();
    await expect
        .poll(() => page.evaluate(() => localStorage.getItem('core2026:general:1:category')))
        .toBe(JSON.stringify('general:군사'));

    await page.reload();
    const reloadedGeneralEditor = page.locator('[data-command-scope="general"]');
    await reloadedGeneralEditor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const reloadedGeneralPicker = page.getByTestId('command-picker');
    await expect(reloadedGeneralPicker.getByRole('button', { name: '군사', exact: true })).toHaveClass(/active/);
    await expect(reloadedGeneralPicker.getByRole('button', { name: '출병', exact: true })).toBeVisible();
    await reloadedGeneralPicker.screenshot({
        path: test.info().outputPath('general-category-after-reload-desktop-1200.png'),
    });

    const chiefPage = await context.newPage();
    await install(chiefPage, false, refChiefCommandTable);
    await chiefPage.setViewportSize({ width: 500, height: 900 });
    await chiefPage.goto('/che/chief-center');
    const chiefEditor = chiefPage.locator('[data-command-scope="nation"]');
    await chiefEditor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    picker = chiefPage.getByTestId('command-picker');
    await picker.getByRole('button', { name: '전략', exact: true }).click();
    await picker.getByRole('button', { name: '필사즉생', exact: true }).click();
    await expect(chiefEditor.locator('.action-column > div').first()).toHaveText('필사즉생');

    await chiefEditor.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
    picker = chiefPage.getByTestId('command-picker');
    await expect(picker.getByRole('button', { name: '전략', exact: true })).toHaveClass(/active/);
    await expect(picker.getByRole('button', { name: '필사즉생', exact: true })).toBeVisible();
    await picker.screenshot({ path: test.info().outputPath('chief-category-after-input-mobile-500.png') });
    await picker.getByRole('button', { name: '명령 입력 닫기', exact: true }).click();
    await expect
        .poll(() => chiefPage.evaluate(() => localStorage.getItem('core2026:nation:1:5:category')))
        .toBe(JSON.stringify('nation:전략'));
    await chiefPage.reload();
    const reloadedChiefEditor = chiefPage.locator('[data-command-scope="nation"]');
    await reloadedChiefEditor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const reloadedChiefPicker = chiefPage.getByTestId('command-picker');
    await expect(reloadedChiefPicker.getByRole('button', { name: '전략', exact: true })).toHaveClass(/active/);
    await expect(reloadedChiefPicker.getByRole('button', { name: '필사즉생', exact: true })).toBeVisible();
    await expect
        .poll(() => reloadedChiefPicker.evaluate((element) => element.getBoundingClientRect().height))
        .toBeGreaterThan(200);
    await reloadedChiefPicker.screenshot({
        path: test.info().outputPath('chief-category-after-reload-mobile-500.png'),
    });
});

test('keeps the general turn editor mode across general recreation within one server profile', async ({
    page,
    context,
}) => {
    await install(page, false, commandTable, 1);
    await page.addInitScript(() => {
        localStorage.setItem('core2026:general:1:editMode', '1');
    });
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    const profileModeKey = 'core2026:profile:che:general-turn-editor:editMode';
    const firstEditor = page.locator('[data-command-scope="general"]');
    await expect(firstEditor.getByRole('button', { name: '일반 모드', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), profileModeKey)).toBe('1');
    await page.evaluate(() => localStorage.removeItem('core2026:general:1:editMode'));

    const recreatedPage = await context.newPage();
    await install(recreatedPage, false, commandTable, 2);
    await recreatedPage.setViewportSize({ width: 500, height: 900 });
    await recreatedPage.goto('/');
    const recreatedEditor = recreatedPage.locator('[data-command-scope="general"]');
    await expect(recreatedEditor.getByRole('button', { name: '일반 모드', exact: true })).toBeVisible();
    await expect
        .poll(() => recreatedPage.evaluate(() => localStorage.getItem('core2026:general:2:editMode')))
        .toBeNull();
    await recreatedEditor.screenshot({
        path: test.info().outputPath('general-advanced-mode-after-recreation-mobile-500.png'),
    });

    await recreatedEditor.getByRole('button', { name: '일반 모드', exact: true }).click();
    await expect(recreatedEditor.getByRole('button', { name: '고급 모드', exact: true })).toBeVisible();
    await expect.poll(() => recreatedPage.evaluate((key) => localStorage.getItem(key), profileModeKey)).toBe('0');

    const nextGeneralPage = await context.newPage();
    await install(nextGeneralPage, false, commandTable, 3);
    await nextGeneralPage.goto('/');
    await expect(
        nextGeneralPage.locator('[data-command-scope="general"]').getByRole('button', {
            name: '고급 모드',
            exact: true,
        })
    ).toBeVisible();
    await nextGeneralPage.close();
    await recreatedPage.close();
});

test('shows all 12 advanced chief turns before the actions and uses the full mobile chief matrix', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/che/chief-center');

    const editor = page.locator('[data-command-scope="nation"]:visible');
    await editor.getByRole('button', { name: '고급 모드', exact: true }).click();
    await expect(editor.locator('.index-column > button')).toHaveCount(12);
    await expect(editor.locator('.index-column > button').last()).toHaveText('12');
    await expect(editor.locator('.advanced-actions')).toContainText('선택한 턴을');
    await expect(editor.locator('.advanced-actions')).toContainText('명령 선택');

    const frame = page.locator('.chief-overview-frame');
    await expect(frame.locator('.chief-overview-row')).toHaveCount(2);
    await expect(frame.locator('.overview-turn-index')).toHaveCount(4);
    for (const gutter of await frame.locator('.overview-turn-index').all()) {
        await expect(gutter.locator('span').filter({ hasText: /\d+/u })).toHaveText(
            Array.from({ length: 12 }, (_, index) => String(index + 1))
        );
    }
    await expect(frame.locator('.compact-name')).toHaveCount(8);

    const geometry = await page.locator('.chief-page').evaluate((element) => {
        const editorElement = element.querySelector<HTMLElement>('[data-command-scope="nation"]')!;
        const queue = editorElement.querySelector<HTMLElement>('.queue-grid')!;
        const lastTurn = editorElement.querySelectorAll<HTMLElement>('.action-column > div')[11]!;
        const actions = editorElement.querySelector<HTMLElement>('.advanced-actions')!;
        const overviewFrame = element.querySelector<HTMLElement>('.chief-overview-frame')!;
        const firstOverviewRow = element.querySelector<HTMLElement>('.chief-overview-row')!;
        const overviewRows = [...element.querySelectorAll<HTMLElement>('.chief-overview-row')];
        const gutters = [...firstOverviewRow.querySelectorAll<HTMLElement>('.overview-turn-index')];
        const cards = [...firstOverviewRow.querySelectorAll<HTMLElement>('.chief-card')];
        const names = [...overviewFrame.querySelectorAll<HTMLElement>('.compact-name')];
        const frameRect = overviewFrame.getBoundingClientRect();
        const editorRect = editorElement.getBoundingClientRect();
        const actionsRect = actions.getBoundingClientRect();
        return {
            editorBottom: editorRect.bottom,
            editorHeight: editorRect.height,
            queueBottom: queue.getBoundingClientRect().bottom,
            lastTurnBottom: lastTurn.getBoundingClientRect().bottom,
            actionsTop: actionsRect.top,
            actionsBottom: actionsRect.bottom,
            frameTop: frameRect.top,
            frameWidth: frameRect.width,
            rowWidth: firstOverviewRow.getBoundingClientRect().width,
            rowEdges: overviewRows.map((item) => ({
                top: item.getBoundingClientRect().top - frameRect.top,
                bottom: item.getBoundingClientRect().bottom - frameRect.top,
            })),
            gutterWidths: gutters.map((item) => item.getBoundingClientRect().width),
            gutterEdges: gutters.map((item) => ({
                left: item.getBoundingClientRect().left - frameRect.left,
                right: item.getBoundingClientRect().right - frameRect.left,
            })),
            cardWidths: cards.map((item) => item.getBoundingClientRect().width),
            namesInsideFrame: names.every((item) => {
                const rect = item.getBoundingClientRect();
                return rect.top >= frameRect.top && rect.bottom <= frameRect.bottom && rect.height > 0;
            }),
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

    expect(geometry.lastTurnBottom).toBeLessThanOrEqual(geometry.actionsTop);
    expect(geometry.queueBottom).toBeLessThanOrEqual(geometry.actionsTop);
    expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.editorBottom);
    expect(geometry.frameTop).toBeGreaterThanOrEqual(geometry.editorBottom);
    expect(geometry.editorHeight).toBeGreaterThanOrEqual(404);
    expect(geometry.frameWidth).toBe(500);
    expect(geometry.rowWidth).toBe(500);
    expect(geometry.rowEdges).toEqual([
        { top: 0, bottom: 155 },
        { top: 155, bottom: 310 },
    ]);
    expect(geometry.gutterWidths).toEqual([12, 12]);
    expect(geometry.gutterEdges).toEqual([
        { left: 0, right: 12 },
        { left: 488, right: 500 },
    ]);
    expect(geometry.cardWidths).toEqual([119, 119, 119, 119]);
    expect(geometry.namesInsideFrame).toBe(true);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('chief-advanced-mobile-500.png'), fullPage: true });
});

test('keeps the advanced chief return control visible and fills the two-cell bottom row', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/che/chief-center');

    const editor = page.locator('[data-command-scope="nation"]:visible');
    await editor.getByRole('button', { name: '고급 모드', exact: true }).click();
    const modeButton = editor.getByRole('button', { name: '일반 모드', exact: true });
    await expect(modeButton).toBeVisible();

    const geometry = await editor.evaluate((element) => {
        const queue = element.querySelector<HTMLElement>('.queue-area')!;
        const actions = element.querySelector<HTMLElement>('.advanced-actions')!;
        const controls = element.querySelector<HTMLElement>('.control-pad')!;
        const mode = [...controls.querySelectorAll<HTMLButtonElement>(':scope > button')].find(
            (item) => item.textContent?.trim() === '일반 모드'
        )!;
        const clock = controls.querySelector<HTMLElement>(':scope > .clock')!;
        const summary = (label: string) =>
            [...controls.querySelectorAll<HTMLElement>(':scope > details > summary')].find(
                (item) => item.textContent?.trim() === label
            )!;
        const repeat = summary('반복');
        const range = summary('범위');
        const storage = summary('보관함');
        const recent = summary('최근');
        const pull = summary('당기기').closest<HTMLElement>('details')!;
        const push = summary('미루기').closest<HTMLElement>('details')!;
        const rect = (item: HTMLElement) => {
            const box = item.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
        };
        const modeRect = mode.getBoundingClientRect();
        const hit = document.elementFromPoint(modeRect.left + modeRect.width / 2, modeRect.top + modeRect.height / 2);
        return {
            queue: rect(queue),
            actions: rect(actions),
            controls: rect(controls),
            mode: rect(mode),
            firstRow: [rect(mode), rect(clock), rect(repeat)],
            secondRow: [rect(range), rect(storage), rect(recent)],
            bottomRow: [rect(pull), rect(push)],
            modeReceivesPointer: Boolean(hit && mode.contains(hit)),
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

    expect(geometry.queue.bottom).toBeLessThanOrEqual(geometry.actions.top);
    expect(geometry.actions.bottom).toBeLessThanOrEqual(geometry.controls.top);
    expect(geometry.modeReceivesPointer).toBe(true);
    expect(new Set(geometry.firstRow.map(({ top }) => top)).size).toBe(1);
    expect(new Set(geometry.secondRow.map(({ top }) => top)).size).toBe(1);
    expect(geometry.bottomRow[0]?.top).toBe(geometry.bottomRow[1]?.top);
    expect(geometry.bottomRow[0]?.left).toBeCloseTo(geometry.controls.left, 1);
    expect(geometry.bottomRow[1]?.right).toBeCloseTo(geometry.controls.right, 1);
    expect(geometry.bottomRow[0]?.width).toBeCloseTo(geometry.bottomRow[1]?.width ?? 0, 1);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(0);

    await page.screenshot({ path: test.info().outputPath('chief-advanced-controls-desktop-1200.png'), fullPage: true });
    await modeButton.click();
    await expect(editor.locator('.advanced-actions')).toHaveCount(0);
    await expect(editor.getByRole('button', { name: '고급 모드', exact: true })).toBeVisible();
});

test('enters general and nation command arguments and sends exact values', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('current-city-marker')).toHaveCount(0);
    const mainMap = page.locator('[data-main-target="map"]');
    const currentMainCity = mainMap.locator('.city-base.mine');
    await expect(currentMainCity).toHaveAttribute('aria-label', '업, 현재 도시');
    const currentCityHighlight = await currentMainCity.locator('.city-filler.my-city').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            outlineColor: style.outlineColor,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            animationName: style.animationName,
            boxShadow: style.boxShadow,
        };
    });
    expect(currentCityHighlight).toMatchObject({
        outlineColor: 'rgb(211, 47, 47)',
        outlineStyle: 'solid',
        outlineWidth: '2px',
        animationName: 'none',
    });
    expect(currentCityHighlight.boxShadow).toContain('211, 47, 47');
    await mainMap.screenshot({ path: test.info().outputPath('main-map-current-city-static-highlight-desktop.png') });
    await mainMap.locator('.city-base').nth(1).click();
    await expect(page).toHaveURL(/\/current-city\?cityId=2$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/u);
    await expect(page.locator('[data-main-target="map"] .city-base.selected')).toHaveCount(0);

    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    await page.getByTestId('command-picker').getByRole('button', { name: /화계/ }).click();
    const form = page.getByTestId('command-argument-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('command-argument-map')).toBeVisible();
    await expect(form.getByTestId('command-argument-guidance')).toContainText('선택한 도시에 화계를 실행합니다.');
    await expect(form.getByTestId('command-map-target-summary')).toContainText('현재 도시에서 0칸');
    const commandMap = form.getByTestId('command-argument-map');
    const currentCityMarker = commandMap.getByTestId('current-city-marker');
    const selectionStatus = form.getByTestId('command-map-selection-status');
    await expect(currentCityMarker).toHaveText('현재');
    await expect(currentCityMarker).toHaveAttribute('aria-label', '현재 도시 업');
    await expect(selectionStatus).toContainText('현재 도시업');
    await expect(selectionStatus).toContainText('선택 도시업');
    const mapCities = commandMap.locator('.city-base');
    await expect(mapCities).toHaveCount(2);
    await expect(commandMap.locator('.city-bg')).toHaveCount(2);
    await expect(commandMap.locator('.city-flag')).toHaveCount(2);
    await expect(commandMap.locator('.city-state')).toHaveCount(1);
    await expect
        .poll(() =>
            commandMap
                .locator('.city-icon')
                .evaluateAll((images: HTMLImageElement[]) =>
                    images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
                )
        )
        .toBe(true);
    const castleGeometry = await commandMap.locator('.city-icon').evaluateAll((images: HTMLImageElement[]) =>
        images.map((image) => ({
            src: new URL(image.src).pathname,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            renderedWidth: image.getBoundingClientRect().width,
            renderedHeight: image.getBoundingClientRect().height,
        }))
    );
    expect(castleGeometry).toEqual([
        expect.objectContaining({ src: '/game/cast_8.gif', naturalWidth: 32, naturalHeight: 24 }),
        expect.objectContaining({ src: '/game/cast_7.gif', naturalWidth: 28, naturalHeight: 20 }),
    ]);
    for (const castle of castleGeometry) {
        expect(castle.renderedWidth).toBeGreaterThan(castle.naturalWidth * 0.9);
        expect(castle.renderedHeight).toBeGreaterThan(castle.naturalHeight * 0.9);
        expect(castle.renderedWidth / castle.naturalWidth).toBeCloseTo(castle.renderedHeight / castle.naturalHeight, 2);
    }
    const layerStyles = await commandMap.evaluate((element) => ({
        background: getComputedStyle(element.querySelector<HTMLElement>('.map-bglayer1')!).backgroundImage,
        road: getComputedStyle(element.querySelector<HTMLElement>('.map-bgroad')!).backgroundImage,
    }));
    expect(layerStyles.background).toContain('/game/map/che/bg_spring.jpg');
    expect(layerStyles.road).toContain('/game/map/che/che_road.png');
    await mapCities.nth(1).click();
    await expect(form.locator('select')).toHaveValue('2');
    await expect(form.getByTestId('command-map-target-summary')).toContainText('현재 도시에서 1칸');
    await expect(selectionStatus).toContainText('현재 도시업');
    await expect(selectionStatus).toContainText('선택 도시허창');
    await expect(currentCityMarker).toHaveAttribute('aria-label', '현재 도시 업');
    await expect(mapCities.nth(0)).toHaveClass(/mine/);
    await expect(mapCities.nth(1)).toHaveClass(/selected/);
    expect(
        await mapCities
            .nth(1)
            .locator('.city-icon')
            .evaluate((element) => getComputedStyle(element).boxShadow)
    ).toContain('255, 235, 150');
    await mapCities.nth(1).hover();
    expect(await mapCities.nth(1).evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await mapCities.nth(1).focus();
    await expect(mapCities.nth(1)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    await commandMap.screenshot({ path: test.info().outputPath('main-city-current-marker-desktop.png') });
    const mapGeometry = await form.getByTestId('command-argument-map').evaluate((element) => {
        const area = element.querySelector<HTMLElement>('.map-area')!;
        const rect = area.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    await page.getByTestId('command-picker').getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="general"] .action-column > div').first()).toHaveText(
        '【허창】에 화계실행'
    );

    await page.goto(gamePath('/chief-center'));
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const chiefPicker = page.getByTestId('command-picker');
    await chiefPicker.getByRole('button', { name: /^(?:국가:)?인사$/, exact: true }).click();
    await chiefPicker.getByRole('button', { name: /포상/ }).click();
    const chiefForm = chiefPicker.getByTestId('command-argument-form');
    await chiefForm.getByRole('button', { name: '쌀', exact: true }).click();
    await chiefForm.locator('input[type=number]').fill('300');
    const chiefTarget = chiefForm.locator('#command-arg-destGeneralId');
    await expect(chiefTarget.locator('option')).toHaveText([
        '장수 (아국 · 업)',
        '여포NPC (아국 · 업)',
        '관우 (아국 · 업)',
    ]);
    await chiefTarget.selectOption('3');
    const geometry = await chiefForm.evaluate((element) => {
        const row = element.querySelector('.argument-row');
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            width: rect.width,
            rowHeight: row?.getBoundingClientRect().height ?? 0,
            borderStyle: style.borderStyle,
            fontSize: style.fontSize,
        };
    });
    await chiefPicker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="nation"] .action-column > div').first()).toHaveText(
        '【여포NPC】 쌀 300 포상'
    );

    expect(JSON.stringify(requests)).toContain('"destCityId":2');
    expect(JSON.stringify(requests)).toContain('"isGold":false');
    expect(JSON.stringify(requests)).toContain('"amount":300');
    expect(JSON.stringify(requests)).toContain('"destGeneralId":3');

    expect(mapGeometry.width).toBeGreaterThan(650);
    expect(mapGeometry.height / mapGeometry.width).toBeCloseTo(5 / 7, 2);

    expect(geometry.width).toBeGreaterThan(200);
    expect(geometry.rowHeight).toBeGreaterThanOrEqual(34);
    expect(geometry.borderStyle).toBe('solid');
    expect(Number.parseFloat(geometry.fontSize)).toBeGreaterThanOrEqual(10);
});

test('shows full nation command briefs in every chief card', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/che/chief-center');

    const desktopSummary = page.locator('.layout-desktop .chief-card').first().locator('.row-action').first();
    await expect(desktopSummary).toHaveText('【관우】 쌀 300 포상');
    await expect(desktopSummary).toHaveAttribute('title', '【관우】 쌀 300 포상');
    await page.screenshot({
        path: test.info().outputPath('chief-card-command-brief-desktop-1200.png'),
        fullPage: true,
    });

    await page.setViewportSize({ width: 500, height: 900 });
    const mobileSummary = page.locator('.chief-overview .chief-card').first().locator('.row-action').first();
    await expect(mobileSummary).toHaveText('【관우】 쌀 300 포상');
    await expect(mobileSummary).toHaveAttribute('title', '【관우】 쌀 300 포상');

    const geometry = await mobileSummary.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const card = element.closest<HTMLElement>('.chief-card');
        if (!card) throw new Error('chief card is missing');
        return {
            width: rect.width,
            cardWidth: card.getBoundingClientRect().width,
            horizontalOverflow: card.scrollWidth - card.clientWidth,
        };
    });
    expect(geometry.width).toBeLessThanOrEqual(geometry.cardWidth);
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('chief-card-command-brief-mobile-500.png'), fullPage: true });
});

test('uses a Ref-style full recruitment page without horizontal overflow on desktop or mobile', async ({
    page,
}, testInfo) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    let picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '내정', exact: true }).click();
    await picker.getByRole('button', { name: '징병', exact: true }).click();
    await expect(picker).toHaveAttribute('role', 'dialog');
    await expect(picker).toHaveAttribute('aria-modal', 'true');
    await expect(picker.getByRole('button', { name: '명령 입력 닫기', exact: true })).toBeFocused();
    const form = picker.getByTestId('recruitment-command-form');
    await expect(form).toContainText('현재 기술력 : 1등급');
    await expect(form).toContainText('공격');
    await expect(form).toContainText('방어');
    await expect(form).toContainText('기동');
    await expect(form).toContainText('회피');
    await expect(form).toContainText('가격');
    await expect(form).toContainText('군량');
    await expect(form).toContainText('표준적인 보병입니다.');
    await expect(form.getByRole('button', { name: '정예병 선택 불가', exact: true })).toHaveCount(0);
    await form.getByRole('button', { name: '선택 할 수 없는 병종도 보기', exact: true }).click();
    const unavailable = form.getByRole('button', { name: '정예병 선택 불가', exact: true });
    await expect(unavailable).toBeVisible();
    await expect(unavailable.locator('.crew-name')).toHaveCSS('background-color', 'rgb(201, 0, 0)');

    const desktopGeometry = await form.evaluate(async (element) => {
        const row = element.querySelector('.crew-row');
        const image = row?.querySelector('.crew-image');
        const info = row?.querySelector('.crew-info');
        const backgroundImage = image ? getComputedStyle(image).backgroundImage : '';
        const imageUrl = backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
        const naturalSize = imageUrl
            ? await new Promise<{ width: number; height: number } | null>((resolve) => {
                  const probe = new Image();
                  probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
                  probe.onerror = () => resolve(null);
                  probe.src = imageUrl;
              })
            : null;
        return {
            overlay: element.closest('[data-testid="command-picker"]')?.getBoundingClientRect().toJSON(),
            formWidth: element.getBoundingClientRect().width,
            rowHeight: row?.getBoundingClientRect().height ?? 0,
            infoWidth: info?.getBoundingClientRect().width ?? 0,
            imageNaturalSize: naturalSize,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            bodyOverflow: getComputedStyle(document.body).overflow,
        };
    });
    expect(desktopGeometry.overlay).toMatchObject({ x: 0, y: 0, width: 1200, height: 900 });
    expect(desktopGeometry.formWidth).toBe(1000);
    expect(desktopGeometry.rowHeight).toBeGreaterThanOrEqual(64);
    expect(desktopGeometry.infoWidth).toBeCloseTo(250, 0);
    expect(desktopGeometry.imageNaturalSize).toEqual({ width: 128, height: 128 });
    expect(desktopGeometry.scrollWidth).toBe(desktopGeometry.clientWidth);
    expect(desktopGeometry.bodyOverflow).toBe('hidden');

    const infantry = form.getByRole('button', { name: '보병 선택 가능', exact: true });
    await infantry.getByRole('button', { name: '절반', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('recruitment-desktop.png') });
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="general"] .action-column > div').first()).toHaveText(
        '【보병】 3500명 징병'
    );
    expect(JSON.stringify(requests)).toContain('"crewType":1100');
    expect(JSON.stringify(requests)).toContain('"amount":3500');

    await page.setViewportSize({ width: 500, height: 844 });
    await page.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '내정', exact: true }).click();
    await picker.getByRole('button', { name: '징병', exact: true }).click();
    await expect(picker.getByRole('button', { name: '명령 입력 닫기', exact: true })).toBeFocused();
    const referenceWidthGeometry = await picker.evaluate((element) => {
        const formElement = element.querySelector<HTMLElement>('[data-testid="recruitment-command-form"]')!;
        const row = formElement.querySelector<HTMLElement>('.crew-row')!;
        const selectedPanel = formElement.querySelector<HTMLElement>('.mobile-selected-panel')!;
        return {
            overlayWidth: element.getBoundingClientRect().width,
            rowWidth: row.getBoundingClientRect().width,
            rowGridColumns: getComputedStyle(row).gridTemplateColumns,
            selectedWidth: selectedPanel.getBoundingClientRect().width,
            selectedGridColumns: getComputedStyle(selectedPanel).gridTemplateColumns,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
        };
    });
    expect(referenceWidthGeometry).toMatchObject({
        overlayWidth: 500,
        rowWidth: 500,
        rowGridColumns: '64px 76px 30px 30px 30px 270px',
        selectedWidth: 500,
        selectedGridColumns: '64px 76px 270px 90px',
        scrollWidth: 500,
        clientWidth: 500,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileGeometry = await picker.evaluate((element) => {
        const formElement = element.querySelector<HTMLElement>('[data-testid="recruitment-command-form"]')!;
        const row = formElement.querySelector('.crew-row');
        const image = row?.querySelector('.crew-image');
        const info = row?.querySelector('.crew-info');
        const selectedPanel = formElement.querySelector('.mobile-selected-panel');
        const rect = element.getBoundingClientRect();
        const bottomElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
        return {
            overlay: rect.toJSON(),
            overlayCoversBottom: bottomElement instanceof Element && element.contains(bottomElement),
            formLeft: formElement.getBoundingClientRect().left,
            formWidth: formElement.getBoundingClientRect().width,
            rowWidth: row?.getBoundingClientRect().width ?? 0,
            rowHeight: row?.getBoundingClientRect().height ?? 0,
            rowGridColumns: row ? getComputedStyle(row).gridTemplateColumns : '',
            rowGridRows: row ? getComputedStyle(row).gridTemplateRows : '',
            imageWidth: image?.getBoundingClientRect().width ?? 0,
            infoWidth: info?.getBoundingClientRect().width ?? 0,
            selectedWidth: selectedPanel?.getBoundingClientRect().width ?? 0,
            selectedDisplay: selectedPanel ? getComputedStyle(selectedPanel).display : '',
            actionsBottom: element.querySelector<HTMLElement>('.picker-actions')?.getBoundingClientRect().bottom ?? 0,
            viewportHeight: window.innerHeight,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            bodyOverflow: getComputedStyle(document.body).overflow,
        };
    });
    expect(mobileGeometry.overlay).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
    expect(mobileGeometry.overlayCoversBottom).toBe(true);
    expect(mobileGeometry.rowGridColumns).toBe('64px 76px 30px 30px 30px 160px');
    expect(mobileGeometry).toMatchObject({
        formLeft: 0,
        formWidth: 390,
        rowWidth: 390,
        imageWidth: 64,
        selectedWidth: 390,
        selectedDisplay: 'grid',
        actionsBottom: 844,
        viewportHeight: 844,
        bodyOverflow: 'hidden',
    });
    expect(mobileGeometry.rowHeight).toBeGreaterThanOrEqual(64);
    expect(mobileGeometry.infoWidth).toBeGreaterThanOrEqual(150);
    expect(mobileGeometry.scrollWidth).toBe(mobileGeometry.clientWidth);

    await page.setViewportSize({ width: 390, height: 360 });
    await picker.evaluate((element) => (element.scrollTop = 160));
    const stickyGeometry = await picker.evaluate((element) => {
        const header = element.querySelector<HTMLElement>(':scope > header')!;
        const listFront = element.querySelector<HTMLElement>('.recruitment-list-front')!;
        const actions = element.querySelector<HTMLElement>('.picker-actions')!;
        return {
            scrollTop: element.scrollTop,
            headerTop: header.getBoundingClientRect().top,
            listFrontTop: listFront.getBoundingClientRect().top,
            actionsBottom: actions.getBoundingClientRect().bottom,
            viewportHeight: window.innerHeight,
        };
    });
    expect(stickyGeometry.scrollTop).toBeGreaterThan(0);
    expect(stickyGeometry.headerTop).toBe(0);
    expect(stickyGeometry.listFrontTop).toBeGreaterThanOrEqual(44);
    expect(stickyGeometry.actionsBottom).toBe(stickyGeometry.viewportHeight);

    await page.setViewportSize({ width: 390, height: 844 });
    await picker.evaluate((element) => (element.scrollTop = 0));
    await page.screenshot({ path: testInfo.outputPath('recruitment-mobile.png') });

    await picker.getByRole('button', { name: '명령 다시 선택', exact: true }).click();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
    await picker.getByRole('button', { name: '내정', exact: true }).click();
    await picker.getByRole('button', { name: '모병', exact: true }).click();
    const mercenaryForm = picker.getByTestId('recruitment-command-form');
    await expect(mercenaryForm).toContainText('모병은 가격 2배의 자금이 소요됩니다.');
    await expect(mercenaryForm.locator('.mobile-selected-panel output')).toHaveText('1,346금');
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
});

test('keeps arbitrary direct recruitment and mercenary amounts for all four arms after turn refresh', async ({
    page,
}, testInfo) => {
    const requests = await install(page, false, fourArmRecruitmentCommandTable);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    const entries = [
        { turn: 1, command: '징병', crewTypeId: 1100, name: '보병', inputAmount: 13, savedAmount: 1300 },
        { turn: 2, command: '징병', crewTypeId: 1200, name: '궁병', inputAmount: 27, savedAmount: 2700 },
        { turn: 3, command: '징병', crewTypeId: 1300, name: '기병', inputAmount: 41, savedAmount: 4100 },
        { turn: 4, command: '징병', crewTypeId: 1400, name: '귀병', inputAmount: 59, savedAmount: 5900 },
        { turn: 5, command: '모병', crewTypeId: 1100, name: '보병', inputAmount: 17, savedAmount: 1700 },
        { turn: 6, command: '모병', crewTypeId: 1200, name: '궁병', inputAmount: 31, savedAmount: 3100 },
        { turn: 7, command: '모병', crewTypeId: 1300, name: '기병', inputAmount: 43, savedAmount: 4300 },
        { turn: 8, command: '모병', crewTypeId: 1400, name: '귀병', inputAmount: 61, savedAmount: 6100 },
    ];

    for (const entry of entries) {
        await page.getByRole('button', { name: `${entry.turn}턴 명령 입력`, exact: true }).click();
        const picker = page.getByTestId('command-picker');
        await picker.getByRole('button', { name: '내정', exact: true }).click();
        await picker.getByRole('button', { name: entry.command, exact: true }).click();

        const row = picker.getByRole('button', { name: `${entry.name} 선택 가능`, exact: true });
        const amountInput = row.locator('input[type=number]');
        await amountInput.fill(String(entry.inputAmount));
        await expect(amountInput).toHaveValue(String(entry.inputAmount));
        if (entry.turn === 1) {
            const inputGeometry = await amountInput.evaluate((element) => {
                if (!(element instanceof HTMLInputElement)) throw new Error('Expected recruitment amount input');
                const rect = element.getBoundingClientRect();
                return {
                    width: rect.width,
                    height: rect.height,
                    textAlign: getComputedStyle(element).textAlign,
                    value: element.value,
                };
            });
            expect(inputGeometry).toMatchObject({ height: 28, textAlign: 'right', value: '13' });
            expect(inputGeometry.width).toBeGreaterThan(0);
            await picker.screenshot({ path: testInfo.outputPath('recruitment-direct-amount-desktop.png') });
        }
        await row.getByRole('button', { name: entry.command, exact: true }).click();

        await expect(picker).toHaveCount(0);
        await expect(
            page.locator('[data-command-scope="general"] .action-column > div').nth(entry.turn - 1)
        ).toHaveText(`【${entry.name}】 ${entry.savedAmount}명 ${entry.command}`);
    }

    const refreshResponse = page.waitForResponse((apiResponse) =>
        decodeURIComponent(apiResponse.url()).includes('turns.reserved.getGeneral')
    );
    await page.getByRole('button', { name: '갱 신', exact: true }).click();
    await refreshResponse;

    for (const entry of entries) {
        await expect(
            page.locator('[data-command-scope="general"] .action-column > div').nth(entry.turn - 1)
        ).toHaveText(`【${entry.name}】 ${entry.savedAmount}명 ${entry.command}`);
    }
    await page
        .locator('[data-command-scope="general"]')
        .screenshot({ path: testInfo.outputPath('recruitment-arbitrary-amounts-after-refresh.png') });

    const serializedRequests = JSON.stringify(requests);
    for (const entry of entries) {
        expect(serializedRequests).toContain(`"crewType":${entry.crewTypeId}`);
        expect(serializedRequests).toContain(`"amount":${entry.savedAmount}`);
    }
});

test('uses the map to choose a nation target in the chief command window', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?외교$/, exact: true }).click();
    await picker.getByRole('button', { name: /선전포고/ }).click();
    const form = picker.getByTestId('command-argument-form');
    await expect(form.getByTestId('command-argument-guidance')).toContainText('초반 제한');
    await form.getByTestId('command-argument-map').locator('.city-base').nth(1).click();
    await expect(form.locator('select')).toHaveValue('2');
    await expect(form.getByTestId('command-map-selection-status')).toContainText('현재 도시업');
    await expect(form.getByTestId('command-map-selection-status')).toContainText('선택 국가적국');
    await expect(form.getByTestId('current-city-marker')).toHaveAttribute('aria-label', '현재 도시 업');
    await expect(form.getByTestId('command-map-target-summary')).toContainText('수도 허창 · 도시 1개');
    await expect(page).toHaveURL(/\/che\/chief-center$/);
    expect(JSON.stringify(requests)).toContain('"generalId":1');
    await page.screenshot({ path: test.info().outputPath('chief-nation-map-option.png'), fullPage: true });
});

test('touch command maps select city and nation on the first tap without changing navigation mode', async ({
    browser,
}, testInfo) => {
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new Error('Playwright baseURL is required for the mobile command map contract');
    }
    const context = await browser.newContext({
        baseURL: configuredBaseUrl,
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
    });
    const mobilePage = await context.newPage();

    try {
        await install(mobilePage);
        await mobilePage.addInitScript(() => localStorage.setItem('sam.toggleSingleTap', 'no'));
        await mobilePage.goto('/');

        const mainCurrentCity = mobilePage.locator('[data-main-target="map"] .city-base.mine');
        await expect(mainCurrentCity).toHaveAttribute('aria-label', '업, 현재 도시');
        await expect(mobilePage.locator('[data-main-target="map"] .city-base.selected')).toHaveCount(0);
        await mobilePage.locator('[data-main-target="map"]').screenshot({
            path: testInfo.outputPath('main-map-current-city-static-highlight-mobile.png'),
        });

        await mobilePage.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
        await mobilePage.getByTestId('command-picker').getByRole('button', { name: /화계/ }).click();
        let form = mobilePage.getByTestId('command-argument-form');
        let commandMap = form.getByTestId('command-argument-map');
        await expect(commandMap.locator('.map-toggle-single-tap')).toHaveCount(0);
        await commandMap.locator('.city-base').nth(1).tap();
        await expect(form.locator('#command-arg-destCityId')).toHaveValue('2');
        await expect(commandMap.locator('.city-base').nth(1)).toHaveClass(/selected/);
        await expect(mobilePage).toHaveURL(/\/$/u);

        await mobilePage.goto(gamePath('/chief-center'));
        await mobilePage.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
        const picker = mobilePage.getByTestId('command-picker');
        await picker.getByRole('button', { name: /^(?:국가:)?외교$/, exact: true }).click();
        await picker.getByRole('button', { name: /선전포고/ }).click();
        form = picker.getByTestId('command-argument-form');
        commandMap = form.getByTestId('command-argument-map');
        await expect(commandMap.locator('.map-toggle-single-tap')).toHaveCount(0);
        await commandMap.locator('.city-base').nth(1).tap();
        await expect(form.locator('#command-arg-destNationId')).toHaveValue('2');
        await expect(commandMap.locator('.city-base').nth(1)).toHaveClass(/selected/);
        await expect(mobilePage).toHaveURL(new RegExp(`${gamePath('/chief-center')}$`, 'u'));
        expect(await mobilePage.evaluate(() => localStorage.getItem('sam.toggleSingleTap'))).toBe('no');

        await mobilePage.screenshot({ path: testInfo.outputPath('command-map-first-tap-selection-mobile.png') });
    } finally {
        await context.close();
    }
});

test('shows a map and target details for every city or nation argument chief command except assignment', async ({
    page,
}) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    const cases = [
        { category: '특수', action: '초토화', mode: 'city' },
        { category: '특수', action: '천도', mode: 'city' },
        { category: '전략', action: '수몰', mode: 'city' },
        { category: '전략', action: '허보', mode: 'city' },
        { category: '전략', action: '백성동원', mode: 'city' },
        { category: '외교', action: '원조', mode: 'nation' },
        { category: '외교', action: '불가침 제의', mode: 'nation' },
        { category: '외교', action: '선전포고', mode: 'nation' },
        { category: '외교', action: '종전 제의', mode: 'nation' },
        { category: '외교', action: '불가침 파기 제의', mode: 'nation' },
        { category: '전략', action: '이호경식', mode: 'nation' },
        { category: '전략', action: '급습', mode: 'nation' },
        { category: '전략', action: '피장파장', mode: 'nation' },
    ];

    for (const entry of cases) {
        await page.goto('/che/chief-center');
        await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
        const picker = page.getByTestId('command-picker');
        await picker.getByRole('button', { name: new RegExp(`^(?:국가:)?${entry.category}$`) }).click();
        await picker.getByRole('button', { name: new RegExp(entry.action) }).click();
        const form = picker.getByTestId('command-argument-form');
        const map = form.getByTestId('command-argument-map');
        await expect(map, `${entry.action} 지도`).toBeVisible();
        await expect(form.getByTestId('command-argument-guidance')).toBeVisible();

        await map.locator('.city-base').nth(1).click();
        if (entry.mode === 'city') {
            await expect(form.locator('#command-arg-destCityId')).toHaveValue('2');
            await expect(form.getByTestId('command-map-selection-status')).toContainText('선택 도시허창');
            await expect(form.getByTestId('command-map-target-summary')).toContainText(
                '허창 · 적국 · 예주 · 대 · 현재 도시에서 1칸'
            );
        } else {
            await expect(form.locator('#command-arg-destNationId')).toHaveValue('2');
            await expect(form.getByTestId('command-map-selection-status')).toContainText('선택 국가적국');
            await expect(form.getByTestId('command-map-target-summary')).toContainText('적국 · 수도 허창 · 도시 1개');
        }
        await expect(form.getByTestId('current-city-marker')).toHaveAttribute('aria-label', '현재 도시 업');
    }

    await page.screenshot({ path: test.info().outputPath('chief-command-target-map-details.png'), fullPage: true });

    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?전략$/, exact: true }).click();
    await picker.getByRole('button', { name: /피장파장/ }).click();
    const form = picker.getByTestId('command-argument-form');
    const map = form.getByTestId('command-argument-map');
    const targetCity = map.locator('.city-base').nth(1);
    await targetCity.hover();
    expect(await targetCity.evaluate((node) => getComputedStyle(node).cursor)).toBe('pointer');
    await targetCity.focus();
    await expect(targetCity).toBeFocused();
    await targetCity.click();
    await expect(form.locator('#command-arg-destNationId')).toHaveValue('2');
    const geometry = await picker.evaluate((element) => ({
        pickerWidth: element.getBoundingClientRect().width,
        pickerOverflow: element.scrollWidth - element.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mapInsidePicker:
            element.querySelector<HTMLElement>('[data-testid="command-argument-map"]')!.getBoundingClientRect().right <=
            element.getBoundingClientRect().right,
    }));
    expect(geometry).toEqual({ pickerWidth: 500, pickerOverflow: 0, documentOverflow: 0, mapInsidePicker: true });
    await page.screenshot({
        path: test.info().outputPath('chief-command-target-map-details-mobile.png'),
        fullPage: true,
    });
});

test('prioritizes own cities for assignment while retaining other map targets', async ({ page }) => {
    const assignmentTable = structuredClone(commandTable);
    assignmentTable.inputOptions.cities = [
        { value: 2, label: '허창 (적국)', description: '적국 · 예주 · 대도시' },
        { value: 3, label: '단양 (무주)' },
        { value: 1, label: '업 (아국)' },
    ];

    await install(page, false, assignmentTable);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?인사$/, exact: true }).click();
    await picker.getByRole('button', { name: /발령/ }).click();

    const form = picker.getByTestId('command-argument-form');
    const citySelect = form.locator('#command-arg-destCityId');
    await expect(form.getByTestId('command-argument-map')).toBeVisible();
    await expect(citySelect.locator('option')).toHaveText(['업 (아국)', '허창 (적국)', '단양 (무주)']);
    await expect(citySelect).toHaveValue('1');

    await form.getByTestId('command-argument-map').locator('.city-base').nth(1).click();
    await expect(citySelect).toHaveValue('2');
    await expect(form.getByTestId('command-map-selection-status')).toContainText('선택 도시허창');
    await expect(page).toHaveURL(/\/che\/chief-center$/);
    await form.screenshot({ path: test.info().outputPath('chief-assignment-own-city-priority.png') });

    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const mobilePicker = page.getByTestId('command-picker');
    await mobilePicker.getByRole('button', { name: /^(?:국가:)?인사$/, exact: true }).click();
    await mobilePicker.getByRole('button', { name: /발령/ }).click();

    const mobileForm = mobilePicker.getByTestId('command-argument-form');
    const mobileMap = mobileForm.getByTestId('command-argument-map');
    const mobileCitySelect = mobileForm.locator('#command-arg-destCityId');
    await expect(mobileMap).toBeVisible();
    await expect(mobileCitySelect.locator('option')).toHaveText(['업 (아국)', '허창 (적국)', '단양 (무주)']);
    const mobileGeometry = await mobilePicker.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        overflow: element.scrollWidth - element.clientWidth,
    }));
    expect(mobileGeometry).toEqual({ width: 500, overflow: 0 });
    const mapGeometry = await mobileMap.locator('.map-area').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    expect(mapGeometry.width / mapGeometry.height).toBeCloseTo(7 / 5, 2);
    await mobileMap.screenshot({ path: test.info().outputPath('chief-assignment-map-mobile.png') });
    await mobileCitySelect.scrollIntoViewIfNeeded();
    await mobilePicker.screenshot({ path: test.info().outputPath('chief-assignment-own-city-priority-mobile.png') });
});

test('prioritizes current nation targets while preserving every choice', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    const cases = [
        { action: '원조', first: '적국' },
        { action: '불가침 제의', first: '적국' },
        { action: '선전포고', first: '적국' },
        { action: '종전 제의', first: '적국' },
        { action: '불가침 파기 제의', first: '불가침국' },
    ];

    for (const entry of cases) {
        await page.goto('/che/chief-center');
        await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
        const picker = page.getByTestId('command-picker');
        await picker.getByRole('button', { name: /^(?:국가:)?외교$/, exact: true }).click();
        await picker.getByRole('button', { name: new RegExp(entry.action) }).click();
        const form = picker.getByTestId('command-argument-form');
        const targetList = form.getByTestId('nation-target-list');
        const targets = targetList.locator('.target-option');
        await expect(targets).toHaveCount(3);
        await expect(targets.first().locator('strong')).toHaveText(entry.first);
        await expect(targets.first().locator('.target-state')).toHaveText('우선 대상');
        await expect(targets.last().locator('.target-state')).toHaveText('현재 불가');
        await expect(form.locator('#command-arg-destNationId')).toHaveValue(entry.first === '불가침국' ? '3' : '2');
        await expect(form.getByTestId('command-argument-map')).toBeVisible();
    }

    const form = page.getByTestId('command-picker').getByTestId('command-argument-form');
    const targets = form.getByTestId('nation-target-list').locator('.target-option');
    await targets.filter({ hasText: '적국' }).click();
    await expect(form.locator('#command-arg-destNationId')).toHaveValue('2');
    await expect(targets.filter({ hasText: '적국' })).toHaveClass(/selected/);
    await expect(form.getByTestId('command-map-target-summary')).toContainText('수도 허창');
    await page.screenshot({ path: test.info().outputPath('chief-nation-target-priority.png'), fullPage: true });

    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const mobilePicker = page.getByTestId('command-picker');
    await mobilePicker.getByRole('button', { name: /^(?:국가:)?외교$/, exact: true }).click();
    await mobilePicker.getByRole('button', { name: /불가침 파기 제의/ }).click();
    const mobileTargets = mobilePicker.getByTestId('nation-target-list').locator('.target-option');
    await mobileTargets.nth(1).hover();
    expect(await mobileTargets.nth(1).evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await mobileTargets.nth(1).focus();
    await expect(mobileTargets.nth(1)).toBeFocused();
    const mobileGeometry = await mobilePicker.evaluate((element) => {
        const list = element.querySelector<HTMLElement>('[data-testid="nation-target-list"]')!;
        const cards = Array.from(list.querySelectorAll<HTMLElement>('.target-option'));
        const listRect = list.getBoundingClientRect();
        return {
            pickerWidth: element.getBoundingClientRect().width,
            pickerOverflow: element.scrollWidth - element.clientWidth,
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            cardsInsideList: cards.every((card) => {
                const rect = card.getBoundingClientRect();
                return rect.left >= listRect.left && rect.right <= listRect.right;
            }),
        };
    });
    expect(mobileGeometry).toEqual({
        pickerWidth: 500,
        pickerOverflow: 0,
        documentOverflow: 0,
        cardsInsideList: true,
    });
    await page.screenshot({ path: test.info().outputPath('chief-nation-target-priority-mobile.png'), fullPage: true });
});

test('offers Ref amount presets and rich, command-specific general lists', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });

    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    let picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?인사$/, exact: true }).click();
    await picker.getByRole('button', { name: /포상/ }).click();
    let form = picker.getByTestId('command-argument-form');
    const amount = form.locator('#command-arg-amount');
    const amountPreset = form.getByRole('combobox', { name: '금액 프리셋' });
    await expect(amount).toHaveValue('1000');
    await expect(amountPreset.locator('option')).toHaveText(['프리셋', '100', '500', '1,000', '5,000', '10,000']);
    await amountPreset.selectOption('5000');
    await expect(amount).toHaveValue('5000');
    await amount.fill('1375');
    await expect(amount).toHaveValue('1375');

    let generalList = form.getByTestId('general-target-list');
    await expect(generalList.locator('.target-option strong')).toHaveText([
        '관우 (아국 · 업)',
        '여포NPC (아국 · 업)',
        '장수 (아국 · 업)',
    ]);
    await expect(generalList.locator('.target-option').filter({ hasText: '여포NPC' }).locator('strong')).toHaveCSS(
        'color',
        'rgb(0, 255, 255)'
    );
    await expect(generalList).toContainText('금 100 · 쌀 4,000 · 병력 1,200 · 탑승 부대 청룡대 (부대장)');
    await form.getByRole('button', { name: '쌀', exact: true }).click();
    await expect(generalList.locator('.target-option strong')).toHaveText([
        '장수 (아국 · 업)',
        '여포NPC (아국 · 업)',
        '관우 (아국 · 업)',
    ]);
    await generalList.locator('.target-option').filter({ hasText: '여포NPC' }).click();
    const awardResponse = page.waitForResponse((response) => response.url().includes('turns.reserved.setNationBulk'));
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await awardResponse;

    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?인사$/, exact: true }).click();
    await picker.getByRole('button', { name: /몰수/ }).click();
    form = picker.getByTestId('command-argument-form');
    generalList = form.getByTestId('general-target-list');
    await expect(generalList.locator('.target-option strong')).toHaveText([
        '장수 (아국 · 업)',
        '여포NPC (아국 · 업)',
        '관우 (아국 · 업)',
    ]);

    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '3턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?인사$/, exact: true }).click();
    await picker.getByRole('button', { name: /발령/ }).click();
    form = picker.getByTestId('command-argument-form');
    await expect(form.getByTestId('general-target-list')).toContainText('병력 1,200 · 탑승 부대 청룡대 (부대장)');

    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '4턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?인사$/, exact: true }).click();
    await picker.getByRole('button', { name: /부대 탈퇴 지시/ }).click();
    form = picker.getByTestId('command-argument-form');
    generalList = form.getByTestId('general-target-list');
    await expect(generalList.locator('.target-option strong').first()).toHaveText('여포NPC (아국 · 업)');
    await expect(generalList.locator('.target-option').first().locator('.target-state')).toHaveText('우선 대상');
    await expect(generalList.locator('.target-option').nth(1).locator('.target-state')).toHaveText('현재 불가');

    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '5턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?외교$/, exact: true }).click();
    await picker.getByRole('button', { name: /원조/ }).click();
    form = picker.getByTestId('command-argument-form');
    const tupleInputs = form.locator('.tuple-options input[type=number]');
    await expect(tupleInputs.nth(0)).toHaveValue('1000');
    await expect(tupleInputs.nth(1)).toHaveValue('1000');
    await form.getByRole('combobox', { name: '금 금액 프리셋' }).selectOption('20000');
    await tupleInputs.nth(1).fill('1370');
    await expect(tupleInputs.nth(0)).toHaveValue('20000');
    await expect(tupleInputs.nth(1)).toHaveValue('1370');
    const aidResponse = page.waitForResponse((response) => response.url().includes('turns.reserved.setNationBulk'));
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await aidResponse;

    const serialized = JSON.stringify(requests);
    expect(serialized).toContain('"amount":1375');
    expect(serialized).toContain('"destGeneralId":3');
    expect(serialized).toContain('"amountList":[20000,1370]');
    await page.screenshot({ path: test.info().outputPath('chief-ref-guidance-controls.png'), fullPage: true });
});

test('fits the city map option window inside the Ref-compatible 500px mobile page', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /화계/ }).click();
    const mobileForm = picker.getByTestId('command-argument-form');
    const mobileMap = mobileForm.getByTestId('command-argument-map');
    const mobileCities = mobileMap.locator('.city-base');
    await mobileCities.nth(1).click();
    await expect(mobileForm.locator('select')).toHaveValue('2');
    await expect(mobileForm.getByTestId('command-map-selection-status')).toContainText('현재 도시업');
    await expect(mobileForm.getByTestId('command-map-selection-status')).toContainText('선택 도시허창');
    await expect(mobileMap.getByTestId('current-city-marker')).toHaveAttribute('aria-label', '현재 도시 업');
    await expect(mobileCities.nth(0)).toHaveClass(/mine/);
    await expect(mobileCities.nth(1)).toHaveClass(/selected/);
    const geometry = await picker.evaluate((element) => {
        const map = element.querySelector<HTMLElement>('[data-testid="command-argument-map"] .map-area')!;
        const pickerRect = element.getBoundingClientRect();
        const mapRect = map.getBoundingClientRect();
        return {
            pickerX: pickerRect.x,
            pickerRight: pickerRect.right,
            pickerWidth: pickerRect.width,
            pickerScrollWidth: element.scrollWidth,
            mapWidth: mapRect.width,
            mapHeight: mapRect.height,
            marker: (() => {
                const marker = element.querySelector<HTMLElement>('[data-testid="current-city-marker"]')!;
                const rect = marker.getBoundingClientRect();
                const style = getComputedStyle(marker);
                return {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    pointerEvents: style.pointerEvents,
                    borderColor: style.borderColor,
                };
            })(),
        };
    });
    expect(geometry.pickerX).toBeGreaterThanOrEqual(0);
    expect(geometry.pickerRight).toBeLessThanOrEqual(500);
    expect(geometry.pickerWidth).toBeGreaterThanOrEqual(488);
    expect(geometry.pickerScrollWidth).toBeLessThanOrEqual(geometry.pickerWidth);
    expect(geometry.mapWidth).toBeGreaterThan(470);
    expect(geometry.mapHeight / geometry.mapWidth).toBeCloseTo(5 / 7, 2);
    expect(geometry.marker.left).toBeGreaterThanOrEqual(0);
    expect(geometry.marker.right).toBeLessThanOrEqual(500);
    expect(geometry.marker.top).toBeGreaterThanOrEqual(0);
    expect(geometry.marker.bottom).toBeLessThanOrEqual(900);
    expect(geometry.marker.pointerEvents).toBe('none');
    expect(geometry.marker.borderColor).toBe('rgb(130, 207, 255)');
    await page.screenshot({ path: test.info().outputPath('main-city-map-option-mobile.png'), fullPage: true });
});

test('keeps the entered command visible and reports a server validation error', async ({ page }) => {
    await install(page, true);
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    await page.getByTestId('command-picker').getByRole('button', { name: /화계/ }).click();
    await page.getByTestId('command-argument-form').locator('select').selectOption('2');
    await page.getByTestId('command-picker').getByRole('button', { name: '입력', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText('대상 도시를 선택할 수 없습니다.');
    await expect(page.getByTestId('command-argument-form').locator('select')).toHaveValue('2');
});

test('keeps Ref command briefs and autonomous-action state after a turn mutation', async ({ page, context }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    const editor = page.locator('[data-command-scope="general"]');
    const firstRow = editor.locator('.action-column > div').first();
    await expect(editor.locator('[data-command-autorun-status]')).toHaveCount(0);
    await expect(firstRow).toContainText('휴식(자율 행동)');
    await expect(firstRow).toHaveAttribute(
        'data-autorun-tooltip',
        /자율 행동: 200年 3月 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}까지/u
    );
    expect(await firstRow.evaluate((element) => getComputedStyle(element).color)).toBe('rgb(170, 255, 255)');

    const tooltipStyle = () =>
        firstRow.evaluate((element) => {
            const style = getComputedStyle(element, '::after');
            return { content: style.content, opacity: style.opacity, visibility: style.visibility };
        });
    expect((await tooltipStyle()).visibility).toBe('hidden');
    const heightBeforeHover = await editor.evaluate((element) => element.getBoundingClientRect().height);
    await firstRow.hover();
    await expect.poll(async () => (await tooltipStyle()).visibility).toBe('visible');
    expect((await tooltipStyle()).content).toContain('자율 행동: 200年 3月');
    expect(await editor.evaluate((element) => element.getBoundingClientRect().height)).toBe(heightBeforeHover);
    await page.screenshot({
        path: test.info().outputPath('command-brief-autorun-hover-desktop-1200.png'),
        fullPage: true,
    });
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await tooltipStyle()).visibility).toBe('hidden');

    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '군사', exact: true }).click();
    await picker.getByRole('button', { name: '출병', exact: true }).click();
    await picker.getByTestId('command-argument-form').locator('select').selectOption('3');
    await picker.getByRole('button', { name: '입력', exact: true }).click();

    await expect(firstRow).toHaveText('【단양】으로 출병');
    await expect(firstRow).toHaveAttribute('data-autorun-tooltip', /자율 행동: 200年 3月 · .*까지/u);
    expect(await firstRow.evaluate((element) => getComputedStyle(element).color)).toBe('rgb(170, 255, 255)');
    await firstRow.focus();
    await expect.poll(async () => (await tooltipStyle()).visibility).toBe('visible');
    await expect(firstRow).toBeFocused();

    const desktopGeometry = await editor.evaluate((element) => {
        const layout = element.querySelector<HTMLElement>('.editor-layout');
        const controlPad = element.querySelector<HTMLElement>('.control-pad');
        const row = element.querySelector<HTMLElement>('.action-column > div');
        if (!layout || !controlPad || !row) throw new Error('autonomous command geometry is missing');
        return {
            horizontalOverflow: element.scrollWidth - element.clientWidth,
            controlPadOffset: controlPad.getBoundingClientRect().top - layout.getBoundingClientRect().top,
            rowHeight: row.getBoundingClientRect().height,
        };
    });
    expect(desktopGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(desktopGeometry.controlPadOffset).toBe(0);
    expect(desktopGeometry.rowHeight).toBeGreaterThanOrEqual(20);
    await page.screenshot({
        path: test.info().outputPath('command-brief-autorun-focus-desktop-1200.png'),
        fullPage: true,
    });

    const mobilePage = await context.newPage();
    await install(mobilePage);
    await mobilePage.setViewportSize({ width: 500, height: 900 });
    await mobilePage.goto('/');
    const mobileEditor = mobilePage.locator('[data-command-scope="general"]');
    const mobileFirstRow = mobileEditor.locator('.action-column > div').first();
    await expect(mobileFirstRow).toContainText('휴식(자율 행동)');
    const mobileRestGeometry = await mobileFirstRow.evaluate((element) => {
        const label = element.querySelector<HTMLElement>('span');
        const autonomous = element.querySelector<HTMLElement>('small');
        if (!label || !autonomous) throw new Error('mobile autonomous rest labels are missing');
        const labelRect = label.getBoundingClientRect();
        const autonomousRect = autonomous.getBoundingClientRect();
        return {
            display: getComputedStyle(element).display,
            labelCenterY: labelRect.top + labelRect.height / 2,
            autonomousCenterY: autonomousRect.top + autonomousRect.height / 2,
            inlineGap: autonomousRect.left - labelRect.right,
            rowOverflow: element.scrollWidth - element.clientWidth,
        };
    });
    expect(mobileRestGeometry.display).toBe('flex');
    expect(mobileRestGeometry.labelCenterY).toBeCloseTo(mobileRestGeometry.autonomousCenterY, 0);
    expect(Math.abs(mobileRestGeometry.inlineGap)).toBeLessThanOrEqual(1);
    expect(mobileRestGeometry.rowOverflow).toBeLessThanOrEqual(0);
    await expect(mobileFirstRow).toHaveAttribute('data-autorun-tooltip', /자율 행동: 200年 3月 · .*까지/u);
    await mobileFirstRow.focus();
    await expect
        .poll(() => mobileFirstRow.evaluate((element) => getComputedStyle(element, '::after').visibility))
        .toBe('visible');
    expect(await mobileEditor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await mobilePage.screenshot({
        path: test.info().outputPath('command-brief-autorun-focus-mobile-500.png'),
        fullPage: true,
    });
    await mobilePage.close();
});

test('uses drag selection, clipboard paste, and a stored template in advanced mode', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    const editor = page.locator('[data-command-scope="general"]');
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: '고급 모드', exact: true }).click();
    const drag = async (first: number, last: number, selector = '.index-column > button') => {
        const cells = editor.locator(selector);
        const from = await cells.nth(first).boundingBox();
        const to = await cells.nth(last).boundingBox();
        if (!from || !to) throw new Error('turn buttons are not measurable');
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
        await page.mouse.up();
    };

    await drag(0, 2);
    await expect(editor.locator('.index-column > button.selected')).toHaveCount(3);
    await editor.getByRole('button', { name: '명령 선택 ▾', exact: true }).click();
    const picker = editor.getByTestId('command-picker');
    const blockedFire = picker.getByRole('button', { name: '화계', exact: true });
    await expect(blockedFire).toBeEnabled();
    await blockedFire.click();
    await picker.getByTestId('command-argument-form').locator('select').selectOption('2');
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(editor.locator('.action-column > div').nth(2)).toHaveText('【허창】에 화계실행');

    const recentMenu = editor.locator('details').filter({ has: page.getByText('최근 실행', { exact: true }) });
    await recentMenu.locator('summary').click();
    const recentBriefButton = recentMenu.getByRole('button', { name: '【허창】에 화계실행', exact: true });
    await expect(recentBriefButton).toBeVisible();
    await recentBriefButton.hover();
    await page.screenshot({
        path: test.info().outputPath('advanced-recent-command-brief-desktop-1200.png'),
        fullPage: true,
    });
    await recentMenu.locator('summary').click();
    await page.setViewportSize({ width: 500, height: 900 });
    await recentMenu.locator('summary').click();
    await expect(recentBriefButton).toBeVisible();
    await recentBriefButton.focus();
    await expect(recentBriefButton).toBeFocused();
    const mobileRecentGeometry = await editor.evaluate((element) => {
        const menu = element.querySelector<HTMLElement>('details[open] .menu-items');
        const recentButton = menu?.querySelector<HTMLElement>('button');
        if (!menu || !recentButton) throw new Error('advanced recent command menu is missing');
        return {
            horizontalOverflow: element.scrollWidth - element.clientWidth,
            menuRight: menu.getBoundingClientRect().right,
            buttonRight: recentButton.getBoundingClientRect().right,
        };
    });
    expect(mobileRecentGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mobileRecentGeometry.menuRight).toBeLessThanOrEqual(500);
    expect(mobileRecentGeometry.buttonRight).toBeLessThanOrEqual(500);
    await page.screenshot({
        path: test.info().outputPath('advanced-recent-command-brief-mobile-500.png'),
        fullPage: true,
    });
    await recentMenu.locator('summary').click();
    await page.setViewportSize({ width: 1200, height: 900 });

    await drag(0, 2);
    await editor.locator('details.selected-menu > summary').click();
    await editor.getByRole('button', { name: '복사하기', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('core2026:general:1:clipboard'))).not.toBeNull();
    await editor.locator('details.range-menu > summary').click();
    await editor.getByRole('button', { name: '모든턴', exact: true }).click();
    await expect(editor.locator('.index-column > button.selected')).toHaveCount(15);
    await editor.locator('details.selected-menu > summary').click();
    await editor.getByRole('button', { name: '붙여넣기', exact: true }).click();
    await expect(editor.locator('.action-column > div').nth(5)).toHaveText('【허창】에 화계실행');

    await drag(0, 2);
    page.once('dialog', (dialog) => dialog.accept('화계 세트'));
    await editor.locator('details.selected-menu > summary').click();
    await editor.getByRole('button', { name: '보관하기', exact: true }).click();
    await editor
        .locator('details')
        .filter({ has: page.getByText('보관함', { exact: true }) })
        .locator('summary')
        .click();
    await expect(editor.getByRole('button', { name: '화계 세트', exact: true })).toBeVisible();

    expect(JSON.stringify(requests)).toContain('"turnList":[0,1,2]');
    expect(JSON.stringify(requests)).toContain('"turnList":[0,3,6,9,12');
    await page.screenshot({ path: test.info().outputPath('advanced-command-editor.png'), fullPage: true });
});

test('physical mobile touch drag selects general and nation turns in advanced mode', async ({ browser }, testInfo) => {
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new Error('Playwright baseURL is required for the mobile touch contract');
    }
    const context = await browser.newContext({
        baseURL: configuredBaseUrl,
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
    });
    const mobilePage = await context.newPage();
    try {
        await install(mobilePage);
        await mobilePage.goto(configuredBaseUrl);

        const editor = mobilePage.locator('[data-command-scope="general"]');
        await expect(editor).toBeVisible();
        await expect(editor.locator('.date-column.drag-select')).toHaveCSS('touch-action', 'auto');
        await editor.getByRole('button', { name: '고급 모드', exact: true }).click();
        await expect(editor.locator('.index-column.drag-select')).toHaveCSS('touch-action', 'none');
        const cells = editor.locator('.index-column > button');
        await touchDrag(mobilePage, cells.nth(0), cells.nth(2), { targetYRatio: 0.9 });

        await expect(editor.locator('.index-column > button.selected')).toHaveCount(3);
        const dates = editor.locator('.date-column > div');
        await touchDrag(mobilePage, dates.nth(4), dates.nth(6), { targetYRatio: 0.9 });
        await expect
            .poll(() => editor.locator('.index-column > button.selected').allTextContents())
            .toEqual(['5', '6', '7']);
        await mobilePage.screenshot({
            path: testInfo.outputPath('advanced-general-command-editor-mobile-touch.png'),
            fullPage: true,
        });

        await mobilePage.goto(new URL('chief-center', configuredBaseUrl).href);
        const chiefEditor = mobilePage.locator('[data-command-scope="nation"]:visible');
        await expect(chiefEditor).toBeVisible();
        await expect(chiefEditor.locator('.date-column.drag-select')).toHaveCSS('touch-action', 'auto');
        await chiefEditor.getByRole('button', { name: '고급 모드', exact: true }).click();
        await expect(chiefEditor.locator('.index-column.drag-select')).toHaveCSS('touch-action', 'none');
        const chiefCells = chiefEditor.locator('.index-column > button');
        await touchDrag(mobilePage, chiefCells.nth(0), chiefCells.nth(2), { targetYRatio: 0.9 });
        await expect(chiefEditor.locator('.index-column > button.selected')).toHaveCount(3);
        await mobilePage.screenshot({
            path: testInfo.outputPath('advanced-nation-command-editor-mobile-touch.png'),
            fullPage: true,
        });
    } finally {
        await context.close();
    }
});

test('keeps the shared main and chief shell geometry and interaction states', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();

    const mainGeometry = await page.locator('.main-page').evaluate((element) => {
        const header = element.querySelector<HTMLElement>('.game-shell__header')!;
        const title = element.querySelector<HTMLElement>('.game-shell__title')!;
        const subtitle = element.querySelector<HTMLElement>('.game-shell__subtitle')!;
        const action = element.querySelector<HTMLElement>('.game-shell__action')!;
        return {
            width: element.getBoundingClientRect().width,
            padding: getComputedStyle(element).padding,
            gap: getComputedStyle(element).gap,
            headerWidth: header.getBoundingClientRect().width,
            headerGap: getComputedStyle(header).gap,
            headerBorder: getComputedStyle(header).borderBottomWidth,
            headerPadding: getComputedStyle(header).paddingBottom,
            titleFontSize: getComputedStyle(title).fontSize,
            subtitleFontSize: getComputedStyle(subtitle).fontSize,
            actionPadding: getComputedStyle(action).padding,
            actionFontSize: getComputedStyle(action).fontSize,
        };
    });
    expect(mainGeometry).toMatchObject({
        width: 1000,
        padding: '0px',
        gap: '10px',
        headerWidth: 1000,
        headerGap: '12px',
        headerBorder: '1px',
        headerPadding: '12px',
        actionPadding: '6px 12px',
    });
    expect(Number.parseFloat(mainGeometry.titleFontSize)).toBeGreaterThan(20);
    expect(Number.parseFloat(mainGeometry.subtitleFontSize)).toBeGreaterThan(10);
    expect(Number.parseFloat(mainGeometry.actionFontSize)).toBeGreaterThan(10);

    const mainAction = page.getByRole('link', { name: '세력 정보' });
    await mainAction.hover();
    expect(await mainAction.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await mainAction.focus();
    expect(await mainAction.evaluate((element) => document.activeElement === element)).toBe(true);

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.locator('.main-nation-menu').first().locator('[data-navigation-id="chief-center"]').click();
    await expect(page).toHaveURL(/\/che\/chief-center$/);
    await expect(page.getByRole('heading', { name: '사령부', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    await expect(page.getByTestId('command-picker')).toBeVisible();
    await page
        .getByTestId('command-picker')
        .getByRole('button', { name: /^(?:국가:)?인사$/, exact: true })
        .click();
    await page.getByTestId('command-picker').getByRole('button', { name: /포상/ }).click();
    const chiefArgumentForm = page.getByTestId('command-picker').getByTestId('command-argument-form');
    await chiefArgumentForm.getByRole('button', { name: '쌀' }).click();
    await chiefArgumentForm.locator('input[type=number]').fill('300');
    await chiefArgumentForm.locator('select').selectOption('2');
    await page.getByTestId('command-picker').getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="nation"] .action-column > div').first()).toHaveText(
        '【관우】 쌀 300 포상'
    );
    expect(JSON.stringify(requests)).toContain('"action":"che_포상"');
    expect(JSON.stringify(requests)).toContain('"destGeneralId":2');
    const chiefDesktop = await page.locator('.chief-page').evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        padding: getComputedStyle(element).padding,
        headerWidth: element.querySelector<HTMLElement>('.chief-top')!.getBoundingClientRect().width,
    }));
    expect(chiefDesktop).toEqual({ width: 1000, padding: '0px', headerWidth: 1000 });

    await page.setViewportSize({ width: 500, height: 900 });
    const chiefMobile = await page.locator('.chief-page').evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        padding: getComputedStyle(element).padding,
        headerWidth: element.querySelector<HTMLElement>('.chief-top')!.getBoundingClientRect().width,
    }));
    expect(chiefMobile).toEqual({ width: 500, padding: '0px', headerWidth: 500 });
});
