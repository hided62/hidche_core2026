import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { seedScenarioToDatabase } from '@sammo-ts/game-engine';
import {
    buildNpcSelectionTokenSeed,
    chooseNpcPossessionCandidates,
    reserveNpcPossessionCandidates,
    type NpcPossessionCandidate,
} from '@sammo-ts/game-engine/turn/npcPossessionService.js';
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findTurnDifferentialWorkspaceRoot } from '../src/turn-differential/referenceSnapshot.js';

type FixtureCandidate = {
    id: number;
    leadership: number;
    strength: number;
    intel: number;
};

type FixturePick = {
    id: number;
    keepCount: number;
};

type FixtureCase = {
    name: string;
    reservedIds: number[];
    boundaryReservedIds?: number[];
    expiredReservedIds?: number[];
    hasPreviousToken?: boolean;
    previousPick?: FixturePick[];
    keepIds?: number[];
};

type Fixture = {
    hiddenSeed: string | number;
    owner: number;
    now: string;
    candidates: FixtureCandidate[];
    cases: FixtureCase[];
};

type KernelTrace = {
    name: string;
    cancelled: boolean;
    seed: string | null;
    candidateOrder: number[];
    randomDraws: number[];
    draws: number[];
    pick: FixturePick[];
};

type ReferenceKernelTrace = KernelTrace & {
    selectionStateUnchanged: boolean;
};

type ReferenceTrace = {
    fixtureGeneralIds: number[];
    observedSqlOrder: number[];
    cases: ReferenceKernelTrace[];
};

type CoreReservationTrace = {
    pick: FixturePick[];
    randomDraws: number[];
    draws: number[];
    tokenBefore: unknown;
    tokenAfter: unknown;
};

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const databaseUrl = process.env.NPC_POSSESSION_DIFFERENTIAL_DATABASE_URL;
const referenceEnabled = process.env.TURN_DIFFERENTIAL_REFERENCE === '1';
const integration = describe.skipIf(!workspaceRoot || !databaseUrl || !referenceEnabled);
const ownerUserId = 'npc-possession-differential-owner';
const reservedOwnerUserId = 'npc-possession-differential-reserved';

const fixturePath = (): string =>
    process.env.NPC_POSSESSION_DIFFERENTIAL_FIXTURE ??
    path.join(workspaceRoot!, 'docker_compose_files/reference/fixtures/npc-possession-differential/selector.json');

const readFixture = (): Fixture => JSON.parse(fs.readFileSync(fixturePath(), 'utf8')) as Fixture;

const referenceSourceRoot = (): string =>
    path.resolve(process.env.REF_COMPARE_SOURCE_ROOT ?? path.join(workspaceRoot!, 'ref/sam'));

const referenceRunner = (): string =>
    path.join(referenceSourceRoot(), 'hwe/compare/npc_possession_selection_trace.php');

const referenceTimeoutMs = (): number => {
    const value = Number(process.env.NPC_POSSESSION_DIFFERENTIAL_TIMEOUT_MS ?? '60000');
    if (!Number.isSafeInteger(value) || value < 5_000 || value > 600_000) {
        throw new Error('NPC_POSSESSION_DIFFERENTIAL_TIMEOUT_MS must be an integer from 5000 to 600000');
    }
    return value;
};

const referenceComparisonTestTimeoutMs = (): number => referenceTimeoutMs() * 2 + 60_000;

const runReference = (fixture: string): ReferenceTrace => {
    const stackDirectory = path.resolve(
        process.env.TURN_DIFFERENTIAL_STACK_DIR ?? path.join(workspaceRoot!, 'docker_compose_files/reference')
    );
    const runner = referenceRunner();
    const stdout = execFileSync('./scripts/run-turn-differential-case.sh', ['-'], {
        cwd: stackDirectory,
        input: fixture,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: referenceTimeoutMs(),
        env: {
            ...process.env,
            TURN_DIFFERENTIAL_RUNNER_SCRIPT: runner,
            TURN_DIFFERENTIAL_COMPARE_DIR: path.dirname(runner),
            TURN_DIFFERENTIAL_APP_DIR: referenceSourceRoot(),
            TURN_DIFFERENTIAL_RUNTIME_DIR: path.join(workspaceRoot!, 'ref/sam'),
            TURN_DIFFERENTIAL_STACK_DIR: stackDirectory,
        },
    });
    return JSON.parse(stdout) as ReferenceTrace;
};

