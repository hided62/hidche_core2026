import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

import type { RuntimeNavigationConfig } from '@sammo-ts/common/navigation/menuConfig';
import { z } from 'zod';

const zId = z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/u);
const zLabel = z.string().min(1).max(80);
const zInternalPath = z
    .string()
    .min(1)
    .max(500)
    .refine((value) => value.startsWith('/') && !value.startsWith('//'), '내부 경로는 /로 시작해야 합니다.');
const zExternalHref = z
    .string()
    .min(1)
    .max(1000)
    .refine(
        (value) =>
            (value.startsWith('/') && !value.startsWith('///')) ||
            value.startsWith('https://') ||
            value.startsWith('http://'),
        '링크는 /, //, https:// 또는 http://로 시작해야 합니다.'
    );

const zNavigationLink = z
    .object({
        kind: z.literal('link'),
        id: zId,
        label: zLabel,
        to: zInternalPath.optional(),
        href: zExternalHref.optional(),
        action: z.literal('show-version').optional(),
        newTab: z.boolean().optional(),
        showWhen: z.enum(['always', 'npc-enabled']).optional(),
        highlightWhen: z.enum(['nation-betting', 'vote']).optional(),
    })
    .strict()
    .superRefine((value, context) => {
        const destinations = [value.to, value.href, value.action].filter(Boolean);
        if (destinations.length !== 1) {
            context.addIssue({
                code: 'custom',
                message: '메뉴 링크에는 to, href, action 중 하나만 필요합니다.',
            });
        }
    });

const zNavigationDivider = z.object({ kind: z.literal('divider'), id: zId }).strict();
const zNavigationChild = z.union([zNavigationLink, zNavigationDivider]);
const zNavigationEntry = z.union([
    zNavigationLink,
    z
        .object({
            kind: z.literal('group'),
            id: zId,
            label: zLabel,
            items: z.array(zNavigationChild).min(1).max(30),
        })
        .strict(),
    z
        .object({
            kind: z.literal('split'),
            id: zId,
            main: zNavigationLink,
            items: z.array(zNavigationChild).min(1).max(30),
        })
        .strict(),
]);

export const zRuntimeNavigationConfig: z.ZodType<RuntimeNavigationConfig> = z
    .object({
        version: z.literal(1),
        gateway: z
            .object({
                brand: z.object({ label: zLabel, to: zInternalPath }).strict(),
                items: z
                    .array(
                        z
                            .object({
                                id: zId,
                                label: zLabel,
                                href: zExternalHref,
                                newTab: z.boolean().optional(),
                            })
                            .strict()
                    )
                    .max(30),
            })
            .strict(),
        game: z.object({ items: z.array(zNavigationEntry).min(1).max(20) }).strict(),
    })
    .strict();

export class RuntimeNavigationConfigStore {
    constructor(
        private readonly overridePath: string | null,
        private readonly defaultPath: string
    ) {}

    async get(): Promise<RuntimeNavigationConfig> {
        return (await this.getWithEtag()).config;
    }

    async getWithEtag(): Promise<{ config: RuntimeNavigationConfig; etag: string }> {
        const configPath = await this.resolveConfigPath();
        let raw: unknown;
        try {
            raw = JSON.parse(await fs.readFile(configPath, 'utf8')) as unknown;
        } catch (error) {
            throw new Error(`메뉴 설정 파일을 읽지 못했습니다: ${configPath}`, { cause: error });
        }
        const parsed = zRuntimeNavigationConfig.safeParse(raw);
        if (!parsed.success) {
            throw new Error(`메뉴 설정 파일이 올바르지 않습니다: ${configPath}: ${parsed.error.message}`);
        }
        return {
            config: parsed.data,
            etag: `"${createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex')}"`,
        };
    }

    private async resolveConfigPath(): Promise<string> {
        if (!this.overridePath) return this.defaultPath;
        try {
            await fs.access(this.overridePath);
            return this.overridePath;
        } catch (error) {
            const code = error instanceof Error && 'code' in error ? error.code : undefined;
            if (code === 'ENOENT') return this.defaultPath;
            throw error;
        }
    }
}
