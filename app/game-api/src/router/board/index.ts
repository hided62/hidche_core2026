import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import sharp, { type WebpOptions } from 'sharp';

import { GamePrisma } from '@sammo-ts/infra';

import { authedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';

const MAX_UPLOAD_BYTES = 1024 * 1024;
const MAX_LONG_EDGE = 2048;
const WEBP_QUALITY = 80;
const WEBP_MIN_SAVING_RATIO = 0.97;

const resolveSecretPermission = (officerLevel: number): number => {
    if (officerLevel >= 5) return 2;
    if (officerLevel > 1) return 1;
    return 0;
};

const assertBoardAccess = (nationId: number, officerLevel: number, isSecret: boolean) => {
    if (nationId <= 0 || officerLevel <= 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '국가에 소속되어있지 않습니다.' });
    }
    if (isSecret && resolveSecretPermission(officerLevel) < 2) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다. 수뇌부가 아닙니다.' });
    }
};

const normalizeUploadPath = (value: string) => {
    if (!value.startsWith('/')) {
        return `/${value}`;
    }
    return value.replace(/\/$/, '');
};

const buildPublicImageUrl = (uploadPublicUrl: string | null, uploadPath: string, filename: string) => {
    if (uploadPublicUrl) {
        return `${uploadPublicUrl.replace(/\/$/, '')}/${filename}`;
    }
    const normalizedPath = normalizeUploadPath(uploadPath);
    return `${normalizedPath}/${filename}`;
};

const parseDataUrl = (dataUrl: string): Buffer => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
        return Buffer.from(match[2], 'base64');
    }
    return Buffer.from(dataUrl, 'base64');
};

type WebpOptionsWithAnimation = WebpOptions & { animated?: boolean };

const buildWebpBuffer = async (
    buffer: Buffer,
    { animated, resize }: { animated: boolean; resize: boolean }
): Promise<Buffer> => {
    let pipeline = sharp(buffer, { animated: true });
    if (resize) {
        pipeline = pipeline.resize({
            width: MAX_LONG_EDGE,
            height: MAX_LONG_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
        });
    }
    const webpOptions: WebpOptionsWithAnimation = {
        quality: WEBP_QUALITY,
        effort: 4,
        alphaQuality: WEBP_QUALITY,
        loop: 0,
        ...(animated ? { animated: true } : {}),
    };

    return pipeline.webp(webpOptions).toBuffer();
};

const buildAvifBuffer = async (buffer: Buffer, resize: boolean): Promise<Buffer> => {
    let pipeline = sharp(buffer, { animated: true });
    if (resize) {
        pipeline = pipeline.resize({
            width: MAX_LONG_EDGE,
            height: MAX_LONG_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
        });
    }
    return pipeline.avif({ quality: 60, effort: 4 }).toBuffer();
};

type BoardPostRow = {
    id: number;
    nation_id: number;
    is_secret: boolean;
    author_general_id: number;
    author_name: string;
    title: string;
    content_html: string;
    created_at: Date;
};

type BoardCommentRow = {
    id: number;
    post_id: number;
    author_general_id: number;
    author_name: string;
    content_text: string;
    created_at: Date;
};