const toCandidate = (candidate: FixtureCandidate, keepCount = 3): NpcPossessionCandidate => ({
    id: candidate.id,
    name: `후보${candidate.id}`,
    nation: { id: 0, name: '재야', color: '#666666' },
    stats: {
        leadership: candidate.leadership,
        strength: candidate.strength,
        intelligence: candidate.intel,
    },
    picture: null,
    imageServer: 0,
    personality: { code: 'None', name: '-', info: '없음' },
    specialDomestic: { code: 'None', name: '-', info: '없음' },
    specialWar: { code: 'None', name: '-', info: '없음' },
    keepCount,
});

// Ref serializes an insertion-ordered PHP object while JavaScript enumerates
// integer-like object keys numerically. The persisted/API pick is a set; draw
// order is compared independently and exactly below.
const normalizePickSet = (pick: FixturePick[]): FixturePick[] =>
    [...pick].sort((left, right) => left.id - right.id || left.keepCount - right.keepCount);

const acceptedAt = (fixture: Fixture): Date => new Date(`${fixture.now.replace(' ', 'T')}+09:00`);

const buildPreviousCandidates = (fixture: Fixture, previous: FixturePick[]): Record<string, NpcPossessionCandidate> => {
    const byId = new Map(fixture.candidates.map((candidate) => [candidate.id, candidate]));
    return Object.fromEntries(
        previous.map(({ id, keepCount }) => {
            const candidate = byId.get(id);
            if (!candidate) {
                throw new Error(`Unknown previous candidate ${id}`);
            }
            return [String(id), toCandidate(candidate, keepCount)];
        })
    );
};

class TracingRandUtil extends RandUtil {
    public readonly floatDraws: number[] = [];

    public override nextFloat1(): number {
        const value = super.nextFloat1();
        this.floatDraws.push(value);
        return value;
    }
}

const runCoreKernelCase = (fixture: Fixture, testCase: FixtureCase, acceptedGameTick: number): KernelTrace => {
    const reserved = new Set([...testCase.reservedIds, ...(testCase.boundaryReservedIds ?? [])]);
    const candidates = fixture.candidates
        .filter(({ id }) => !reserved.has(id))
        .sort((left, right) => left.id - right.id)
        .map((candidate) => toCandidate(candidate));
    const previous = buildPreviousCandidates(fixture, testCase.previousPick ?? []);
    const keepIds = new Set(testCase.keepIds ?? []);
    const kept = Object.fromEntries(
        Object.entries(previous)
            .filter(([, candidate]) => keepIds.has(candidate.id) && candidate.keepCount > 0)
            .map(([id, candidate]) => [id, { ...candidate, keepCount: candidate.keepCount - 1 }])
    );
    const hasPreviousToken = testCase.hasPreviousToken === true || Object.keys(previous).length > 0;
    if (hasPreviousToken && Object.keys(kept).length === Object.keys(previous).length) {
        return {
            name: testCase.name,
            cancelled: true,
            seed: null,
            candidateOrder: candidates.map(({ id }) => id),
            randomDraws: [],
            draws: [],
            pick: Object.values(previous).map(({ id, keepCount }) => ({ id, keepCount })),
        };
    }

    const seed = buildNpcSelectionTokenSeed(fixture.hiddenSeed, fixture.owner, acceptedGameTick);
    const rng = new TracingRandUtil(new LiteHashDRBG(seed));
    const draws: number[] = [];
    const picked = chooseNpcPossessionCandidates(candidates, kept, rng, (selectedId) => {
        draws.push(Number(selectedId));
    });
    return {
        name: testCase.name,
        cancelled: false,
        seed,
        candidateOrder: candidates.map(({ id }) => id),
        randomDraws: rng.floatDraws,
        draws,
        pick: Object.values(picked).map(({ id, keepCount }) => ({ id, keepCount })),
    };
};

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('npc_possession_differential')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
    if (!/^[a-z0-9_]+$/.test(schema)) {
        throw new Error(`Refusing unsafe schema name: ${schema}`);
    }
};

const readReferenceAcceptedGameTick = (trace: ReferenceTrace): number => {
    const ticks = new Set(
        trace.cases.flatMap(({ seed }) => {
            if (seed === null) return [];
            const match = seed.match(/\|int\((-?\d+)\)$/);
            if (!match) {
                throw new Error(`Ref SelectNPCToken seed does not end with an integer game tick: ${seed}`);
            }
            const tick = Number(match[1]);
            if (!Number.isSafeInteger(tick)) {
                throw new Error(`Ref SelectNPCToken tick is outside the safe integer range: ${match[1]}`);
            }
            return [tick];
        })
    );
    if (ticks.size !== 1) {
        throw new Error(`Ref comparison returned ${ticks.size} distinct accepted game ticks`);
    }
    return [...ticks][0]!;
};

