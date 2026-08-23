import { describe, expect, it } from 'vitest';
import type { City, General, GeneralTriggerState, Nation } from '../../../src/domain/entities.js';
import {
    resolveGeneralAction,
    type GeneralActionResolveInputContext,
    type GeneralActionResolver,
} from '../../../src/actions/engine.js';
import { ActionDefinition as MoveCapitalAction } from '../../../src/actions/turn/nation/che_천도.js';
import { ActionDefinition as ExpandCityAction } from '../../../src/actions/turn/nation/che_증축.js';
import { ActionDefinition as ReduceCityAction } from '../../../src/actions/turn/nation/che_감축.js';
import { ActionDefinition as RandomMoveCapitalAction } from '../../../src/actions/turn/nation/che_무작위수도이전.js';
import { ActionDefinition as ScorchedEarthAction } from '../../../src/actions/turn/nation/che_초토화.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import { orderLegacyActionLoggerFlush } from '../../../src/logging/actionLogger.js';
import { LogCategory, LogFormat, LogScope, type LogEntryDraft } from '../../../src/logging/types.js';
import type { TurnSchedule } from '../../../src/turn/calendar.js';
import type { MapDefinition } from '../../../src/world/types.js';

const ENV: TurnCommandEnv = {
    develCost: 100,
    trainDelta: 30,
    atmosDelta: 30,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    sabotageDefaultProb: 0.5,
    sabotageProbCoefByStat: 0.1,
    sabotageDefenceCoefByGeneralCount: 0.1,
    sabotageDamageMin: 10,
    sabotageDamageMax: 30,
    openingPartYear: 3,
    maxGeneral: 500,
    defaultNpcGold: 1_000,
    defaultNpcRice: 1_000,
    defaultCrewTypeId: 1_100,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    initialNationGenLimit: 10,
    maxTechLevel: 12,
    baseGold: 1_000,
    baseRice: 2_000,
    maxResourceActionAmount: 10_000,
};

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 60 }] };
const rng = {
    nextFloat1: () => 0,
    nextBool: () => false,
    nextInt: () => 0,
};

const makeGeneral = (id: number, name = '운영자'): General => ({
    id,
    name,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 1_000,
    dedication: 1_000,
    officerLevel: id === 1 ? 12 : 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 100,
    crewTypeId: 1_100,
    train: 100,
    atmos: 100,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, betray: 0 },
});

const makeNation = (): Nation => ({
    id: 1,
    name: '위',
    color: '#111111',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 1_000_000,
    rice: 1_000_000,
    power: 1_000,
    level: 1,
    typeCode: 'che_명가',
    meta: { capset: 0, can_무작위수도이전: 1, surlimit: 0 },
});

const makeCity = (id: number, name: string, nationId: number): City => ({
    id,
    name,
    nationId,
    level: 5,
    state: 0,
    population: 200_000,
    populationMax: 300_000,
    agriculture: 3_000,
    agricultureMax: 4_000,
    commerce: 3_000,
    commerceMax: 4_000,
    security: 3_000,
    securityMax: 4_000,
    supplyState: 1,
    frontState: 0,
    defence: 3_000,
    defenceMax: 4_000,
    wall: 3_000,
    wallMax: 4_000,
    conflict: {},
    meta: { trust: 80, trade: 100 },
});

const mapStats = {
    population: 200_000,
    agriculture: 3_000,
    commerce: 3_000,
    security: 3_000,
    defence: 3_000,
    wall: 3_000,
};

const map: MapDefinition = {
    id: 'nation-capital-log-parity',
    name: '국가 명령 로그',
    cities: [
        {
            id: 1,
            name: '허창',
            level: 5,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [2],
            initial: mapStats,
            max: mapStats,
        },
        {
            id: 2,
            name: '낙양',
            level: 5,
            region: 1,
            position: { x: 1, y: 0 },
            connections: [1],
            initial: mapStats,
            max: mapStats,
        },
    ],
};

const resolveLogs = <Args>(
    resolver: GeneralActionResolver<GeneralTriggerState, Args>,
    context: GeneralActionResolveInputContext & Record<string, unknown>,
    args: Args
): LogEntryDraft[] =>
    orderLegacyActionLoggerFlush(
        resolveGeneralAction(resolver, context, { now: new Date('2026-08-23T00:00:00.000Z'), schedule }, args).logs
    );

const projectLogs = (logs: readonly LogEntryDraft[]) =>
    logs.map((log) => [
        log.scope,
        log.category,
        log.generalId ?? null,
        log.nationId ?? null,
        log.format,
        log.legacyFlushGroup ?? 0,
        log.text,
    ]);

const expectedActorLoggerFlush = (params: {
    actorId?: number;
    nationId?: number;
    generalHistory: string;
    generalAction: string;
    nationHistory: string;
    globalHistory: string;
    globalSummary: string;
}) => [
    [LogScope.GENERAL, LogCategory.HISTORY, params.actorId ?? 1, null, LogFormat.YEAR_MONTH, 0, params.generalHistory],
    [LogScope.GENERAL, LogCategory.ACTION, params.actorId ?? 1, null, LogFormat.MONTH, 0, params.generalAction],
    [LogScope.NATION, LogCategory.HISTORY, null, params.nationId ?? 1, LogFormat.YEAR_MONTH, 0, params.nationHistory],
    [LogScope.SYSTEM, LogCategory.HISTORY, null, null, LogFormat.YEAR_MONTH, 0, params.globalHistory],
    [LogScope.SYSTEM, LogCategory.SUMMARY, null, null, LogFormat.MONTH, 0, params.globalSummary],
];

