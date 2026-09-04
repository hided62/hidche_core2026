import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ChangeJournal } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { GameApiContext, GeneralRow } from '../../../app/game-api/src/context.js';
import { appRouter } from '../../../app/game-api/src/router.js';

import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTraceRequest,
} from '../src/turn-differential/referenceSnapshot.js';

type DiplomacyAction = 'noAggression' | 'cancelNA' | 'stopWar';

interface ReferenceExecution {
    entryPoint: string;
    action: DiplomacyAction;
    outcome: { result: boolean; reason: string };
    proposalMessageId: number;
    proposalBefore: { validUntilTick: number; payload: unknown };
    proposalAfter: { validUntilTick: number; payload: unknown };
}

interface ReferenceTrace {
    execution: ReferenceExecution;
    before: {
        watermarks: { logId: number; messageId: number };
    };
    after: {
        diplomacy: Array<{ fromNationId: number; toNationId: number; state: number; term: number }>;
        cities: Array<{ id: number; frontState: number }>;
        nations: Array<{ id: number; meta: unknown }>;
        logs: Array<{
            id: number;
            generalId: number | null;
            scope: string;
            category: string;
            text: string;
        }>;
        messages: Array<{
            id: number;
            mailbox: number;
            type: string;
            sourceId: number;
            destinationId: number;
            payload: unknown;
        }>;
    };
}

interface CoreMessageRow {
    id: number;
    mailbox: number;
    type: 'national' | 'diplomacy';
    src: number;
    dest: number;
    time: Date;
    valid_until: Date;
    message: Record<string, unknown>;
}

interface CoreLogRow {
    scope: string;
    category: string;
    generalId?: number | null;
    nationId?: number | null;
    text: string;
}

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');

const actionCases = [
    { action: 'noAggression' as const, state: 2, reverseState: 2, term: 0 },
    { action: 'cancelNA' as const, state: 7, reverseState: 7, term: 12 },
    { action: 'stopWar' as const, state: 0, reverseState: 1, term: 6 },
];

const target = (id: number, name: string, nationId: number, nationName: string) => ({
    generalId: id,
    generalName: name,
    nationId,
    nationName,
    color: '#777777',
    icon: '/image/icons/default.jpg',
});

const referenceSetup = (testCase: (typeof actionCases)[number]) => ({
    isolateWorld: true,
    world: { year: 190, month: 3 },
    nations: [
        { id: 1, name: '수락국', capitalCityId: 1 },
        {
            id: 2,
            name: '제안국',
            capitalCityId: 2,
            ...(testCase.action === 'noAggression' ? { nationEnv: { recv_assist: { n1: [1, 37] } } } : {}),
        },
    ],
    cities: [
        { id: 1, nationId: 1, supplyState: 1, frontState: 1 },
        { id: 2, nationId: 2, supplyState: 1, frontState: 1 },
    ],
    generals: [
        {
            id: 1,
            name: '수락장수',
            nationId: 1,
            cityId: 1,
            officerLevel: 12,
            permission: 'normal',
            penalty: {},
        },
        {
            id: 2,
            name: '제안장수',
            nationId: 2,
            cityId: 2,
            officerLevel: 12,
            permission: 'normal',
            penalty: {},
        },
    ],
    diplomacy: [
        { fromNationId: 1, toNationId: 2, state: testCase.state, term: testCase.term },
        { fromNationId: 2, toNationId: 1, state: testCase.reverseState, term: testCase.term },
    ],
});

const runReference = (testCase: (typeof actionCases)[number]): ReferenceTrace => {
    const sourceRoot = process.env.REF_COMPARE_SOURCE_ROOT ?? path.join(workspaceRoot!, 'ref/sam');
    const runner = path.join(sourceRoot, 'hwe/compare/instant_diplomacy_response_trace.php');
    const previousRunner = process.env.TURN_DIFFERENTIAL_RUNNER_SCRIPT;
    process.env.TURN_DIFFERENTIAL_RUNNER_SCRIPT = runner;
    try {
        return runReferenceTurnCommandTraceRequest(workspaceRoot!, {
            actorGeneralId: 1,
            proposerGeneralId: 2,
            action: testCase.action,
            response: true,
            ...(testCase.action === 'noAggression' ? { year: 191, month: 2 } : {}),
            setup: referenceSetup(testCase),
            observe: {
                generalIds: [1, 2],
                nationIds: [1, 2],
                cityIds: [1, 2],
            },
        }) as unknown as ReferenceTrace;
    } finally {
        if (previousRunner === undefined) {
            delete process.env.TURN_DIFFERENTIAL_RUNNER_SCRIPT;
        } else {
            process.env.TURN_DIFFERENTIAL_RUNNER_SCRIPT = previousRunner;
        }
    }
};