integration('NPC possession selector Ref differential', () => {
    if (!workspaceRoot || !databaseUrl || !referenceEnabled) {
        return;
    }
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let worldState: GamePrisma.WorldStateGetPayload<Record<string, never>>;
    const fixture = readFixture();

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const previousSeed = process.env.INTEGRATION_WORLD_SEED;
        process.env.INTEGRATION_WORLD_SEED = String(fixture.hiddenSeed);
        try {
            await seedScenarioToDatabase({
                scenarioId: 2,
                databaseUrl: databaseUrl!,
                now: acceptedAt(fixture),
                installOptions: {
                    turnTermMinutes: 5,
                    npcMode: 1,
                    showImgLevel: 3,
                    serverId: 'npc-possession-differential',
                    season: 1,
                },
            });
        } finally {
            if (previousSeed === undefined) {
                delete process.env.INTEGRATION_WORLD_SEED;
            } else {
                process.env.INTEGRATION_WORLD_SEED = previousSeed;
            }
        }
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.inputEvent.deleteMany();
        await db.npcSelectionToken.deleteMany();
        await db.general.updateMany({
            where: { userId: null, npcState: 2 },
            data: { npcState: 1 },
        });
        const city = await db.city.findFirstOrThrow({ orderBy: { id: 'asc' } });
        await db.general.createMany({
            data: fixture.candidates.map((candidate) => ({
                id: candidate.id,
                userId: null,
                name: `후보${candidate.id}`,
                nationId: 0,
                cityId: city.id,
                npcState: 2,
                leadership: candidate.leadership,
                strength: candidate.strength,
                intel: candidate.intel,
                turnTime: acceptedAt(fixture),
                personalCode: 'None',
                specialCode: 'None',
                special2Code: 'None',
                picture: null,
                imageServer: 0,
                meta: {},
                penalty: {},
            })),
        });
        const eligibleIds = await db.general.findMany({
            where: { userId: null, npcState: 2 },
            orderBy: { id: 'asc' },
            select: { id: true },
        });
        expect(eligibleIds.map(({ id }) => id)).toEqual(
            fixture.candidates.map(({ id }) => id).sort((left, right) => left - right)
        );
        const seededWorld = await db.worldState.findFirstOrThrow();
        const meta =
            typeof seededWorld.meta === 'object' && seededWorld.meta !== null && !Array.isArray(seededWorld.meta)
                ? seededWorld.meta
                : {};
        worldState = await db.worldState.update({
            where: { id: seededWorld.id },
            data: {
                meta: { ...meta, hiddenSeed: fixture.hiddenSeed },
            },
        });
    }, 60_000);

    afterAll(async () => {
        await closeDb?.();
    });

    const runCoreReservationCase = async (
        testCase: FixtureCase,
        acceptedGameTick: number
    ): Promise<CoreReservationTrace> =>
        db.$transaction(async (transaction) => {
            await transaction.npcSelectionToken.deleteMany();
            const validUntil = new Date('2099-12-31T23:59:59.000Z');
            const pickMoreFrom = new Date('2000-01-01T01:00:00.000Z');
            const candidateById = new Map(fixture.candidates.map((candidate) => [candidate.id, candidate]));
            const insertReservedToken = async (
                ownerId: string,
                ids: number[],
                reservationValidUntil: Date
            ): Promise<void> => {
                if (ids.length === 0) return;
                const reservedPick = Object.fromEntries(
                    ids.map((id) => {
                        const candidate = candidateById.get(id);
                        if (!candidate) throw new Error(`Unknown reserved candidate ${id}`);
                        return [String(id), toCandidate(candidate)];
                    })
                );
                await transaction.npcSelectionToken.create({
                    data: {
                        ownerUserId: ownerId,
                        validUntil: reservationValidUntil,
                        pickMoreFrom,
                        pickResult: reservedPick as GamePrisma.InputJsonValue,
                        nonce: 1,
                    },
                });
            };
            await insertReservedToken(reservedOwnerUserId, testCase.reservedIds, validUntil);
            await insertReservedToken(
                `${reservedOwnerUserId}-boundary`,
                testCase.boundaryReservedIds ?? [],
                acceptedAt(fixture)
            );
            await insertReservedToken(
                `${reservedOwnerUserId}-expired`,
                testCase.expiredReservedIds ?? [],
                new Date(acceptedAt(fixture).getTime() - 1_000)
            );
            const previousPick = testCase.previousPick ?? [];
            const hasPreviousToken = testCase.hasPreviousToken === true || previousPick.length > 0;
            if (hasPreviousToken) {
                await transaction.npcSelectionToken.create({
                    data: {
                        ownerUserId,
                        validUntil,
                        pickMoreFrom,
                        pickResult: buildPreviousCandidates(fixture, previousPick) as GamePrisma.InputJsonValue,
                        nonce: 2,
                    },
                });
            }
            const tokenBefore = await transaction.npcSelectionToken.findUnique({
                where: { ownerUserId },
            });
            const randomDraws: number[] = [];
            const draws: number[] = [];
            const reservation = await reserveNpcPossessionCandidates({
                db: transaction,
                worldState,
                userId: ownerUserId,
                ownerIdentity: fixture.owner,
                refresh: hasPreviousToken,
                keepIds: testCase.keepIds,
                now: acceptedAt(fixture),
                acceptedGameTick,
                selectionObserver: {
                    onRandomDraw: (value) => randomDraws.push(value),
                    onCandidateDraw: (selectedId) => draws.push(Number(selectedId)),
                },
            });
            const tokenAfter = await transaction.npcSelectionToken.findUnique({
                where: { ownerUserId },
            });
            return {
                pick: reservation.candidates.map(({ id, keepCount }) => ({ id, keepCount })),
                randomDraws,
                draws,
                tokenBefore,
                tokenAfter,
            };
        });

    it('rejects direct execution when the comparison guard is absent', () => {
        const result = spawnSync('php', [referenceRunner()], {
            input: fs.readFileSync(fixturePath(), 'utf8'),
            encoding: 'utf8',
            timeout: 5_000,
            env: {
                PATH: process.env.PATH,
            },
        });
        expect(result.status).toBe(64);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('NPC possession comparison is disabled.\n');
    });

    it(
        'matches the shared Ref kernel and the actual Core reservation path',
        async () => {
            const fixtureText = fs.readFileSync(fixturePath(), 'utf8');
            const firstReference = runReference(fixtureText);
            const secondReference = runReference(fixtureText);
            expect(secondReference).toEqual(firstReference);
            expect(firstReference.fixtureGeneralIds).toEqual(fixture.candidates.map(({ id }) => id));
            expect(firstReference.observedSqlOrder).toEqual(
                fixture.candidates.map(({ id }) => id).sort((left, right) => left - right)
            );
            expect(firstReference.cases).toHaveLength(fixture.cases.length);

            // The shared Ref database and disposable Core scenario intentionally have
            // different clock bases. This selector differential isolates RNG by injecting
            // the exact safe integer tick observed at the Ref endpoint into both Core paths;
            // it does not claim clock-base parity between the two fixtures.
            const referenceAcceptedGameTick = readReferenceAcceptedGameTick(firstReference);
            const coreKernelCases = fixture.cases.map((testCase) =>
                runCoreKernelCase(fixture, testCase, referenceAcceptedGameTick)
            );
            for (const [index, referenceCase] of firstReference.cases.entries()) {
                const testCase = fixture.cases[index]!;
                const coreKernel = coreKernelCases[index]!;
                const coreReservation = await runCoreReservationCase(testCase, referenceAcceptedGameTick);
                expect(referenceCase.name).toBe(coreKernel.name);
                expect(referenceCase.selectionStateUnchanged).toBe(true);
                expect(referenceCase.cancelled).toBe(coreKernel.cancelled);
                expect(referenceCase.seed).toBe(coreKernel.seed);
                expect(referenceCase.candidateOrder).toEqual(coreKernel.candidateOrder);
                expect(referenceCase.randomDraws).toEqual(coreKernel.randomDraws);
                expect(referenceCase.draws).toEqual(coreKernel.draws);
                expect(referenceCase.randomDraws).toEqual(coreReservation.randomDraws);
                expect(referenceCase.draws).toEqual(coreReservation.draws);
                expect(normalizePickSet(referenceCase.pick)).toEqual(normalizePickSet(coreKernel.pick));
                expect(normalizePickSet(referenceCase.pick)).toEqual(normalizePickSet(coreReservation.pick));
                if (coreKernel.cancelled) {
                    expect(coreReservation.tokenBefore).not.toBeNull();
                    expect(coreReservation.tokenAfter).toEqual(coreReservation.tokenBefore);
                }
            }

            const initial = firstReference.cases.find(({ name }) => name === 'initial-five');
            expect(initial).toBeDefined();
            expect(initial!.draws.length).toBeGreaterThan(initial!.pick.length);
            expect(firstReference.cases.find(({ name }) => name === 'all-keep-cancels-refresh')).toMatchObject({
                cancelled: true,
                seed: null,
                randomDraws: [],
                draws: [],
                selectionStateUnchanged: true,
            });
            expect(
                firstReference.cases.find(({ name }) => name === 'empty-existing-pick-cancels-refresh')
            ).toMatchObject({
                cancelled: true,
                seed: null,
                randomDraws: [],
                draws: [],
                pick: [],
                selectionStateUnchanged: true,
            });
        },
        referenceComparisonTestTimeoutMs()
    );
});
