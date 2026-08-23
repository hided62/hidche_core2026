import { describe, expect, it } from 'vitest';

import type { RandomGenerator } from '@sammo-ts/common';

import type { GeneralActionOutcome, GeneralActionResolveContext } from '../../../src/actions/engine.js';
import type { City, General, Nation } from '../../../src/domain/entities.js';
import { orderLegacyActionLoggerFlush } from '../../../src/logging/actionLogger.js';
import { LogCategory, type LogEntryDraft, LogFormat, LogScope } from '../../../src/logging/types.js';
import {
    ActionResolver as DegradeRelationsResolver,
    type DegradeRelationsResolveContext,
} from '../../../src/actions/turn/nation/che_이호경식.js';
import { ActionResolver as RaidResolver, type RaidResolveContext } from '../../../src/actions/turn/nation/che_급습.js';
import {
    ActionResolver as LastStandResolver,
    type DesperateFightResolveContext,
} from '../../../src/actions/turn/nation/che_필사즉생.js';
import {
    ActionResolver as DeceptionResolver,
    type DeceptionResolveContext,
} from '../../../src/actions/turn/nation/che_허보.js';
import {
    ActionResolver as CounterStrategyResolver,
    type CounterStrategyResolveContext,
} from '../../../src/actions/turn/nation/che_피장파장.js';

const rng: RandomGenerator = {
    nextFloat1: () => 0.5,
    nextBool: () => false,
    nextInt: (minInclusive) => minInclusive,
};

const buildGeneral = (id: number, nationId: number, cityId: number, name: string): General => ({
    id,
    name,
    nationId,
    cityId,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 100,
    dedication: 100,
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
    crewTypeId: 1,
    train: 80,
    atmos: 80,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
});

const buildNation = (id: number, name: string, chiefGeneralId: number | null): Nation => ({
    id,
    name,
    color: '#000000',
    capitalCityId: id * 100,
    chiefGeneralId,
    gold: 10_000,
    rice: 10_000,
    power: 100,
    level: 1,
    typeCode: 'test',
    meta: { gennum: 3, strategic_cmd_limit: 0 },
});

const buildCity = (id: number, nationId: number, name: string): City => ({
    id,
    name,
    nationId,
    level: 1,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 500,
    agricultureMax: 1_000,
    commerce: 500,
    commerceMax: 1_000,
    security: 500,
    securityMax: 1_000,
    supplyState: 1,
    frontState: 0,
    defence: 300,
    defenceMax: 1_000,
    wall: 300,
    wallMax: 1_000,
    meta: {},
});

const buildFixture = () => {
    const actor = buildGeneral(1, 10, 100, '가람');
    const friendlyTargets = [buildGeneral(2, 10, 100, '아군일'), buildGeneral(3, 10, 100, '아군이')];
    const destTargets = [buildGeneral(4, 20, 200, '적군일'), buildGeneral(5, 20, 200, '적군이')];
    return {
        actor,
        friendlyTargets,
        destTargets,
        nation: buildNation(10, '촉', actor.id),
        destNation: buildNation(20, '위', destTargets[0]!.id),
        destCity: buildCity(200, 20, '업'),
        safeDestCity: buildCity(201, 20, '평원'),
    };
};

const createActorLogSink = (actorId: number, logs: LogEntryDraft[]): GeneralActionResolveContext['addLog'] => {
    return (text, options = {}) => {
        const entry: LogEntryDraft = {
            scope: options.scope ?? LogScope.GENERAL,
            category: options.category ?? LogCategory.ACTION,
            text,
            format: options.format ?? LogFormat.MONTH,
            ...options,
        };
        if (entry.scope === LogScope.GENERAL && entry.generalId === undefined) {
            entry.generalId = actorId;
        }
        logs.push(entry);
    };
};

const collectLogs = (
    actorId: number,
    resolve: (addLog: GeneralActionResolveContext['addLog']) => GeneralActionOutcome
): LogEntryDraft[] => {
    const logs: LogEntryDraft[] = [];
    const outcome = resolve(createActorLogSink(actorId, logs));
    for (const effect of outcome.effects) {
        if (effect.type === 'log') {
            logs.push(effect.entry);
        }
    }
    return logs;
};

interface RefFlushExpectation {
    actorId: number;
    sourceNationId: number;
    destNationId?: number;
    friendlyTargetIds: number[];
    destTargetIds: number[];
    friendlyText: string;
    destText?: string;
    destNationText?: string;
    destNationFormat?: LogFormat;
    actorHistoryText: string;
    actorActionText: string;
    sourceNationText: string;
}

const projectLog = (entry: LogEntryDraft) => ({
    scope: entry.scope,
    category: entry.category,
    owner:
        entry.generalId !== undefined
            ? `general:${entry.generalId}`
            : entry.nationId !== undefined
              ? `nation:${entry.nationId}`
              : 'none',
    text: entry.text,
    format: entry.format,
    group: entry.legacyFlushGroup ?? 0,
});