const buildCoreCaller = (testCase: (typeof actionCases)[number]) => {
    const actor = {
        id: 1,
        userId: 'user-1',
        name: '수락장수',
        nationId: 1,
        cityId: 1,
        officerLevel: 12,
        npcState: 0,
        meta: {},
        penalty: {},
    } as GeneralRow;
    const proposer = {
        ...actor,
        id: 2,
        userId: 'user-2',
        name: '제안장수',
        nationId: 2,
        cityId: 2,
    } as GeneralRow;
    const nations = [
        {
            id: 1,
            name: '수락국',
            color: '#777777',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 0,
            rice: 0,
            level: 1,
            typeCode: 'che_중립',
            meta: {},
        },
        {
            id: 2,
            name: '제안국',
            color: '#777777',
            capitalCityId: 2,
            chiefGeneralId: 2,
            gold: 0,
            rice: 0,
            level: 1,
            typeCode: 'che_중립',
            meta: testCase.action === 'noAggression' ? { recv_assist: { n1: [1, 37] } } : {},
        },
    ];
    const cities = [
        { id: 1, nationId: 1, supplyState: 1, frontState: 1 },
        { id: 2, nationId: 2, supplyState: 1, frontState: 1 },
        // Ref isolateWorld keeps the remaining map cities as neutral. These two
        // adjacent neutral cities are sufficient to exercise SetNationFront's
        // peace-time `front = 2` branch for cities 1 and 2.
        { id: 9, nationId: 0, supplyState: 0, frontState: 0 },
        { id: 10, nationId: 0, supplyState: 0, frontState: 0 },
    ];
    const diplomacy = [
        {
            id: 1,
            srcNationId: 1,
            destNationId: 2,
            stateCode: testCase.state,
            term: testCase.term,
        },
        {
            id: 2,
            srcNationId: 2,
            destNationId: 1,
            stateCode: testCase.reverseState,
            term: testCase.term,
        },
    ];
    const proposalPayload = {
        src: target(2, '제안장수', 2, '제안국'),
        dest: target(1, '수락장수', 1, '수락국'),
        text: '외교 제안',
        option: {
            action: testCase.action,
            ...(testCase.action === 'noAggression' ? { year: 191, month: 2 } : {}),
        },
    };
    const messages: CoreMessageRow[] = [
        {
            id: 1,
            mailbox: 9001,
            type: 'diplomacy',
            src: 9002,
            dest: 9001,
            time: new Date('2026-08-23T00:00:00Z'),
            valid_until: new Date('9999-12-31T00:00:00Z'),
            message: proposalPayload,
        },
        {
            id: 2,
            mailbox: 9002,
            type: 'diplomacy',
            src: 9002,
            dest: 9001,
            time: new Date('2026-08-23T00:00:00Z'),
            valid_until: new Date('9999-12-31T00:00:00Z'),
            message: {
                ...proposalPayload,
                option: null,
            },
        },
    ];
    const logs: CoreLogRow[] = [];
    const proposalBefore = structuredClone(messages[0]!);

    const findGeneral = (id: number) => (id === actor.id ? actor : id === proposer.id ? proposer : null);
    const queryRaw = vi.fn(async (query: unknown, ...taggedValues: unknown[]) => {
        const queryObject = query as { strings?: readonly string[]; values?: readonly unknown[] };
        const strings = Array.isArray(query) ? query.map(String) : (queryObject.strings ?? []);
        const values = Array.isArray(query)
            ? taggedValues
            : Array.isArray(queryObject.values)
              ? [...queryObject.values]
              : taggedValues;
        const sql = strings.join('?');
        if (sql.includes('FROM message') && (sql.includes('WHERE id =') || sql.includes('WHERE m.id ='))) {
            const id = Number(values[0]);
            const row = messages.find((message) => message.id === id);
            return row && row.valid_until.getTime() > Date.now() ? [row] : [];
        }
        if (sql.includes('INSERT INTO message')) {
            const payloadValue = [...values]
                .reverse()
                .find((value) => typeof value === 'string' && value.startsWith('{'));
            if (payloadValue === undefined) throw new Error('Inserted message payload was not captured.');
            const payload = JSON.parse(payloadValue) as Record<string, unknown>;
            const row: CoreMessageRow = {
                id: messages.at(-1)!.id + 1,
                mailbox: Number(values[0]),
                type: values[1] as CoreMessageRow['type'],
                src: Number(values[2]),
                dest: Number(values[3]),
                time: values[4] as Date,
                valid_until: values[6] as Date,
                message: payload,
            };
            messages.push(row);
            return [{ id: row.id }];
        }
        return [];
    });

    const db = {
        general: {
            findUnique: vi.fn(async ({ where }: { where: { id: number } }) => findGeneral(where.id)),
            findMany: vi.fn(async () => []),
        },
        nation: {
            findUnique: vi.fn(
                async ({ where }: { where: { id: number } }) => nations.find((nation) => nation.id === where.id) ?? null
            ),
            findMany: vi.fn(async () => nations),
            update: vi.fn(async ({ where, data }: { where: { id: number }; data: { meta?: unknown } }) => {
                const nation = nations.find((entry) => entry.id === where.id);
                if (nation && data.meta !== undefined) nation.meta = data.meta as typeof nation.meta;
                return nation;
            }),
        },
        city: {
            findUnique: vi.fn(
                async ({ where }: { where: { id: number } }) => cities.find((city) => city.id === where.id) ?? null
            ),
            findMany: vi.fn(async () => cities),
            update: vi.fn(async ({ where, data }: { where: { id: number }; data: { frontState: number } }) => {
                const city = cities.find((entry) => entry.id === where.id);
                if (city) city.frontState = data.frontState;
                return city;
            }),
        },
        diplomacy: {
            findUnique: vi.fn(
                async ({
                    where,
                }: {
                    where: { srcNationId_destNationId: { srcNationId: number; destNationId: number } };
                }) =>
                    diplomacy.find(
                        (entry) =>
                            entry.srcNationId === where.srcNationId_destNationId.srcNationId &&
                            entry.destNationId === where.srcNationId_destNationId.destNationId
                    ) ?? null
            ),
            findMany: vi.fn(async () => diplomacy),
            update: vi.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { srcNationId_destNationId: { srcNationId: number; destNationId: number } };
                    data: { stateCode?: number; term?: number };
                }) => {
                    const entry = diplomacy.find(
                        (row) =>
                            row.srcNationId === where.srcNationId_destNationId.srcNationId &&
                            row.destNationId === where.srcNationId_destNationId.destNationId
                    );
                    if (entry) {
                        if (data.stateCode !== undefined) entry.stateCode = data.stateCode;
                        if (data.term !== undefined) entry.term = data.term;
                    }
                    return entry;
                }
            ),
        },
        worldState: {
            findFirst: vi.fn(async () => ({
                currentYear: 190,
                currentMonth: 3,
                config: { environment: { mapName: 'che' } },
                clockBaseTime: new Date('0190-03-01T00:00:00.000Z'),
                clockTick: 1_000n,
                clockMode: 'manual',
                clockWallAnchor: new Date('2026-09-04T00:00:00.000Z'),
                tickSeconds: 600,
                clockPhase: 'RUNNING',
                clockRevision: 1n,
                deadlineGeneration: 1n,
            })),
        },
        logEntry: {
            createMany: vi.fn(async ({ data }: { data: CoreLogRow[] }) => {
                logs.push(...data);
                return { count: data.length };
            }),
        },
        message: {
            updateMany: vi.fn(
                async ({ where, data }: { where: { id: { in: number[] } }; data: { validUntil: Date } }) => {
                    for (const row of messages) {
                        if (where.id.in.includes(row.id)) row.valid_until = data.validUntil;
                    }
                    return { count: where.id.in.length };
                }
            ),
        },
        messageAction: {
            updateMany: vi.fn(async () => ({ count: 0 })),
        },
        $queryRaw: queryRaw,
    };

    const auth: GameSessionTokenPayload = {
        version: 1,
        profile: 'che:default',
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
        sessionId: 'session-1',
        user: {
            id: actor.userId!,
            username: 'tester',
            displayName: 'Tester',
            roles: ['user'],
        },
        sanctions: {},
    };
    const context = {
        db,
        auth,
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        redis: {},
        turnDaemon: {
            requestCommand: vi.fn(async () => ({ type: 'syncDiplomaticResponse', ok: true })),
        },
        battleSim: {},
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: {},
        flushStore: {},
        gameTokenSecret: 'test-secret',
        changeJournal: new ChangeJournal(),
    } as unknown as GameApiContext;

    return {
        caller: appRouter.createCaller(context),
        actor,
        nations,
        cities,
        diplomacy,
        logs,
        messages,
        proposalBefore,
    };
};

