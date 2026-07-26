import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import { appRouter } from '../src/router.js';

const buildGeneral = (overrides: Partial<GeneralRow> = {}): GeneralRow => ({
    id: 1,
    userId: 'user-1',
    name: '테스트장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    npcState: 0,
    affinity: null,
    bornYear: 180,
    deadYear: 300,
    picture: '22.jpg',
    imageServer: 0,
    leadership: 50,
    strength: 50,
    intel: 50,
    injury: 0,
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    gold: 1000,
    rice: 1000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    weaponCode: 'None',
    bookCode: 'None',
    horseCode: 'None',
    itemCode: 'None',
    turnTime: new Date('2026-01-01T00:00:00Z'),
    recentWarTime: null,
    age: 20,
    startAge: 20,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    lastTurn: {},
    meta: {},
    penalty: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
});

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    sessionId: 'session-1',
    user: {
        id: 'user-1',
        username: 'tester',
        displayName: 'Tester',
        roles: [],
    },
    sanctions: {},
};

const buildContext = (options: {
    me?: GeneralRow;
    nationMeta?: Record<string, unknown>;
    auth?: GameSessionTokenPayload | null;
    posts?: Array<{
        id: number;
        nationId: number;
        isSecret: boolean;
        authorGeneralId: number;
        authorName: string;
        title: string;
        contentHtml: string;
        createdAt: Date;
        updatedAt: Date;
        comments: Array<{
            id: number;
            postId: number;
            nationId: number;
            isSecret: boolean;
            authorGeneralId: number;
            authorName: string;
            contentText: string;
            createdAt: Date;
        }>;
    }>;
    targetPost?: { id: number; isSecret: boolean } | null;
}) => {
    const me = options.me ?? buildGeneral();
    const boardPostFindMany = vi.fn(async () => options.posts ?? []);
    const boardPostFindFirst = vi.fn(async () => options.targetPost ?? null);
    const boardPostCreate = vi.fn(async () => ({ id: 31 }));
    const boardCommentCreate = vi.fn(async () => ({ id: 41 }));
    const db = {
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                me.userId === where.userId ? me : null
            ),
            findMany: vi.fn(async () => [{ id: me.id, picture: me.picture, imageServer: me.imageServer }]),
        },
        nation: {
            findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
                where.id === me.nationId ? { meta: options.nationMeta ?? {} } : null
            ),
        },
        boardPost: {
            findMany: boardPostFindMany,
            findFirst: boardPostFindFirst,
            create: boardPostCreate,
        },
        boardComment: {
            create: boardCommentCreate,
        },
    };
    const accessTokenStore = new RedisAccessTokenStore(
        {
            get: async () => null,
            set: async () => null,
        },
        'che:default'
    );
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        redis: {} as RedisConnector['client'],
        turnDaemon: {} as GameApiContext['turnDaemon'],
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth: options.auth === undefined ? auth : options.auth,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore,
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return {
        context,
        boardPostFindMany,
        boardPostFindFirst,
        boardPostCreate,
        boardCommentCreate,
    };
};

describe('board router actor, nation, and secret permissions', () => {
    it.each([
        {
            label: 'ordinary member',
            me: buildGeneral({ officerLevel: 1 }),
            nationMeta: {},
            expected: { permission: 0, canMeeting: true, canSecret: false },
        },
        {
            label: 'chief',
            me: buildGeneral({ officerLevel: 5 }),
            nationMeta: {},
            expected: { permission: 2, canMeeting: true, canSecret: true },
        },
        {
            label: 'low-rank ambassador',
            me: buildGeneral({ officerLevel: 1, meta: { permission: 'ambassador' } }),
            nationMeta: {},
            expected: { permission: 4, canMeeting: true, canSecret: true },
        },
        {
            label: 'auditor',
            me: buildGeneral({ officerLevel: 1, meta: { permission: 'auditor' } }),
            nationMeta: {},
            expected: { permission: 3, canMeeting: true, canSecret: true },
        },
        {
            label: 'penalized chief',
            me: buildGeneral({ officerLevel: 5, penalty: { noChief: true } }),
            nationMeta: {},
            expected: { permission: 0, canMeeting: true, canSecret: false },
        },
        {
            label: 'unaffiliated general',
            me: buildGeneral({ nationId: 0, officerLevel: 0 }),
            nationMeta: {},
            expected: { permission: -1, canMeeting: false, canSecret: false },
        },
    ])('reports legacy-compatible access for $label', async ({ me, nationMeta, expected }) => {
        const fixture = buildContext({ me, nationMeta });
        await expect(appRouter.createCaller(fixture.context).board.getAccess()).resolves.toEqual(expected);
    });

    it('derives the article actor from the authenticated user and scopes the list to their nation', async () => {
        const createdAt = new Date('2026-07-26T10:20:00Z');
        const fixture = buildContext({
            me: buildGeneral({ id: 7, userId: 'user-1', nationId: 3, officerLevel: 5 }),
            posts: [
                {
                    id: 11,
                    nationId: 3,
                    isSecret: true,
                    authorGeneralId: 7,
                    authorName: '작성자',
                    title: '작전',
                    contentHtml: '내용',
                    createdAt,
                    updatedAt: createdAt,
                    comments: [],
                },
            ],
        });

        await expect(
            appRouter.createCaller(fixture.context).board.getArticles({ isSecret: true })
        ).resolves.toMatchObject([
            {
                id: 11,
                title: '작전',
                content: '내용',
                authorName: '작성자',
                authorPicture: '22.jpg',
                authorImageServer: 0,
            },
        ]);
        expect(fixture.boardPostFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { nationId: 3, isSecret: true },
            })
        );
    });

    it('uses the session actor for writes and keeps empty-input wording compatible', async () => {
        const fixture = buildContext({
            me: buildGeneral({ id: 7, userId: 'user-1', nationId: 3, officerLevel: 1 }),
        });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.board.writeArticle({ isSecret: false, title: '', content: '' })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '제목과 내용이 둘다 비어있습니다.',
        });

        await expect(caller.board.writeArticle({ isSecret: false, title: '알림', content: '내용' })).resolves.toEqual({
            id: 31,
        });
        expect(fixture.boardPostCreate).toHaveBeenCalledWith({
            data: {
                nationId: 3,
                isSecret: false,
                authorGeneralId: 7,
                authorName: '테스트장수',
                title: '알림',
                contentHtml: '내용',
            },
            select: { id: true },
        });
    });

    it('does not reveal whether another nation owns a requested comment target', async () => {
        const fixture = buildContext({
            me: buildGeneral({ nationId: 3, officerLevel: 5 }),
            targetPost: null,
        });
        await expect(
            appRouter.createCaller(fixture.context).board.writeComment({ postId: 99, content: '답변' })
        ).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: '게시물이 없습니다.',
        });
        expect(fixture.boardPostFindFirst).toHaveBeenCalledWith({
            where: { id: 99, nationId: 3 },
            select: { id: true, isSecret: true },
        });
        expect(fixture.boardCommentCreate).not.toHaveBeenCalled();
    });

    it('checks secret permission again when adding a comment', async () => {
        const fixture = buildContext({
            me: buildGeneral({ officerLevel: 2 }),
            targetPost: { id: 5, isSecret: true },
        });
        await expect(
            appRouter.createCaller(fixture.context).board.writeComment({ postId: 5, content: '답변' })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: '권한이 부족합니다. 수뇌부가 아닙니다.',
        });
        expect(fixture.boardCommentCreate).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated board access', async () => {
        const fixture = buildContext({ auth: null });
        await expect(appRouter.createCaller(fixture.context).board.getAccess()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
    });
});
