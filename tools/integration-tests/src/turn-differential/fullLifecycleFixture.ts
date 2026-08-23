import type { CanonicalTurnSnapshot, TurnSnapshotSelector } from './canonical.js';
import type { TurnCommandFixtureRequest } from './coreCommandTrace.js';

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const semanticTimestamp = (value: unknown): number => {
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T').replace(/\.(\d{3})\d*$/, '.$1')}Z`;
    return new Date(normalized).getTime();
};

const semanticTurnArgs = (value: unknown): unknown => (Array.isArray(value) && value.length === 0 ? {} : value);

export const fullLifecycleGeneralTurns = Array.from({ length: 30 }, (_, turnIndex) => ({
    generalId: 1,
    turnIndex,
    action: turnIndex === 0 ? 'che_훈련' : '휴식',
    args: {},
}));

export const fullLifecycleNationTurns = Array.from({ length: 12 }, (_, turnIndex) => ({
    nationId: 1,
    officerLevel: 12,
    turnIndex,
    action: turnIndex === 0 ? 'che_국호변경' : '휴식',
    args: turnIndex === 0 ? { nationName: '수명주기국' } : {},
}));

export const fullLifecycleSnapshotSelector: TurnSnapshotSelector = {
    generalIds: [1],
    cityIds: [3],
    nationIds: [1],
    allGenerals: true,
    allCities: true,
    allNations: true,
    allTroops: true,
    includeRankMirrors: true,
    logAfterId: 0,
    messageAfterId: 0,
    includeNationHistoryLogs: true,
    includeGlobalHistoryLogs: true,
};

export const fullLifecycleTurnCommandRequest: TurnCommandFixtureRequest = {
    kind: 'general',
    actorGeneralId: 1,
    action: 'che_훈련',
    args: {},
    includeLifecycle: true,
    setup: {
        isolateWorld: true,
        world: {
            startYear: 180,
            year: 190,
            month: 1,
            hiddenSeed: 'turn-command-full-lifecycle-v1',
            freezeClock: true,
        },
        nations: [
            {
                id: 1,
                name: '아국',
                color: '#777777',
                capitalCityId: 3,
                gold: 1_000_000,
                rice: 1_000_000,
                tech: 1_000,
                level: 1,
                typeCode: 'che_명가',
                generalCount: 1,
                meta: { can_국호변경: 1 },
            },
        ],
        cities: [
            {
                id: 3,
                nationId: 1,
                level: 5,
                population: 100_000,
                populationMax: 200_000,
                agriculture: 1_000,
                agricultureMax: 2_000,
                commerce: 1_000,
                commerceMax: 2_000,
                security: 1_000,
                securityMax: 2_000,
                supplyState: 1,
                frontState: 0,
                defence: 1_000,
                defenceMax: 2_000,
                wall: 1_000,
                wallMax: 2_000,
                state: 0,
                term: 0,
                trust: 80,
                trade: 100,
            },
        ],
        generals: [
            {
                id: 1,
                name: '수명주기장수',
                nationId: 1,
                cityId: 3,
                troopId: 0,
                leadership: 90,
                strength: 80,
                intelligence: 70,
                leadershipExp: 0,
                strengthExp: 0,
                intelExp: 0,
                experience: 1_000,
                dedication: 1_000,
                expLevel: 0,
                officerLevel: 12,
                officerCityId: 3,
                belong: 10,
                permission: 'normal',
                injury: 0,
                age: 30,
                gold: 100_000,
                rice: 100_000,
                crew: 1_000,
                crewTypeId: 1_100,
                train: 50,
                atmos: 50,
                killTurn: 24,
                npcState: 0,
                blockState: 0,
                personality: 'None',
                specialDomestic: 'None',
                specialWar: 'None',
                itemHorse: 'None',
                itemWeapon: 'None',
                itemBook: 'None',
                itemExtra: 'None',
                meta: {},
            },
        ],
        generalTurns: fullLifecycleGeneralTurns,
        nationTurns: fullLifecycleNationTurns,
    },
    observe: fullLifecycleSnapshotSelector,
};

export const projectFullLifecycleSnapshotGraph = (snapshot: CanonicalTurnSnapshot): Record<string, unknown> => {
    const general = snapshot.generals.find((entry) => entry.id === 1);
    const nation = snapshot.nations.find((entry) => entry.id === 1);
    return {
        actor: general
            ? {
                  nationId: general.nationId,
                  cityId: general.cityId,
                  train: general.train,
                  atmos: general.atmos,
                  experience: general.experience,
                  dedication: general.dedication,
                  leadershipExp: general.leadershipExp,
                  expLevel: general.expLevel,
                  dedLevel: general.dedLevel,
                  killTurn: general.killTurn,
                  mySet: general.mySet,
                  turnTime: semanticTimestamp(general.turnTime),
                  lastTurn: general.lastTurn,
              }
            : null,
        nation: nation
            ? {
                  name: nation.name,
                  gold: nation.gold,
                  rice: nation.rice,
                  canRename: asRecord(nation.meta).can_국호변경 ?? 0,
              }
            : null,
        actorRankData: snapshot.rankData
            .filter((row) => row.generalId === 1)
            .sort((left, right) => String(left.type).localeCompare(String(right.type)))
            .map((row) => ({
                nationId: row.nationId,
                type: row.type,
                value: row.value,
            })),
        generalTurns: snapshot.generalTurns
            .filter((turn) => turn.generalId === 1)
            .sort((left, right) => Number(left.turnIndex) - Number(right.turnIndex))
            .map((turn) => ({
                turnIndex: turn.turnIndex,
                action: turn.action,
                args: semanticTurnArgs(turn.args),
            })),
        nationTurns: snapshot.nationTurns
            .filter((turn) => turn.nationId === 1 && turn.officerLevel === 12)
            .sort((left, right) => Number(left.turnIndex) - Number(right.turnIndex))
            .map((turn) => ({
                turnIndex: turn.turnIndex,
                action: turn.action,
                args: semanticTurnArgs(turn.args),
            })),
    };
};

export const addedFullLifecycleReferenceLogs = (
    before: CanonicalTurnSnapshot,
    after: CanonicalTurnSnapshot
): Array<Record<string, unknown>> =>
    after.logs.filter((entry) => {
        const scope = String(entry.scope).toLowerCase();
        const category = String(entry.category).toLowerCase();
        const usesWorldHistory = scope === 'nation' || (scope === 'system' && category === 'history');
        const watermark = usesWorldHistory ? before.watermarks.historyLogId : before.watermarks.logId;
        return Number(entry.id) > watermark;
    });