export const boardRouter = router({
    getArticles: authedProcedure
        .input(z.object({ isSecret: z.boolean() }))
        .query(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertBoardAccess(me.nationId, me.officerLevel, input.isSecret);

            const posts = await ctx.db.$queryRaw<BoardPostRow[]>(GamePrisma.sql`
                SELECT
                    id,
                    nation_id,
                    is_secret,
                    author_general_id,
                    author_name,
                    title,
                    content_html,
                    created_at
                FROM board_post
                WHERE nation_id = ${me.nationId} AND is_secret = ${input.isSecret}
                ORDER BY created_at DESC
                LIMIT 100
            `);

            if (posts.length === 0) {
                return [];
            }

            const postIds = posts.map((post) => post.id);
            const comments = await ctx.db.$queryRaw<BoardCommentRow[]>(GamePrisma.sql`
                SELECT
                    id,
                    post_id,
                    author_general_id,
                    author_name,
                    content_text,
                    created_at
                FROM board_comment
                WHERE post_id IN (${GamePrisma.join(postIds)})
                ORDER BY created_at ASC
            `);

            const commentMap = new Map<number, BoardCommentRow[]>();
            for (const comment of comments) {
                const list = commentMap.get(comment.post_id) ?? [];
                list.push(comment);
                commentMap.set(comment.post_id, list);
            }

            return posts.map((post) => ({
                id: post.id,
                title: post.title,
                contentHtml: post.content_html,
                authorName: post.author_name,
                createdAt: post.created_at.toISOString(),
                comments: (commentMap.get(post.id) ?? []).map((comment) => ({
                    id: comment.id,
                    authorName: comment.author_name,
                    content: comment.content_text,
                    createdAt: comment.created_at.toISOString(),
                })),
            }));
        }),
    writeArticle: authedProcedure
        .input(
            z.object({
                isSecret: z.boolean(),
                title: z.string().trim().max(250),
                contentHtml: z.string().trim().max(20000),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            assertBoardAccess(me.nationId, me.officerLevel, input.isSecret);

            if (!input.title && !input.contentHtml) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '제목 혹은 내용이 필요합니다.' });
            }

            const rows = await ctx.db.$queryRaw<{ id: number }[]>(GamePrisma.sql`
                INSERT INTO board_post (nation_id, is_secret, author_general_id, author_name, title, content_html)
                VALUES (${me.nationId}, ${input.isSecret}, ${me.id}, ${me.name}, ${input.title}, ${input.contentHtml})
                RETURNING id
            `);

            return { id: rows[0]?.id ?? null };
        }),
    writeComment: authedProcedure
        .input(
            z.object({
                postId: z.number().int().positive(),
                content: z.string().trim().max(2000),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            if (!input.content) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '내용이 필요합니다.' });
            }

            const posts = await ctx.db.$queryRaw<{ id: number; nation_id: number; is_secret: boolean }[]>(
                GamePrisma.sql`
                    SELECT id, nation_id, is_secret
                    FROM board_post
                    WHERE id = ${input.postId}
                    LIMIT 1
                `
            );

            const post = posts[0];
            if (!post) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '게시물을 찾을 수 없습니다.' });
            }

            assertBoardAccess(me.nationId, me.officerLevel, post.is_secret);

            if (post.nation_id !== me.nationId) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
            }

            const rows = await ctx.db.$queryRaw<{ id: number }[]>(GamePrisma.sql`
                INSERT INTO board_comment (post_id, nation_id, is_secret, author_general_id, author_name, content_text)
                VALUES (${post.id}, ${me.nationId}, ${post.is_secret}, ${me.id}, ${me.name}, ${input.content})
                RETURNING id
            `);

            return { id: rows[0]?.id ?? null };
        }),
    uploadImage: authedProcedure
        .input(z.object({ dataUrl: z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
            const me = await getMyGeneral(ctx);
            if (me.nationId <= 0 || me.officerLevel <= 0) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '국가에 소속되어있지 않습니다.' });
            }

            const buffer = parseDataUrl(input.dataUrl);
            if (buffer.length > MAX_UPLOAD_BYTES) {
                throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: '이미지 용량 제한(1MB)을 초과했습니다.' });
            }

            const metadata = await sharp(buffer, { animated: true }).metadata();
            if (!metadata.format || !metadata.width || !metadata.height) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미지 정보를 확인할 수 없습니다.' });
            }

            const format = metadata.format;
            const isAnimated = (metadata.pages ?? 1) > 1;
            const needsResize = Math.max(metadata.width, metadata.height) > MAX_LONG_EDGE;

            const allowed = new Set(['png', 'jpeg', 'jpg', 'gif', 'webp', 'avif', 'heif', 'tiff', 'bmp']);
            if (!allowed.has(format)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '지원하지 않는 이미지 형식입니다.' });
            }

            let outputBuffer = buffer;
            let outputFormat = format === 'avif' ? 'avif' : 'webp';

            if (format === 'avif') {
                if (needsResize) {
                    outputBuffer = await buildAvifBuffer(buffer, true);
                }
            } else {
                const webpBuffer = await buildWebpBuffer(buffer, {
                    animated: isAnimated || format === 'gif',
                    resize: needsResize,
                });
                if (format === 'webp' && !needsResize && webpBuffer.length >= buffer.length * WEBP_MIN_SAVING_RATIO) {
                    outputBuffer = buffer;
                    outputFormat = 'webp';
                } else {
                    outputBuffer = webpBuffer;
                    outputFormat = 'webp';
                }
            }

            await fs.mkdir(ctx.uploadDir, { recursive: true });
            const filename = `${randomUUID()}.${outputFormat}`;
            await fs.writeFile(path.join(ctx.uploadDir, filename), outputBuffer);

            const outputMeta = await sharp(outputBuffer, { animated: true }).metadata();
            const url = buildPublicImageUrl(ctx.uploadPublicUrl, ctx.uploadPath, filename);

            return {
                url,
                width: outputMeta.width ?? metadata.width,
                height: outputMeta.height ?? metadata.height,
                format: outputFormat,
                animated: isAnimated,
                size: outputBuffer.length,
            };
        }),
});