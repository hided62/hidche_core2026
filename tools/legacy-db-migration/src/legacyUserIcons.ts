import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';

import sharp from 'sharp';
import type { PoolClient } from 'pg';

import { legacyUserId } from './identity.js';
import { toDate, toNumber, toStringValue, type SourceRow } from './db.js';

const MAX_ICON_BYTES = 50 * 1024;
const LEGACY_CACHE_SUFFIX = /\?=([0-9]{8})$/u;
const REMOTE_PICTURE = /^users\/(?:core|core2026)\/[a-f0-9]{32}\.(?:avif|webp|jpe?g|png|gif)$/u;
const LOCAL_PICTURE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}\.(?:avif|webp|jpe?g|png|gif)$/u;
const CONTENT_TYPES: Record<string, string> = {
    avif: 'image/avif',
    webp: 'image/webp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
};

export interface LegacyUserIconTransferConfig {
    sourceDirectory: string;
    uploadBaseUrl: string;
    publicBaseUrl: string;
    uploadSecret: string;
}

export interface PreparedLegacyUserIcon {
    memberNo: number;
    userId: string;
    sourcePicture: string;
    normalizedSourcePicture: string;
    sourceImageServer: number;
    picture: string;
    imageServer: 0;
    createdAt: Date;
    source: 'legacy-file' | 'existing-upload';
    sha256: string;
}

export interface LegacyUserIconPreparation {
    icons: Map<number, PreparedLegacyUserIcon>;
    counts: {
        custom: number;
        legacyFiles: number;
        existingUploads: number;
        uploaded: number;
    };
}

export interface LegacyUserIconSyncCounts {
    currentLinked: number;
    libraryInserted: number;
    libraryRetired: number;
    targetPreserved: number;
}

interface ValidatedImage {
    body: Buffer;
    extension: string;
    contentType: string;
    sha256: string;
}

const encodedPicturePath = (picture: string): string => picture.split('/').map(encodeURIComponent).join('/');

export const normalizeLegacyIconPicture = (picture: string): string => picture.replace(LEGACY_CACHE_SUFFIX, '');

const iconCreatedAt = (sourcePicture: string, fallback: Date): Date => {
    const marker = sourcePicture.match(LEGACY_CACHE_SUFFIX)?.[1];
    if (!marker) return fallback;
    const year = Number(marker.slice(0, 4));
    const month = Number(marker.slice(4, 6));
    const day = Number(marker.slice(6, 8));
    const parsed = new Date(Date.UTC(year, month - 1, day, -9));
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const validateImage = async (body: Buffer, label: string): Promise<ValidatedImage> => {
    if (body.length === 0 || body.length > MAX_ICON_BYTES) {
        throw new Error(`${label} must be non-empty and at most 50 KiB`);
    }
    let metadata: { mediaType?: string; format?: string; width?: number; height?: number };
    try {
        metadata = await sharp(body, { animated: true }).metadata();
    } catch (error) {
        throw new Error(`${label} is not a decodable image`, { cause: error });
    }
    const detected = metadata.mediaType === 'image/avif' ? 'avif' : metadata.format;
    const extension = detected === 'jpeg' ? 'jpg' : detected;
    if (!extension || !CONTENT_TYPES[extension]) {
        throw new Error(`${label} must be avif, webp, jpeg, png, or gif`);
    }
    if (!metadata.width || metadata.width < 64 || metadata.width > 128 || metadata.height !== metadata.width) {
        throw new Error(`${label} must be a square image from 64x64 through 128x128`);
    }
    return {
        body,
        extension,
        contentType: CONTENT_TYPES[extension]!,
        sha256: createHash('sha256').update(body).digest('hex'),
    };
};

const readLegacyIcon = async (directory: string, picture: string, memberNo: number): Promise<ValidatedImage> => {
    if (!LOCAL_PICTURE.test(picture) || path.basename(picture) !== picture) {
        throw new Error(`member.${memberNo}.PICTURE is not a safe Ref d_pic filename`);
    }
    const filePath = path.resolve(directory, picture);
    if (path.dirname(filePath) !== path.resolve(directory)) {
        throw new Error(`member.${memberNo}.PICTURE escapes the Ref d_pic directory`);
    }
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`member.${memberNo}.PICTURE must resolve to a regular non-symlink file`);
    }
    if (info.size === 0 || info.size > MAX_ICON_BYTES) {
        throw new Error(`member.${memberNo}.PICTURE must be non-empty and at most 50 KiB`);
    }
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        return await validateImage(await handle.readFile(), `member.${memberNo}.PICTURE`);
    } finally {
        await handle.close();
    }
};