const normalizeTarget = (value: unknown) => {
    const targetValue = (value ?? {}) as Record<string, unknown>;
    return {
        generalId: Number(targetValue.generalId ?? targetValue.id),
        generalName: String(targetValue.generalName ?? targetValue.name),
        nationId: Number(targetValue.nationId ?? targetValue.nation_id),
        nationName: String(targetValue.nationName ?? targetValue.nation),
    };
};

const normalizeOption = (value: unknown, proposalId: number) => {
    const option =
        value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return {
        ...(option.delete === undefined ? {} : { delete: Number(option.delete) === proposalId ? 'proposal' : 'other' }),
        ...(option.silence === undefined ? {} : { silence: option.silence }),
        ...(option.deletable === undefined ? {} : { deletable: option.deletable }),
        ...(option.receiverMessageID === undefined ? {} : { receiverMessageID: 'receiver-copy' }),
    };
};

const normalizeMessages = (
    rows: Array<{
        id: number;
        mailbox: number;
        type: string;
        src?: number;
        dest?: number;
        sourceId?: number;
        destinationId?: number;
        message?: unknown;
        payload?: unknown;
    }>,
    proposalId: number
) =>
    rows.map((row) => {
        const payload = (row.payload ?? row.message) as Record<string, unknown>;
        return {
            mailbox: row.mailbox,
            type: row.type,
            sourceId: Number(row.sourceId ?? row.src),
            destinationId: Number(row.destinationId ?? row.dest),
            src: normalizeTarget(payload.src),
            dest: normalizeTarget(payload.dest),
            text: payload.text,
            option: normalizeOption(payload.option, proposalId),
        };
    });