const expectRefFlush = (logs: LogEntryDraft[], expected: RefFlushExpectation): void => {
    const internalEpochCount =
        expected.friendlyTargetIds.length + expected.destTargetIds.length + (expected.destNationText ? 1 : 0);
    const firstInternalGroup = -internalEpochCount;
    const expectedLogs = [
        ...expected.friendlyTargetIds.map((generalId, index) => ({
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            owner: `general:${generalId}`,
            text: expected.friendlyText,
            format: LogFormat.PLAIN,
            group: firstInternalGroup + index,
        })),
        ...expected.destTargetIds.map((generalId, index) => ({
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            owner: `general:${generalId}`,
            text: expected.destText,
            format: LogFormat.PLAIN,
            group: firstInternalGroup + expected.friendlyTargetIds.length + index,
        })),
        ...(expected.destNationText
            ? [
                  {
                      scope: LogScope.NATION,
                      category: LogCategory.HISTORY,
                      owner: `nation:${expected.destNationId}`,
                      text: expected.destNationText,
                      format: expected.destNationFormat,
                      group: -1,
                  },
              ]
            : []),
        {
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
            owner: `general:${expected.actorId}`,
            text: expected.actorHistoryText,
            format: LogFormat.YEAR_MONTH,
            group: 0,
        },
        {
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            owner: `general:${expected.actorId}`,
            text: expected.actorActionText,
            format: LogFormat.MONTH,
            group: 0,
        },
        {
            scope: LogScope.NATION,
            category: LogCategory.HISTORY,
            owner: `nation:${expected.sourceNationId}`,
            text: expected.sourceNationText,
            format: LogFormat.YEAR_MONTH,
            group: 0,
        },
    ];

    expect(orderLegacyActionLoggerFlush(logs).map(projectLog)).toEqual(expectedLogs);
};

