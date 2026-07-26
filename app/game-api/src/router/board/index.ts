import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import sharp, { type WebpOptions } from 'sharp';

import { authedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';
import { resolveSecretPermission } from '../shared/secretPermission.js';

const MAX_UPLOAD_BYTES = 1024 * 1024;
const MAX_LONG_EDGE = 2048;
const WEBP_QUALITY = 80;
const WEBP_MIN_SAVING_RATIO = 0.97;

const assertBoardAccess = (permission: number, isSecret: boolean) => {
    if (permission < 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '국가에 소속되어있지 않습니다.' });
    }
    if (isSecret && permission < 2) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다. 수뇌부가 아닙니다.' });
    }
};

const getBoardActor = async (ctx: Parameters<typeof getMyGeneral>[0]) => {
    const general = await getMyGeneral(ctx);
    const nation =
        general.nationId > 0
            ? await ctx.db.nation.findUnique({
                  where: { id: general.nationId },
                  select: { meta: true },
              })
            : null;
    const permission = resolveSecretPermission(general, nation?.meta ?? {}, true);
    return { general, permission };
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

export const boardRouter = router({
    getAccess: authedProcedure.query(async ({ ctx }) => {
        const { permission } = await getBoardActor(ctx);
        return {
            permission,
            canMeeting: permission >= 0,
            canSecret: permission >= 2,
        };
    }),
    getArticles: authedProcedure.input(z.object({ isSecret: z.boolean() })).query(async ({ ctx, input }) => {
        const { general, permission } = await getBoardActor(ctx);
        assertBoardAccess(permission, input.isSecret);

        const posts = await ctx.db.boardPost.findMany({
            where: {
                nationId: general.nationId,
                isSecret: input.isSecret,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 100,
            include: {
                comments: {
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                },
            },
        });

        if (posts.length === 0) {
            return [];
        }

        const authors = await ctx.db.general.findMany({
            where: {
                id: {
                    in: [...new Set(posts.map((post) => post.authorGeneralId))],
                },
            },
            select: {
                id: true,
                picture: true,
                imageServer: true,
            },
        });
        const authorMap = new Map(authors.map((author) => [author.id, author]));

        return posts.map((post) => ({
            id: post.id,
            title: post.title,
            content: post.contentHtml,
            authorName: post.authorName,
            authorPicture: authorMap.get(post.authorGeneralId)?.picture ?? null,
            authorImageServer: authorMap.get(post.authorGeneralId)?.imageServer ?? 0,
            createdAt: post.createdAt.toISOString(),
            comments: post.comments.map((comment) => ({
                id: comment.id,
                authorName: comment.authorName,
                content: comment.contentText,
                createdAt: comment.createdAt.toISOString(),
            })),
        }));
    }),
    writeArticle: authedProcedure
        .input(
            z.object({
                isSecret: z.boolean(),
                title: z.string().trim().max(250),
                content: z.string().trim().max(20000),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const { general, permission } = await getBoardActor(ctx);
            assertBoardAccess(permission, input.isSecret);

            if (!input.title && !input.content) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '제목과 내용이 둘다 비어있습니다.' });
            }

            const post = await ctx.db.boardPost.create({
                data: {
                    nationId: general.nationId,
                    isSecret: input.isSecret,
                    authorGeneralId: general.id,
                    authorName: general.name,
                    title: input.title,
                    contentHtml: input.content,
                },
                select: { id: true },
            });

            return { id: post.id };
        }),
    writeComment: authedProcedure
        .input(
            z.object({
                postId: z.number().int().positive(),
                content: z.string().trim().max(2000),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const { general, permission } = await getBoardActor(ctx);
            if (!input.content) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '내용이 비어있습니다.' });
            }

            const post = await ctx.db.boardPost.findFirst({
                where: {
                    id: input.postId,
                    nationId: general.nationId,
                },
                select: {
                    id: true,
                    isSecret: true,
                },
            });
            if (!post) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '게시물이 없습니다.' });
            }

            assertBoardAccess(permission, post.isSecret);

            const comment = await ctx.db.boardComment.create({
                data: {
                    postId: post.id,
                    nationId: general.nationId,
                    isSecret: post.isSecret,
                    authorGeneralId: general.id,
                    authorName: general.name,
                    contentText: input.content,
                },
                select: { id: true },
            });

            return { id: comment.id };
        }),
    uploadImage: authedProcedure.input(z.object({ dataUrl: z.string().min(1) })).mutation(async ({ ctx, input }) => {
        const { permission } = await getBoardActor(ctx);
        assertBoardAccess(permission, false);

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