const normalizeLogs = (rows: CoreLogRow[]) =>
    rows
        .filter((row) => row.scope.toLowerCase() === 'general' || row.category.toLowerCase() === 'summary')
        .map((row) => ({
            generalId: row.generalId ?? 0,
            category: row.category.toLowerCase(),
            text: row.text,
        }));

integration('Core tRPC messages.respond and Ref DecideMessageResponse dynamic differential', () => {
    it.each(actionCases)('matches the accepted $action response state, logs, and messages', async (testCase) => {
        const reference = runReference(testCase);
        const core = buildCoreCaller(testCase);

        const result = await core.caller.messages.respond({
            generalId: core.actor.id,
            messageId: 1,
            response: true,
        });

        expect(reference.execution).toMatchObject({
            entryPoint: 'sammo\\API\\Message\\DecideMessageResponse',
            action: testCase.action,
            outcome: { result: true },
        });
        expect(result).toEqual({ result: true, reason: 'success' });
        expect(
            core.diplomacy.map(({ srcNationId, destNationId, stateCode, term }) => ({
                fromNationId: srcNationId,
                toNationId: destNationId,
                state: stateCode,
                term,
            }))
        ).toEqual(
            reference.after.diplomacy.map(({ fromNationId, toNationId, state, term }) => ({
                fromNationId,
                toNationId,
                state,
                term,
            }))
        );
        expect(core.cities.filter((city) => city.id <= 2).map(({ id, frontState }) => ({ id, frontState }))).toEqual(
            reference.after.cities.map(({ id, frontState }) => ({ id, frontState }))
        );
        if (testCase.action === 'noAggression') {
            expect(core.nations[1]?.meta).toEqual(reference.after.nations.find((nation) => nation.id === 2)?.meta);
        }

        const referenceLogs = reference.after.logs
            .filter((log) => log.id > reference.before.watermarks.logId)
            .filter((log) => log.scope === 'general' || log.category === 'summary')
            .map((log) => ({
                generalId: log.generalId ?? 0,
                category: log.category,
                text: log.text,
            }));
        expect(normalizeLogs(core.logs)).toEqual(referenceLogs);

        const referenceResults = reference.after.messages.filter(
            (message) => message.id > reference.before.watermarks.messageId
        );
        const coreResults = core.messages.filter((message) => message.id > 2);
        expect(normalizeMessages(coreResults, 1)).toEqual(
            normalizeMessages(referenceResults, reference.execution.proposalMessageId)
        );

        const referenceProposalOption = (
            reference.execution.proposalAfter.payload as {
                option?: Record<string, unknown>;
            }
        ).option;
        expect(reference.execution.proposalAfter.validUntilTick).toBeLessThan(
            reference.execution.proposalBefore.validUntilTick
        );
        expect(referenceProposalOption).toMatchObject({ used: true, invalid: true });
        // Ref also annotates the hidden JSON payload. Core's store represents
        // the same invalidation by expiring validUntil, which is the predicate
        // used by every product message read path.
        expect(core.messages[0]?.valid_until.getTime()).toBeLessThan(core.proposalBefore.valid_until.getTime());
    });
});