describe('nation capital command Ref ActionLogger parity', () => {
    it('che_천도', () => {
        const general = makeGeneral(1);
        const nation = makeNation();
        const capitalCity = makeCity(1, '허창', 1);
        const destCity = makeCity(2, '낙양', 1);
        const logs = resolveLogs(
            new MoveCapitalAction(ENV),
            { general, city: capitalCity, nation, destCity, map, nationCities: [capitalCity, destCity], rng },
            { destCityID: destCity.id }
        );

        expect(projectLogs(logs)).toEqual(
            expectedActorLoggerFlush({
                generalHistory: '<G><b>낙양</b></>으로 <M>천도</>명령',
                generalAction: '<G><b>낙양</b></>으로 천도했습니다.',
                nationHistory: '<Y>운영자</>가 <G><b>낙양</b></>으로 <M>천도</> 명령',
                globalHistory: '<S><b>【천도】</b></><D><b>위</b></>가 <G><b>낙양</b></>으로 <M>천도</>하였습니다.',
                globalSummary: '<Y>운영자</>가 <G><b>낙양</b></>으로 <M>천도</>를 명령하였습니다.',
            })
        );
    });

    it.each([
        {
            action: '증축',
            resolver: new ExpandCityAction(ENV),
            globalHistoryPrefix: '<C><b>【증축】</b></>',
        },
        {
            action: '감축',
            resolver: new ReduceCityAction(ENV),
            globalHistoryPrefix: '<M><b>【감축】</b></>',
        },
    ])('che_$action', ({ action, resolver, globalHistoryPrefix }) => {
        const general = makeGeneral(1);
        const nation = makeNation();
        const capitalCity = makeCity(1, '낙양', 1);
        const logs = resolveLogs(resolver, { general, city: capitalCity, nation, capitalCity, rng }, {});

        expect(projectLogs(logs)).toEqual(
            expectedActorLoggerFlush({
                generalHistory: `<G><b>낙양</b></>을 <M>${action}</>`,
                generalAction: `<G><b>낙양</b></>을 ${action}했습니다.`,
                nationHistory: `<Y>운영자</>가 <G><b>낙양</b></>을 <M>${action}</>`,
                globalHistory: `${globalHistoryPrefix}<D><b>위</b></>가 <G><b>낙양</b></>을 <M>${action}</>하였습니다.`,
                globalSummary: `<Y>운영자</>가 <G><b>낙양</b></>을 <M>${action}</>하였습니다.`,
            })
        );
    });

    it('che_무작위수도이전', () => {
        const general = makeGeneral(1);
        const follower = makeGeneral(2, '부하');
        const nation = makeNation();
        const capitalCity = makeCity(1, '허창', 1);
        const destCity = makeCity(2, '낙양', 0);
        const logs = resolveLogs(
            new RandomMoveCapitalAction(),
            {
                general,
                city: capitalCity,
                nation,
                neutralCandidateCities: [destCity],
                nationGenerals: [general, follower],
                oldCapitalCity: capitalCity,
                rng,
            },
            {}
        );

        expect(projectLogs(logs)).toEqual([
            [
                LogScope.GENERAL,
                LogCategory.ACTION,
                follower.id,
                null,
                LogFormat.PLAIN,
                -1,
                '국가 수도를 <G><b>낙양</b></>으로 옮겼습니다.',
            ],
            ...expectedActorLoggerFlush({
                generalHistory: '<G><b>낙양</b></>으로 <M>무작위 수도 이전</>',
                generalAction: '<G><b>낙양</b></>으로 국가를 옮겼습니다.',
                nationHistory: '<Y>운영자</>가 <G><b>낙양</b></>으로 <M>무작위 수도 이전</>',
                globalHistory:
                    '<S><b>【무작위 수도 이전】</b></><D><b>위</b></>가 <G><b>낙양</b></>으로 <M>수도 이전</>하였습니다.',
                globalSummary: '<Y>운영자</>가 <G><b>낙양</b></>으로 <M>수도 이전</>하였습니다.',
            }),
        ]);
    });

    it('che_초토화', () => {
        const general = makeGeneral(1);
        const follower = makeGeneral(2, '부하');
        const nation = makeNation();
        const capitalCity = makeCity(1, '허창', 1);
        const destCity = makeCity(2, '낙양', 1);
        const logs = resolveLogs(
            new ScorchedEarthAction(),
            {
                general,
                city: capitalCity,
                nation,
                destCity,
                destNation: nation,
                friendlyGenerals: [general, follower],
                rng,
            },
            { destCityId: destCity.id }
        );

        expect(projectLogs(logs)).toEqual(
            expectedActorLoggerFlush({
                generalHistory: '<G><b>낙양</b></>을 <M>초토화</> 명령',
                generalAction: '<G><b>낙양</b></>을 초토화했습니다.',
                nationHistory: '<Y>운영자</>가 <G><b>낙양</b></>을 <M>초토화</> 명령',
                globalHistory: '<S><b>【초토화】</b></><D><b>위</b></>가 <G><b>낙양</b></>을 <M>초토화</>하였습니다.',
                globalSummary: '<Y>운영자</>가 <G><b>낙양</b></>을 <M>초토화</>하였습니다.',
            })
        );
    });
});
