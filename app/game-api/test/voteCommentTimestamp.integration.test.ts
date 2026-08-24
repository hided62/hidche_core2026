import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import type { GameApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const fixtureId = 9_984_241;
const fallbackPollId = fixtureId + 1;
const fixtureUserId = 'vote-comment-timestamp-user';
const routeText = '설문 댓글 UTC writer 검증';
const fallbackText = '설문 댓글 UTC default 검증';

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:vote-comment-timestamp',
    issuedAt: '2026-08-24T00:00:00.000Z',
    expiresAt: '2027-08-24T00:00:00.000Z',
    sessionId: 'vote-comment-timestamp-session',
    user: {
        id: fixtureUserId,
        username: fixtureUserId,
        displayName: fixtureUserId,
        roles: [],
    },
    sanctions: {},
};

integration('vote comment operational timestamp', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanup = async (): Promise<void> => {
        await db.inputEvent.deleteMany({
            where: { requestId: { startsWith: 'integration:vote-comment-timestamp' } },
        });
        await db.voteComment.deleteMany({ where: { voteId: { in: [fixtureId, fallbackPollId] } } });
        await db.vote.deleteMany({ where: { voteId: { in: [fixtureId, fallbackPollId] } } });
        await db.votePoll.deleteMany({ where: { id: { in: [fixtureId, fallbackPollId] } } });
        await db.general.deleteMany({ where: { id: fixtureId } });
        await db.nation.deleteMany({ where: { id: fixtureId } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await cleanup();
        await db.nation.create({ data: { id: fixtureId, name: '시각국', color: '#123456' } });
        await db.general.create({
            data: {
                id: fixtureId,
                userId: fixtureUserId,
                name: '시각장수',
                nationId: fixtureId,
                turnTime: new Date('0200-01-01T00:00:00.000Z'),
            },
        });
        await db.votePoll.create({
            data: {
                id: fixtureId,
                title: '시각 설문',
                options: ['찬성', '반대'],
                multipleOptions: 1,
                revealMode: 'after_vote',
                openerGeneralId: fixtureId,
                openerName: '시각장수',
                startAt: new Date('0200-01-01T00:00:00.000Z'),
            },
        });
    });

    afterAll(async () => {
        await cleanup();
        await closeDb?.();
    });

    it('stores current writers and rollback-compatible vote defaults as UTC wall time in KST', async () => {
        const [session] = await db.$queryRaw<Array<{ timeZone: string }>>`
            SELECT current_setting('TIMEZONE') AS "timeZone"
        `;
        expect(session?.timeZone).toBe('Asia/Seoul');

        const routeWindowStart = Date.now();
        const caller = appRouter.createCaller({
            requestId: 'integration:vote-comment-timestamp',
            db,
            auth,
            profile: { id: 'che', scenario: 'vote-comment-timestamp', name: 'che:vote-comment-timestamp' },
            turnDaemon: {},
        } as unknown as GameApiContext);
        await expect(caller.vote.addComment({ voteId: fixtureId, text: routeText })).resolves.toEqual({ ok: true });
        const routeWindowEnd = Date.now();

        const fallbackWindowStart = Date.now();
        await db.$executeRaw`
            INSERT INTO "vote_comment" (
                "vote_id",
                "general_id",
                "nation_id",
                "general_name",
                "nation_name",
                "text"
            )
            VALUES (
                ${fixtureId},
                ${fixtureId},
                ${fixtureId},
                '시각장수',
                '시각국',
                ${fallbackText}
            )
        `;
        const fallbackWindowEnd = Date.now();

        const pollFallbackWindowStart = Date.now();
        await db.$executeRaw`
            INSERT INTO "vote_poll" (
                "id",
                "title",
                "body",
                "options",
                "multiple_options",
                "reveal_mode",
                "opener_general_id",
                "opener_name",
                "start_at"
            )
            VALUES (
                ${fallbackPollId},
                '이전 writer 기본값 설문',
                '',
                '["찬성", "반대"]'::jsonb,
                1,
                'after_vote',
                ${fixtureId},
                '시각장수',
                ${new Date('0200-01-01T00:00:00.000Z')}
            )
        `;
        const pollFallbackWindowEnd = Date.now();

        const voteFallbackWindowStart = Date.now();
        await db.$executeRaw`
            INSERT INTO "vote" ("vote_id", "general_id", "nation_id", "selection")
            VALUES (${fixtureId}, ${fixtureId}, ${fixtureId}, '[0]'::jsonb)
        `;
        const voteFallbackWindowEnd = Date.now();

        const rows = await db.voteComment.findMany({
            where: { voteId: fixtureId },
            select: { text: true, createdAt: true },
        });
        const routeRow = rows.find((row) => row.text === routeText);
        const fallbackRow = rows.find((row) => row.text === fallbackText);
        expect(routeRow?.createdAt.getTime()).toBeGreaterThanOrEqual(routeWindowStart);
        expect(routeRow?.createdAt.getTime()).toBeLessThanOrEqual(routeWindowEnd);
        expect(fallbackRow?.createdAt.getTime()).toBeGreaterThanOrEqual(fallbackWindowStart);
        expect(fallbackRow?.createdAt.getTime()).toBeLessThanOrEqual(fallbackWindowEnd);

        const fallbackPoll = await db.votePoll.findUniqueOrThrow({ where: { id: fallbackPollId } });
        expect(fallbackPoll.createdAt.getTime()).toBeGreaterThanOrEqual(pollFallbackWindowStart);
        expect(fallbackPoll.createdAt.getTime()).toBeLessThanOrEqual(pollFallbackWindowEnd);
        expect(fallbackPoll.updatedAt.getTime()).toBeGreaterThanOrEqual(pollFallbackWindowStart);
        expect(fallbackPoll.updatedAt.getTime()).toBeLessThanOrEqual(pollFallbackWindowEnd);

        const fallbackVote = await db.vote.findUniqueOrThrow({
            where: { voteId_generalId: { voteId: fixtureId, generalId: fixtureId } },
        });
        expect(fallbackVote.createdAt.getTime()).toBeGreaterThanOrEqual(voteFallbackWindowStart);
        expect(fallbackVote.createdAt.getTime()).toBeLessThanOrEqual(voteFallbackWindowEnd);
    });
});