describe('nation deception command Ref log parity', () => {
    it('preserves che_이호경식 logger epochs, texts, categories, and formats', () => {
        const fixture = buildFixture();
        const logs = collectLogs(fixture.actor.id, (addLog) =>
            new DegradeRelationsResolver([]).resolve(
                {
                    general: fixture.actor,
                    nation: fixture.nation,
                    destNation: fixture.destNation,
                    diplomacy: { state: 0, term: 3 },
                    reverseDiplomacy: { state: 0, term: 3 },
                    friendlyGenerals: [fixture.actor, ...fixture.friendlyTargets],
                    destNationGenerals: fixture.destTargets,
                    rng,
                    addLog,
                } satisfies DegradeRelationsResolveContext,
                { destNationId: fixture.destNation.id }
            )
        );

        expectRefFlush(logs, {
            actorId: fixture.actor.id,
            sourceNationId: fixture.nation.id,
            destNationId: fixture.destNation.id,
            friendlyTargetIds: fixture.friendlyTargets.map((general) => general.id),
            destTargetIds: fixture.destTargets.map((general) => general.id),
            friendlyText: '<Y>가람</>이 <G><b>위</b></>에 <M>이호경식</>을 발동하였습니다.',
            destText: '<D><b>촉</b></>이 아국에 <M>이호경식</>을 발동하였습니다.',
            destNationText: '<D><b>촉</b></>의 <Y>가람</>이 아국에 <M>이호경식</>을 발동',
            destNationFormat: LogFormat.YEAR_MONTH,
            actorHistoryText: '<D><b>위</b></>에 <M>이호경식</>을 발동',
            actorActionText: '이호경식 발동!',
            sourceNationText: '<Y>가람</>이 <D><b>위</b></>에 <M>이호경식</>을 발동',
        });
    });

    it('preserves che_급습 logger epochs, texts, categories, and formats', () => {
        const fixture = buildFixture();
        const logs = collectLogs(fixture.actor.id, (addLog) =>
            new RaidResolver([]).resolve(
                {
                    general: fixture.actor,
                    nation: fixture.nation,
                    destNation: fixture.destNation,
                    diplomacy: { state: 1, term: 18 },
                    reverseDiplomacy: { state: 1, term: 18 },
                    friendlyGenerals: [fixture.actor, ...fixture.friendlyTargets],
                    destNationGenerals: fixture.destTargets,
                    rng,
                    addLog,
                } satisfies RaidResolveContext,
                { destNationId: fixture.destNation.id }
            )
        );

        expectRefFlush(logs, {
            actorId: fixture.actor.id,
            sourceNationId: fixture.nation.id,
            destNationId: fixture.destNation.id,
            friendlyTargetIds: fixture.friendlyTargets.map((general) => general.id),
            destTargetIds: fixture.destTargets.map((general) => general.id),
            friendlyText: '<Y>가람</>이 <G><b>위</b></>에 <M>급습</>을 발동하였습니다.',
            destText: '아국에 <M>급습</>이 발동되었습니다.',
            destNationText: '<D><b>촉</b></>의 <Y>가람</>이 아국에 <M>급습</>을 발동',
            destNationFormat: LogFormat.YEAR_MONTH,
            actorHistoryText: '<D><b>위</b></>에 <M>급습</>을 발동',
            actorActionText: '급습 발동!',
            sourceNationText: '<Y>가람</>이 <D><b>위</b></>에 <M>급습</>을 발동',
        });
    });

    it('preserves che_필사즉생 target applyDB epochs before the actor logger', () => {
        const fixture = buildFixture();
        const logs = collectLogs(fixture.actor.id, (addLog) =>
            new LastStandResolver([]).resolve(
                {
                    general: fixture.actor,
                    nation: fixture.nation,
                    nationGenerals: [fixture.actor, ...fixture.friendlyTargets],
                    rng,
                    addLog,
                } satisfies DesperateFightResolveContext,
                {}
            )
        );

        expectRefFlush(logs, {
            actorId: fixture.actor.id,
            sourceNationId: fixture.nation.id,
            friendlyTargetIds: fixture.friendlyTargets.map((general) => general.id),
            destTargetIds: [],
            friendlyText: '<Y>가람</>이 <M>필사즉생</>을 발동하였습니다.',
            actorHistoryText: '<M>필사즉생</>을 발동',
            actorActionText: '필사즉생 발동!',
            sourceNationText: '<Y>가람</>이 <M>필사즉생</>을 발동',
        });
    });

    it('preserves che_허보 per-general applyDB epochs and plain target-nation history', () => {
        const fixture = buildFixture();
        const deceptionRng: RandomGenerator = { ...rng, nextInt: () => 1 };
        const logs = collectLogs(fixture.actor.id, (addLog) =>
            new DeceptionResolver([]).resolve(
                {
                    general: fixture.actor,
                    nation: fixture.nation,
                    destNation: fixture.destNation,
                    destCity: fixture.destCity,
                    destCityGenerals: fixture.destTargets,
                    friendlyGenerals: [fixture.actor, ...fixture.friendlyTargets],
                    destNationSupplyCities: [fixture.destCity, fixture.safeDestCity],
                    rng: deceptionRng,
                    addLog,
                } satisfies DeceptionResolveContext,
                { destCityId: fixture.destCity.id }
            )
        );

        expectRefFlush(logs, {
            actorId: fixture.actor.id,
            sourceNationId: fixture.nation.id,
            destNationId: fixture.destNation.id,
            friendlyTargetIds: fixture.friendlyTargets.map((general) => general.id),
            destTargetIds: fixture.destTargets.map((general) => general.id),
            friendlyText: '<Y>가람</>이 <G><b>업</b></>에 <M>허보</>를 발동하였습니다.',
            destText: '상대의 <M>허보</>에 당했다!',
            destNationText: '<D><b>촉</b></>의 <Y>가람</>이 아국의 <G><b>업</b></>에 <M>허보</>를 발동',
            destNationFormat: LogFormat.PLAIN,
            actorHistoryText: '<G><b>업</b></>에 <M>허보</>를 발동',
            actorActionText: '허보 발동!',
            sourceNationText: '<Y>가람</>이 <G><b>업</b></>에 <M>허보</>를 발동',
        });
    });

    it('preserves che_피장파장 logger epochs and year-month target-nation history', () => {
        const fixture = buildFixture();
        const logs = collectLogs(fixture.actor.id, (addLog) =>
            new CounterStrategyResolver([]).resolve(
                {
                    general: fixture.actor,
                    nation: fixture.nation,
                    destNation: fixture.destNation,
                    friendlyGenerals: [fixture.actor, ...fixture.friendlyTargets],
                    destNationGenerals: fixture.destTargets,
                    currentYearMonth: 2_231,
                    rng,
                    addLog,
                } satisfies CounterStrategyResolveContext,
                { destNationId: fixture.destNation.id, commandType: 'che_허보' }
            )
        );

        expectRefFlush(logs, {
            actorId: fixture.actor.id,
            sourceNationId: fixture.nation.id,
            destNationId: fixture.destNation.id,
            friendlyTargetIds: fixture.friendlyTargets.map((general) => general.id),
            destTargetIds: fixture.destTargets.map((general) => general.id),
            friendlyText: '<Y>가람</>이 <G><b>위</b></>에 <G><b>허보</b></> 전략의 <M>피장파장</>을 발동하였습니다.',
            destText: '아국에 <G><b>허보</b></> 전략의 <M>피장파장</>이 발동되었습니다.',
            destNationText: '<D><b>촉</b></>의 <Y>가람</>이 아국에 <G><b>허보</b></> <M>피장파장</>을 발동',
            destNationFormat: LogFormat.YEAR_MONTH,
            actorHistoryText: '<D><b>위</b></>에 <G><b>허보</b></> <M>피장파장</>을 발동',
            actorActionText: '<G><b>허보</b></> 전략의 피장파장 발동!',
            sourceNationText: '<Y>가람</>이 <D><b>위</b></>에 <G><b>허보</b></> <M>피장파장</>을 발동',
        });
    });
});