const fetchExistingIcon = async (
    config: LegacyUserIconTransferConfig,
    picture: string,
    memberNo: number,
    fetchImpl: typeof fetch
): Promise<ValidatedImage> => {
    if (!REMOTE_PICTURE.test(picture)) {
        throw new Error(`member.${memberNo}.PICTURE is neither a Ref d_pic filename nor a sam-image upload path`);
    }
    const response = await fetchImpl(`${config.publicBaseUrl.replace(/\/$/u, '')}/${encodedPicturePath(picture)}`, {
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
    });
    if (!response.ok) {
        throw new Error(`member.${memberNo}.PICTURE is unavailable from sam-image (HTTP ${response.status})`);
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_ICON_BYTES) {
        throw new Error(`member.${memberNo}.PICTURE exceeds 50 KiB on sam-image`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    return validateImage(body, `member.${memberNo}.PICTURE`);
};

const deterministicUploadName = (memberNo: number, sourcePicture: string, image: ValidatedImage): string => {
    const stem = createHash('sha256')
        .update('legacy-ref-user-icon-v1\0')
        .update(String(memberNo))
        .update('\0')
        .update(sourcePicture)
        .update('\0')
        .update(image.sha256)
        .digest('hex')
        .slice(0, 32);
    return `${stem}.${image.extension}`;
};

const uploadSignature = (
    secret: string,
    expires: string,
    requestId: string,
    pathname: string,
    contentType: string,
    body: Buffer
): string => {
    const digest = createHash('sha256').update(body).digest('hex');
    return createHmac('sha256', secret)
        .update(`${expires}.${requestId}.${pathname}.${contentType}.${digest}`)
        .digest('hex');
};

const uploadLegacyIcon = async (
    config: LegacyUserIconTransferConfig,
    memberNo: number,
    sourcePicture: string,
    image: ValidatedImage,
    fetchImpl: typeof fetch,
    now: () => number
): Promise<string> => {
    const filename = deterministicUploadName(memberNo, sourcePicture, image);
    const pathname = `/v1/uploads/user-icons/core2026/${filename}`;
    const expires = String(Math.floor(now() / 1000) + 60);
    const requestId = `legacy-ref-${filename.slice(0, 32)}`;
    const response = await fetchImpl(`${config.uploadBaseUrl.replace(/\/$/u, '')}${pathname}`, {
        method: 'PUT',
        headers: {
            'content-type': image.contentType,
            'x-image-client': 'core2026',
            'x-image-expires': expires,
            'x-image-request-id': requestId,
            'x-image-signature': uploadSignature(
                config.uploadSecret,
                expires,
                requestId,
                pathname,
                image.contentType,
                image.body
            ),
        },
        body: new Uint8Array(image.body),
    });
    if (!response.ok) {
        throw new Error(`member.${memberNo}.PICTURE upload failed with HTTP ${response.status}`);
    }
    const picture = `users/core2026/${filename}`;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('path' in payload) || payload.path !== `icons/${picture}`) {
        throw new Error(`member.${memberNo}.PICTURE upload returned an unexpected path`);
    }
    return picture;
};

const mapWithConcurrency = async <T, R>(
    values: readonly T[],
    concurrency: number,
    mapper: (value: T) => Promise<R>
): Promise<R[]> => {
    const results = new Array<R>(values.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (nextIndex < values.length) {
            const index = nextIndex++;
            results[index] = await mapper(values[index]!);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
    return results;
};

export const prepareLegacyUserIcons = async (
    rows: readonly SourceRow[],
    config: LegacyUserIconTransferConfig | undefined,
    apply: boolean,
    options: { fetchImpl?: typeof fetch; now?: () => number; concurrency?: number } = {}
): Promise<LegacyUserIconPreparation> => {
    const customRows = rows.filter((row) => (row.PICTURE ?? 'default.jpg') !== 'default.jpg');
    if (customRows.length > 0 && !config) {
        throw new Error('Gateway source has custom icons but gateway.userIcons is not configured');
    }
    if (!config) {
        return { icons: new Map(), counts: { custom: 0, legacyFiles: 0, existingUploads: 0, uploaded: 0 } };
    }
    if (config.uploadSecret.length < 32) {
        throw new Error('gateway.userIcons.uploadSecretFile must contain at least 32 characters');
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    const now = options.now ?? Date.now;
    const validated = await mapWithConcurrency(customRows, options.concurrency ?? 8, async (row) => {
        const memberNo = toNumber(row.NO, 'member.NO');
        const sourcePicture = toStringValue(row.PICTURE, `member.${memberNo}.PICTURE`);
        const normalizedSourcePicture = normalizeLegacyIconPicture(sourcePicture);
        const sourceImageServer = toNumber(row.IMGSVR ?? 0, `member.${memberNo}.IMGSVR`);
        const fallbackCreatedAt = toDate(row.REG_DATE, `member.${memberNo}.REG_DATE`);
        if (REMOTE_PICTURE.test(normalizedSourcePicture)) {
            const image = await fetchExistingIcon(config, normalizedSourcePicture, memberNo, fetchImpl);
            return {
                base: {
                    memberNo,
                    userId: legacyUserId(memberNo),
                    sourcePicture,
                    normalizedSourcePicture,
                    sourceImageServer,
                    imageServer: 0 as const,
                    createdAt: iconCreatedAt(sourcePicture, fallbackCreatedAt),
                    source: 'existing-upload' as const,
                    sha256: image.sha256,
                },
                image,
                picture: normalizedSourcePicture,
            };
        }
        if (sourceImageServer !== 1) {
            throw new Error(`member.${memberNo}.PICTURE has an unsupported IMGSVR value`);
        }
        const image = await readLegacyIcon(config.sourceDirectory, normalizedSourcePicture, memberNo);
        return {
            base: {
                memberNo,
                userId: legacyUserId(memberNo),
                sourcePicture,
                normalizedSourcePicture,
                sourceImageServer,
                imageServer: 0 as const,
                createdAt: iconCreatedAt(sourcePicture, fallbackCreatedAt),
                source: 'legacy-file' as const,
                sha256: image.sha256,
            },
            image,
            picture: `users/core2026/${deterministicUploadName(memberNo, normalizedSourcePicture, image)}`,
        };
    });
    const pictures = new Map<string, number>();
    for (const icon of validated) {
        const owner = pictures.get(icon.picture);
        if (owner !== undefined && owner !== icon.base.memberNo) {
            throw new Error('Legacy user icon picture is shared by multiple source accounts');
        }
        pictures.set(icon.picture, icon.base.memberNo);
    }
    const prepared = await mapWithConcurrency(validated, options.concurrency ?? 8, async (icon) => {
        const picture =
            apply && icon.base.source === 'legacy-file'
                ? await uploadLegacyIcon(
                      config,
                      icon.base.memberNo,
                      icon.base.normalizedSourcePicture,
                      icon.image,
                      fetchImpl,
                      now
                  )
                : icon.picture;
        return { ...icon.base, picture } satisfies PreparedLegacyUserIcon;
    });
    return {
        icons: new Map(prepared.map((icon) => [icon.memberNo, icon])),
        counts: {
            custom: prepared.length,
            legacyFiles: prepared.filter((icon) => icon.source === 'legacy-file').length,
            existingUploads: prepared.filter((icon) => icon.source === 'existing-upload').length,
            uploaded: apply ? prepared.filter((icon) => icon.source === 'legacy-file').length : 0,
        },
    };
};

export const syncImportedUserIcons = async (
    target: PoolClient,
    icons: readonly PreparedLegacyUserIcon[],
    migratedAt: Date
): Promise<LegacyUserIconSyncCounts> => {
    if (icons.length === 0) {
        return { currentLinked: 0, libraryInserted: 0, libraryRetired: 0, targetPreserved: 0 };
    }
    const userIds = icons.map((icon) => icon.userId);
    const accounts = await target.query<{ id: string; picture: string; image_server: number }>(
        `SELECT "id", "picture", "image_server" FROM "app_user" WHERE "id" = ANY($1::text[]) FOR UPDATE`,
        [userIds]
    );
    const byId = new Map(accounts.rows.map((account) => [account.id, account]));
    const collisions = await target.query<{ picture: string }>(
        `SELECT imported."picture"
         FROM "user_icon" AS existing
         JOIN unnest($1::text[], $2::text[]) AS imported("user_id", "picture")
           ON imported."picture" = existing."picture"
         WHERE existing."user_id" <> imported."user_id"
         LIMIT 1`,
        [userIds, icons.map((icon) => icon.picture)]
    );
    if (collisions.rowCount) {
        throw new Error('Legacy user icon picture is already owned by another target account');
    }
    const counts: LegacyUserIconSyncCounts = {
        currentLinked: 0,
        libraryInserted: 0,
        libraryRetired: 0,
        targetPreserved: 0,
    };
    for (const icon of icons) {
        const account = byId.get(icon.userId);
        if (!account) throw new Error(`Imported member account is missing for member.${icon.memberNo}`);
        const sourceMatchesCurrent =
            account.picture === icon.sourcePicture || account.picture === icon.normalizedSourcePicture;
        if (sourceMatchesCurrent && (account.picture !== icon.picture || account.image_server !== 0)) {
            const linked = await target.query(
                `UPDATE "app_user"
                 SET "picture" = $2, "image_server" = 0,
                     "icon_revision" = GREATEST(
                         COALESCE("icon_revision", "icon_updated_at", "created_at"),
                         $3::timestamptz
                     )
                 WHERE "id" = $1 AND "picture" = $4 AND "image_server" = $5`,
                [icon.userId, icon.picture, migratedAt, account.picture, account.image_server]
            );
            if (linked.rowCount !== 1) {
                throw new Error(`Target account icon changed concurrently for member.${icon.memberNo}`);
            }
            account.picture = icon.picture;
            account.image_server = 0;
            counts.currentLinked += 1;
        } else if (!sourceMatchesCurrent && account.picture !== icon.picture) {
            counts.targetPreserved += 1;
        }
        const retiredAt = account.picture === 'default.jpg' ? migratedAt : null;
        const inserted = await target.query(
            `INSERT INTO "user_icon" ("user_id", "picture", "image_server", "created_at", "retired_at")
             VALUES ($1, $2, 0, $3, $4)
             ON CONFLICT ("picture") DO NOTHING`,
            [icon.userId, icon.picture, icon.createdAt, retiredAt]
        );
        counts.libraryInserted += inserted.rowCount ?? 0;
        if (retiredAt && inserted.rowCount) counts.libraryRetired += 1;
    }
    return counts;
};
